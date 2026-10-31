#!/usr/bin/env node
// Task state lives in the repo, not in the session (so any harness can resume).
//   node flow-state.js write  <slug> <id> key=value ...    update state.md (creates it)
//   node flow-state.js read   <slug> <id>                   print state as JSON
//   node flow-state.js ask    <slug> <id> "question" [--options "a|b"]   append to questions.md, mark blocked
//   node flow-state.js status <slug>                        derive feature status from tasks.md + merged states
// A task branch writes ONLY tasks/<id>/{state,questions}.md. tasks.md is read-only during runs.
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from './lib/miniyaml.js';

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

// multi topology: the agent runs in a target worktree but state lives in the hub -> FLOW_ROOT=<hub path>
const ROOT = process.env.FLOW_ROOT ?? '.';
const dir = (slug, id) => `${ROOT}/.flow/active/${slug}/tasks/${id}`;

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
    const base = `${ROOT}/.flow/active/${slug}`;
    const tasks = parseTasks(readFileSync(`${base}/tasks.md`, 'utf8'));
    const states = {};
    const td = `${base}/tasks`;
    if (existsSync(td)) for (const d of readdirSync(td)) { const f = `${td}/${d}/state.md`; if (existsSync(f)) states[d] = parseState(readFileSync(f, 'utf8')); }
    console.log(JSON.stringify(deriveStatus(tasks, states), null, 2));
  } else { console.error('usage: flow-state.js write|read|ask|status'); process.exit(2); }
}
