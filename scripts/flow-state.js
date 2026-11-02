#!/usr/bin/env node
// Task state lives in the repo, not in the session (so any harness can resume).
//   node flow-state.js write  <slug> <id> key=value ...    update state.md (creates it)
//   node flow-state.js read   <slug> <id>                   print state as JSON
//   node flow-state.js ask    <slug> <id> "question" [--options "a|b"]   append to questions.md, mark blocked
//   node flow-state.js status <slug>                        derive feature status from tasks.md + merged states
//   node flow-state.js queue [<slug> <status>]              print the feature queue and the next runnable feature, or set a row
// A task branch writes ONLY tasks/<id>/{state,questions}.md. tasks.md is read-only during runs.
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from './lib/miniyaml.js';
import { flowDir } from './lib/config.js';

const STATUSES = ['todo', 'in_progress', 'blocked', 'done'];
const FIELDS = ['task', 'status', 'branch', 'last_commit', 'steps_done', 'next_step', 'next_harness', 'attempts', 'questions'];

const STRING_FIELDS = ['task', 'branch', 'last_commit', 'next_step', 'next_harness', 'questions'];

export function parseState(text) {
  const s = parse(text.replace(/^---\s*$/gm, ''));
  for (const k of STRING_FIELDS) if (s[k] !== undefined && s[k] !== null) s[k] = String(s[k]);
  if (Array.isArray(s.steps_done)) s.steps_done = s.steps_done.map(String);
  return s;
}

export function serializeState(s) {
  const lines = [];
  for (const k of FIELDS) {
    if (s[k] === undefined) continue;
    const v = s[k];
    // string fields are always quoted so ids like "3" or shas like "0123456" never turn into numbers
    lines.push(`${k}: ${Array.isArray(v) ? `[${v.map((x) => JSON.stringify(String(x))).join(', ')}]` : STRING_FIELDS.includes(k) ? JSON.stringify(String(v)) : v}`);
  }
  return lines.join('\n') + '\n';
}

export function validateState(s) {
  const errors = [];
  if (!s.task) errors.push('task is required');
  if (!STATUSES.includes(s.status)) errors.push(`status must be one of ${STATUSES.join(' | ')}`);
  if (s.status !== 'done' && !s.next_step) errors.push('next_step is required unless status is done');
  if (s.attempts !== undefined && !Number.isInteger(s.attempts)) errors.push('attempts must be an integer');
  return errors;
}

// tasks: [{id, tag, title}] parsed from tasks.md; states: {id: stateObj} read from the default branch.
export function parseTasks(markdown) {
  return [...markdown.matchAll(/^###\s+(\d+)\.\s+\[([^\]]+)\]\s+(.+)$/gm)].map((m) => ({ id: m[1], tag: m[2], title: m[3].trim() }));
}

export function deriveStatus(tasks, states) {
  const rows = tasks.map((t) => ({ ...t, status: states[t.id]?.status ?? 'todo' }));
  const done = rows.filter((r) => r.status === 'done').length;
  const next = rows.find((r) => r.status !== 'done');
  return {
    total: rows.length, done, blocked: rows.filter((r) => r.status === 'blocked').map((r) => r.id),
    next: next ? next.id : null, complete: rows.length > 0 && done === rows.length, rows,
  };
}

// queue.md: one table row per feature, in run order. /flow-intake writes it; /flow-run takes the next row.
export const QUEUE_STATUSES = ['draft', 'approved', 'running', 'blocked', 'done'];

export function parseQueue(markdown) {
  const rows = [];
  for (const line of markdown.split('\n')) {
    if (!/^\|/.test(line) || /^\|\s*-/.test(line) || /^\|\s*Slug\s*\|/i.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 4 || !cells[0]) continue;
    const depends = cells[2] && cells[2] !== '-' ? cells[2].split(',').map((d) => d.trim()).filter(Boolean) : [];
    rows.push({ slug: cells[0], status: cells[1], depends_on: depends, requirement: cells.slice(3).join(' | ') });
  }
  return rows;
}

// A running feature resumes first; otherwise the first approved feature whose dependencies are all done.
export function nextInQueue(rows) {
  const problems = [];
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  for (const r of rows) {
    if (!QUEUE_STATUSES.includes(r.status)) problems.push(`${r.slug}: status must be one of ${QUEUE_STATUSES.join(' | ')}`);
    for (const d of r.depends_on) if (!bySlug.has(d)) problems.push(`${r.slug}: depends on unknown feature ${d}`);
  }
  const ready = (r) => r.depends_on.every((d) => bySlug.get(d)?.status === 'done');
  const next = rows.find((r) => r.status === 'running') ?? rows.find((r) => r.status === 'approved' && ready(r)) ?? null;
  const waiting = rows.filter((r) => r.status === 'approved' && !ready(r)).map((r) => r.slug);
  return {
    next: next?.slug ?? null, problems, waiting_on_dependencies: waiting,
    blocked: rows.filter((r) => r.status === 'blocked').map((r) => r.slug),
    drafts: rows.filter((r) => r.status === 'draft').map((r) => r.slug),
    complete: rows.length > 0 && rows.every((r) => r.status === 'done'), rows,
  };
}

export function setQueueStatus(markdown, slug, status) {
  if (!QUEUE_STATUSES.includes(status)) throw new Error(`status must be one of ${QUEUE_STATUSES.join(' | ')}`);
  let found = false;
  const out = markdown.split('\n').map((line) => {
    const cells = line.split('|');
    if (cells.length < 6 || cells[1].trim() !== slug) return line;
    found = true;
    cells[2] = ` ${status} `;
    return cells.join('|');
  });
  if (!found) throw new Error(`no queue row for ${slug}`);
  return out.join('\n');
}

// FLOW_DIR points at the shared data directory.
const ROOT = flowDir(null);
const dir = (slug, id) => join(ROOT, 'active', slug, 'tasks', id);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, slug, id, ...rest] = process.argv.slice(2);
  if (cmd === 'write') {
    mkdirSync(dir(slug, id), { recursive: true });
    const f = `${dir(slug, id)}/state.md`;
    const cur = existsSync(f) ? parseState(readFileSync(f, 'utf8')) : { task: id, status: 'todo' };
    for (const kv of rest) {
      const i = kv.indexOf('='); const k = kv.slice(0, i); let v = kv.slice(i + 1);
      if (!FIELDS.includes(k)) { console.error(`unknown field ${k}`); process.exit(2); }
      cur[k] = k === 'steps_done' ? v.split(',').filter(Boolean) : k === 'attempts' ? Number(v) : v;
    }
    const errs = validateState(cur);
    if (errs.length) { console.error(errs.join('\n')); process.exit(3); }
    writeFileSync(f, serializeState(cur));
  } else if (cmd === 'read') {
    console.log(JSON.stringify(parseState(readFileSync(`${dir(slug, id)}/state.md`, 'utf8')), null, 2));
  } else if (cmd === 'ask') {
    const q = rest[0]; const oi = rest.indexOf('--options');
    mkdirSync(dir(slug, id), { recursive: true });
    const qf = `${dir(slug, id)}/questions.md`;
    const n = existsSync(qf) ? (readFileSync(qf, 'utf8').match(/^## Q\d+/gm) ?? []).length + 1 : 1;
    appendFileSync(qf, `## Q${n}\n${q}\n${oi >= 0 ? `options: ${rest[oi + 1]}\n` : ''}answer:\n\n`);
    const f = `${dir(slug, id)}/state.md`;
    const cur = existsSync(f) ? parseState(readFileSync(f, 'utf8')) : { task: id };
    writeFileSync(f, serializeState({ ...cur, status: 'blocked', next_step: cur.next_step ?? 'answer questions.md', questions: 'questions.md' }));
  } else if (cmd === 'status') {
    const base = join(ROOT, 'active', slug);
    const tasks = parseTasks(readFileSync(join(base, 'tasks.md'), 'utf8'));
    const states = {};
    const td = join(base, 'tasks');
    if (existsSync(td)) for (const d of readdirSync(td)) { const f = join(td, d, 'state.md'); if (existsSync(f)) states[d] = parseState(readFileSync(f, 'utf8')); }
    console.log(JSON.stringify(deriveStatus(tasks, states), null, 2));
  } else if (cmd === 'queue') {
    const qf = join(ROOT, 'queue.md');
    if (!existsSync(qf)) { console.error(`no queue: ${qf} (run /flow-intake)`); process.exit(3); }
    if (slug) {
      try { writeFileSync(qf, setQueueStatus(readFileSync(qf, 'utf8'), slug, id)); } catch (e) { console.error(e.message); process.exit(3); }
    }
    const r = nextInQueue(parseQueue(readFileSync(qf, 'utf8')));
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.problems.length ? 3 : 0);
  } else { console.error('usage: flow-state.js write|read|ask|status|queue'); process.exit(2); }
}
