#!/usr/bin/env node
// flow.js: the steps of flow-kit that must be exact. The orchestrator AI decides; this reports facts,
// enforces the caps and acts. Commands: status, launch, merge, sync (and _run, started by launch in Orca).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, copyFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS, isUnavailable } from './agents.js';

const SELF = fileURLToPath(import.meta.url);
const KIT = dirname(SELF);
export const DEFAULTS = JSON.parse(readFileSync(join(KIT, 'defaults.json'), 'utf8'));
export const ROLES = ['orchestrator', 'plan', 'implement', 'fix_retry', 'review', 'sync'];

// ---------- small helpers ----------
export function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
  if (r.error) throw r.error;
  return { code: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function must(cmd, args, opts) {
  const r = sh(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.code}): ${r.err || r.out}`);
  return r.out;
}
const json = (cmd, args, opts) => JSON.parse(must(cmd, args, opts) || 'null');
const git = (cwd, ...args) => sh('git', args, { cwd });

export function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const fm = {};
  if (m) for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const v = kv[2].trim();
    fm[kv[1]] = v.startsWith('[') ? v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean) : v;
  }
  return { fm, body: m ? text.slice(m[0].length) : text };
}

// ---------- config and state ----------
export function loadConfig(hub = process.env.FLOW_HUB || process.cwd()) {
  const file = join(hub, '.flow', 'flow.json');
  if (!existsSync(file)) throw new Error(`no .flow/flow.json in ${hub}; run /flow-init`);
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  cfg.hub = resolve(hub);
  Object.assign(cfg, resolveAgent(cfg, process.env.FLOW_AGENT));
  cfg.parallel ??= DEFAULTS.parallel;
  cfg.max_turns ??= DEFAULTS.max_turns;
  cfg.repos ??= {};
  for (const r of Object.values(cfg.repos)) { r.path = resolve(cfg.hub, r.path || '.'); r.default ??= 'main'; r.allow ??= []; }
  cfg.hubRepo = Object.values(cfg.repos).find(r => r.path === cfg.hub) ?? { path: cfg.hub, default: cfg.hub_default || 'main', github: cfg.hub_github, allow: [] };
  cfg.state = process.env.FLOW_STATE || join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'flow-kit', cfg.product || 'default');
  mkdirSync(join(cfg.state, 'runs'), { recursive: true });
  return cfg;
}

// One agent runs the whole flow. Only the review may run on another one ("review_agent"), so an independent
// model family checks the work. Each role has an ordered model list in its agent: the first is used, and the next
// only when a model is unavailable (limits, quota, outage). The legacy "models": { role: "model" } is Claude's.
export function resolveAgent(file, envAgent) {
  const agent = envAgent || file.agent || DEFAULTS.agent;
  const review_agent = file.review_agent || agent;
  for (const name of [agent, review_agent])
    if (!AGENTS[name]) throw new Error(`unknown agent "${name}"; known: ${Object.keys(AGENTS).join(', ')}`);
  let overrides = file.models || {};
  if (Object.keys(overrides).some(k => ROLES.includes(k))) overrides = { claude: overrides };
  const list = v => [v].flat().filter(Boolean);
  const agentOf = role => (role === 'review' ? review_agent : agent);
  const models = Object.fromEntries(ROLES.map(role => {
    const name = agentOf(role);
    return [role, list(overrides[name]?.[role] ?? DEFAULTS.models[name]?.[role])];
  }));
  const missing = ROLES.filter(r => !models[r].length);
  if (missing.length) throw new Error(`no model for: ${missing.map(r => `${agentOf(r)}/${r}`).join(', ')}; set them in .flow/flow.json "models"`);
  return { agent, review_agent, models };
}

export const agentFor = (cfg, role) => (role === 'review' ? cfg.review_agent || cfg.agent : cfg.agent);

export function logEvent(cfg, ev) {
  appendFileSync(join(cfg.state, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...ev }) + '\n');
}
const runDir = (cfg, id) => { const d = join(cfg.state, 'runs', id.replace(/\//g, '__')); mkdirSync(d, { recursive: true }); return d; };
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
export function runningPid(cfg, id) {
  const f = join(runDir(cfg, id), 'pid');
  if (!existsSync(f)) return null;
  const pid = Number(readFileSync(f, 'utf8'));
  return pid && alive(pid) ? pid : null;
}
function lastRun(cfg, id) {
  const f = join(runDir(cfg, id), 'last.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}

// ---------- reading the plan from the hub's default branch ----------
function readHubTree(cfg) {
  const { path, default: def } = cfg.hubRepo;
  git(path, 'fetch', '--quiet', 'origin', def);
  const ref = git(path, 'rev-parse', '--verify', '--quiet', `origin/${def}`).code === 0 ? `origin/${def}` : def;
  const files = git(path, 'ls-tree', '-r', '--name-only', ref, '.flow').out.split('\n').filter(Boolean);
  const show = f => must('git', ['show', `${ref}:${f}`], { cwd: path });
  const blob = f => must('git', ['rev-parse', `${ref}:${f}`], { cwd: path });
  return { files, show, blob };
}

export function readFeatures(tree) {
  const features = {};
  for (const f of tree.files) {
    const m = f.match(/^\.flow\/([^/]+)\/(spec\.md|plan-([\w-]+)\.md|tasks\/(\d+)-[\w.-]+\.md)$/);
    if (!m) continue;
    const feat = (features[m[1]] ??= { name: m[1], spec: null, plans: {}, tasks: {} });
    if (m[2] === 'spec.md') {
      const after = frontmatter(tree.show(f)).fm.after;
      feat.spec = { path: f, sha: tree.blob(f), after: [after ?? []].flat().filter(Boolean) };
    }
    else if (m[3]) feat.plans[m[3]] = { path: f, spec_sha: frontmatter(tree.show(f)).fm.spec_sha };
    else {
      const { fm, body } = frontmatter(tree.show(f));
      const title = (body.match(/^#\s+\d+\s+(.+)$/m) || [])[1] || f;
      feat.tasks[m[4]] = { id: `${m[1]}/${m[4]}`, nn: m[4], path: f, repo: fm.repo, depends: fm.depends || [], title };
    }
  }
  return features;
}

// ---------- PRs ----------
// Every AI comment carries this attribution line: `<sub>🤖 <skill> · <agent> · <model></sub>`.
export const AI_MARK = '<sub>🤖';
export const aiFooter = (skill, agent, model) => `<sub>🤖 ${[skill, agent, model].filter(Boolean).join(' · ')}</sub>`;
const isAiComment = body => (body || '').includes(AI_MARK) || REVIEW_RE.test(body || '') || (body || '').includes(ESCALATION_MARK);
export const REVIEW_RE = /<!--\s*flow-review sha=([0-9a-f]{7,40}) recommendation=(merge|fix|escalate)\s*-->/;
export const ESCALATION_MARK = '<!-- flow-escalation -->';

export function readPrFacts(pr, human) {
  const comments = pr.comments || [];
  // A fix round is a fix review on a new head: a review run again on the same commit is not another round.
  let review = null, escAt = -1;
  const fixShas = new Set();
  comments.forEach((c, i) => {
    const m = (c.body || '').match(REVIEW_RE);
    if (m) { review = { sha: m[1], recommendation: m[2] }; if (m[2] === 'fix') fixShas.add(m[1].slice(0, 7)); }
    if ((c.body || '').includes(ESCALATION_MARK)) escAt = i;
  });
  const fixRounds = fixShas.size;
  // AI comments are posted from the human's gh login too, so only an unattributed comment is the human's reply.
  const replied = escAt >= 0 && comments.slice(escAt + 1).some(c => !isAiComment(c.body) && (!human || c.author?.login === human));
  const head = pr.headRefOid;
  return {
    number: pr.number, state: pr.state, draft: pr.isDraft, mergeable: pr.mergeable, head, url: pr.url,
    review: review && { ...review, current: !!head && head.startsWith(review.sha) },
    fix_rounds: fixRounds,
    escalation: escAt >= 0 ? { open: !replied, replied } : null,
    replies: escAt >= 0 ? comments.slice(escAt + 1).map(c => ({ author: c.author?.login, body: c.body })) : [],
  };
}

function listPrs(repo) {
  if (!repo.github) return [];
  return json('gh', ['pr', 'list', '-R', repo.github, '--state', 'all', '--limit', '200',
    '--json', 'number,headRefName,state,isDraft,mergeable,headRefOid,url,comments']) || [];
}

export function checksState(repo, number) {
  const r = sh('gh', ['pr', 'checks', String(number), '-R', repo.github, '--json', 'name,bucket']);
  if (r.code !== 0 && !r.out) return /no checks/i.test(r.err) ? 'none' : 'unknown';
  const checks = JSON.parse(r.out || '[]');
  if (!checks.length) return 'none';
  if (checks.some(c => c.bucket === 'fail' || c.bucket === 'cancel')) return 'fail';
  if (checks.some(c => c.bucket === 'pending')) return 'pending';
  return 'pass';
}

// ---------- status ----------
export function deriveState(t) {
  if (t.pr?.state === 'MERGED') return 'merged';
  if (t.running) return 'running';
  if (t.pr?.escalation?.open) return 'escalated';
  if (t.pr?.escalation?.replied && !t.pr.review?.current) return 'human-replied';
  if (t.pr?.state === 'OPEN' && t.pr.mergeable === 'CONFLICTING') return 'conflicting';
  if (t.last_run?.status === 'question') return 'question';
  if (t.last_run?.status === 'failed' || t.last_run?.status === 'error') return 'failed';
  if (t.pr?.state === 'OPEN') return t.pr.review?.current ? `review-${t.pr.review.recommendation}` : 'needs-review';
  if (t.kind === 'plan') return t.blocked ? 'blocked' : 'ready';
  if (!t.plan_current) return 'needs-plan';
  return t.deps_merged ? 'ready' : 'waiting-deps';
}

export function buildStatus(cfg, { tree = readHubTree(cfg), prsByRepo, pid = id => runningPid(cfg, id), last = id => lastRun(cfg, id), checks = checksState } = {}) {
  const features = readFeatures(tree);
  prsByRepo ??= Object.fromEntries(Object.entries({ ...cfg.repos, __hub: cfg.hubRepo }).map(([k, r]) => [k, listPrs(r)]));
  const prFor = (repoKey, branch) => (prsByRepo[repoKey] || []).filter(p => p.headRefName === branch).sort((a, b) => b.number - a.number)[0];
  const out = { product: cfg.product, parallel: cfg.parallel, running: 0, features: [] };
  const isCurrent = f => { const plans = Object.values(f.plans); return plans.length > 0 && plans.every(p => p.spec_sha === f.spec?.sha); };
  // A feature is complete when its plan is current and every one of its tasks is merged. `after:` waits on that.
  const complete = name => {
    const f = features[name];
    const tasks = f ? Object.values(f.tasks) : [];
    return !!f?.spec && isCurrent(f) && tasks.length > 0
      && tasks.every(t => prFor(t.repo, `flow/${f.name}/${t.nn}`)?.state === 'MERGED');
  };
  for (const f of Object.values(features)) {
    if (!f.spec) continue;
    const plans = Object.values(f.plans);
    const planCurrent = isCurrent(f);
    const blockedBy = f.spec.after.filter(name => !complete(name));
    const feature = { name: f.name, spec: f.spec.path, after: f.spec.after, planned: plans.length > 0, plan_current: planCurrent, spec_stale: plans.length > 0 && !planCurrent, items: [] };
    const planId = `${f.name}/plan`;
    const planPr = prFor('__hub', `flow/${f.name}/plan`);
    if (!planCurrent || (planPr && planPr.state === 'OPEN')) {
      const item = { id: planId, kind: 'plan', repo: '__hub', running: !!pid(planId), last_run: last(planId), pr: planPr ? readPrFacts(planPr, cfg.human) : null,
        blocked: blockedBy.length > 0, blocked_by: blockedBy };
      if (item.pr?.state === 'OPEN') item.pr.checks = checks(cfg.hubRepo, item.pr.number);
      item.state = deriveState(item);
      feature.items.push(item);
    }
    const merged = nn => prFor(f.tasks[nn]?.repo, `flow/${f.name}/${nn}`)?.state === 'MERGED';
    for (const t of Object.values(f.tasks).sort((a, b) => a.nn.localeCompare(b.nn))) {
      const pr = prFor(t.repo, `flow/${f.name}/${t.nn}`);
      const item = { ...t, kind: 'task', running: !!pid(t.id), last_run: last(t.id), plan_current: planCurrent,
        deps_merged: t.depends.every(merged), pr: pr ? readPrFacts(pr, cfg.human) : null };
      if (item.pr?.state === 'OPEN' && cfg.repos[t.repo]) item.pr.checks = checks(cfg.repos[t.repo], item.pr.number);
      item.state = deriveState(item);
      feature.items.push(item);
    }
    out.running += feature.items.filter(i => i.running).length;
    out.features.push(feature);
  }
  return out;
}

export function statusHash(status) {
  const strip = JSON.parse(JSON.stringify(status), (k, v) => (k === 'at' ? undefined : v));
  return createHash('sha256').update(JSON.stringify(strip)).digest('hex');
}

function cmdStatus(cfg, flags) {
  const status = buildStatus(cfg);
  const hash = statusHash(status);
  const seenFile = join(cfg.state, 'seen.sha');
  const seen = existsSync(seenFile) ? readFileSync(seenFile, 'utf8') : '';
  const changed = hash !== seen;
  if (flags.has('--changed-exit')) process.exit(changed ? 0 : 1);
  if (flags.has('--log')) return printLog(cfg, flags.get('--task'));
  if (flags.has('--json')) {
    return console.log(JSON.stringify({ changed, ...status }, null, 1));
  }
  console.log(`${status.product}: ${status.running}/${status.parallel} running`);
  for (const f of status.features) {
    console.log(`\n${f.name}${f.spec_stale ? '  (spec changed: re-plan)' : ''}`);
    for (const i of f.items) console.log(`  ${i.id.padEnd(28)} ${i.state.padEnd(15)} ${i.pr ? `#${i.pr.number}` : ''} ${i.title || ''}`);
  }
}

function printLog(cfg, task) {
  const file = join(cfg.state, 'events.jsonl');
  if (!existsSync(file)) return console.log('no events yet');
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const e = JSON.parse(line);
    if (task && e.id !== task) continue;
    console.log(`${e.at.slice(0, 19)}  ${(e.id || '').padEnd(24)} ${(e.action || '').padEnd(10)} ${e.detail || ''}${e.session_id ? `  session=${e.session_id}` : ''}`);
  }
}

// ---------- launch ----------
export function checkLaunch(cfg, status, id, mode) {
  const item = status.features.flatMap(f => f.items).find(i => i.id === id);
  if (!item) return `unknown ${mode === 'plan' ? 'feature without a pending plan' : 'task'}: ${id}`;
  if (item.running) return `${id} is already running`;
  if (status.running >= cfg.parallel) return `parallel limit reached (${status.running}/${cfg.parallel})`;
  if (item.state === 'merged') return `${id} is already merged`;
  if (item.kind === 'plan' && item.blocked && !item.pr) return `${id}: waiting for features to complete (${item.blocked_by.join(', ')})`;
  if (item.kind === 'task' && !item.plan_current) return `${id}: the plan does not match the current spec; re-plan first`;
  if (item.kind === 'task' && !item.deps_merged && !item.pr) return `${id}: dependencies not merged (${item.depends.join(', ')})`;
  if (mode === 'review' && !item.pr) return `${id}: no PR to review`;
  const role = roleFor(item, mode);
  if (!modelsFor(cfg, role).length) return `every ${agentFor(cfg, role)} model for ${role} is excluded by model_policy`;
  return null;
}

export function roleFor(item, mode) {
  if (mode === 'review') return 'review';
  if (item.kind === 'plan') return 'plan';
  return mode === 'fix' && (item.pr?.fix_rounds ?? 0) >= 2 ? 'fix_retry' : 'implement';
}

export const modelsFor = (cfg, role) => cfg.models[role].filter(m => !(cfg.model_policy?.deny || []).includes(m));

const ORCA = () => process.env.ORCA_CLI_COMMAND || 'orca';

// Orca's JSON wraps results as { ok, result: { worktrees: [{ path, branch: 'refs/heads/...' }] } }.
function findWorktree(branch) {
  const r = sh(ORCA(), ['worktree', 'list', '--json']);
  if (r.code !== 0) return null;
  const all = JSON.parse(r.out || '{}')?.result?.worktrees || [];
  return all.find(w => w.branch === `refs/heads/${branch}` || w.branch === branch) || null;
}

function ensureWorktree(cfg, repo, branch, name) {
  const found = findWorktree(branch);
  if (found) return found.path;
  // Orca creates worktrees only for registered repos; adding an already registered repo is harmless.
  sh(ORCA(), ['repo', 'add', '--path', repo.path, '--json']);
  git(repo.path, 'fetch', '--quiet', 'origin');
  const remoteHas = git(repo.path, 'ls-remote', '--exit-code', '--heads', 'origin', branch).code === 0;
  const args = ['worktree', 'create', '--repo', `path:${repo.path}`, '--name', name, '--branch', branch, '--setup', 'skip', '--no-parent', '--json'];
  args.push('--base-branch', remoteHas ? `origin/${branch}` : `origin/${repo.default}`);
  must(ORCA(), args);
  const path = findWorktree(branch)?.path;
  if (!path) throw new Error(`orca worktree create left no worktree for ${branch}`);
  return path;
}

function cmdLaunch(cfg, id, flags) {
  const mode = flags.has('--plan') ? 'plan' : flags.has('--fix') ? 'fix' : flags.has('--review') ? 'review' : 'implement';
  const fullId = mode === 'plan' ? `${id}/plan` : id;
  const status = buildStatus(cfg);
  const refusal = checkLaunch(cfg, status, fullId, mode);
  if (refusal) { logEvent(cfg, { id: fullId, action: 'refused', detail: refusal }); console.log(`refused: ${refusal}`); process.exit(2); }
  const item = status.features.flatMap(f => f.items).find(i => i.id === fullId);
  const repo = item.kind === 'plan' ? cfg.hubRepo : cfg.repos[item.repo];
  const branch = item.kind === 'plan' ? `flow/${id}/plan` : `flow/${id}`;
  const wt = ensureWorktree(cfg, repo, branch, branch.replace(/\//g, '-'));
  logEvent(cfg, { id: fullId, action: 'launch', detail: `${mode} in ${wt}` });
  // `; exit` closes the shell, so the Orca terminal ends with the run (spike: without it the terminal stays open).
  must(ORCA(), ['terminal', 'create', '--worktree', `path:${wt}`, '--title', `flow ${fullId} ${mode}`,
    '--command', `node ${JSON.stringify(SELF)} _run ${fullId} ${mode} --hub ${JSON.stringify(cfg.hub)}; exit`, '--json']);
  console.log(`launched ${fullId} (${mode}) in ${wt}`);
}

// ---------- _run: the chain inside the Orca terminal ----------
export function parseResult(text) {
  const all = [...String(text || '').matchAll(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g)];
  for (let i = all.length - 1; i >= 0; i--) { try { const o = JSON.parse(all[i][0]); if (o.status) return o; } catch {} }
  return { status: 'failed', reason: 'the run did not end with a result object' };
}

// Headless runs do not load user-level skills, so the skill text is the prompt, on every agent.
export function skillPrompt(skill, args) {
  const text = readFileSync(join(KIT, '..', skill, 'SKILL.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
  return `${text.trim()}\n\n## Arguments\n${args}\n`;
}

// Settings are generated per run from the templates in settings/, so they can name this flow.js and the repo's own commands.
export function buildSettings(role, { flowJs = SELF, allow = [] } = {}) {
  const tpl = readFileSync(join(KIT, 'settings', `${role}.json`), 'utf8').replaceAll('__FLOW_JS__', flowJs);
  const settings = JSON.parse(tpl);
  settings.permissions.allow.push(...allow);
  return settings;
}

// One headless run of a skill. `access` picks the permission template; `role` picks the model list. On an unavailable
// model, the same run goes to the role's next model in the same agent. Any other failure is the run's result.
export function runAgent(cfg, { cwd, access, role, skill, args, dir, kind, allow = [], mcpConfig }, agents = AGENTS) {
  const name = agentFor(cfg, role);
  const agent = agents[name];
  const settings = buildSettings(access, { allow });
  const tried = [];
  for (const model of modelsFor(cfg, role)) {
    const r = agent.run({ cwd, prompt: skillPrompt(skill, `${args}\nrun by: ${name} · ${model}`), model, settings, dir, kind, maxTurns: cfg.max_turns,
      env: { ...process.env, FLOW_HUB: cfg.hub }, dirs: [dir, cfg.hub], mcpConfig });
    const meta = { agent: name, model, denials: (r.denials || []).slice(0, 10), session_id: r.sessionId, usage: r.usage, transcript: r.transcript };
    if (isUnavailable(r)) { tried.push(`${model}: ${String(r.error).slice(0, 120)}`); continue; }
    const result = r.isError ? { status: 'error', reason: String(r.error).slice(0, 500) } : parseResult(r.text);
    return { ...result, ...meta, ...(tried.length ? { fallback_from: tried } : {}) };
  }
  return { status: 'error', reason: `no ${name} model available for ${role}: ${tried.join(' | ') || 'all excluded'}`.slice(0, 500), agent: name, denials: [] };
}

function ghPr(repo, branch) {
  const r = sh('gh', ['pr', 'view', branch, '-R', repo.github, '--json', 'number,state,isDraft']);
  return r.code === 0 ? JSON.parse(r.out) : null;
}

function cmdRun(cfg, id, mode) {
  const dir = runDir(cfg, id);
  writeFileSync(join(dir, 'pid'), String(process.pid));
  const isPlan = id.endsWith('/plan');
  const [feature, nn] = id.split('/');
  const tree = readHubTree(cfg);
  const feat = readFeatures(tree)[feature];
  const task = isPlan ? null : feat.tasks[nn];
  const repo = isPlan ? cfg.hubRepo : cfg.repos[task.repo];
  const wt = process.cwd();
  const branch = isPlan ? `flow/${feature}/plan` : `flow/${id}`;
  const ev = (action, extra = {}) => logEvent(cfg, { id, action, ...extra });
  const bodyFile = join(dir, 'pr-body.md');
  let result = { status: 'done' };
  try {
    if (mode !== 'review') {
      git(wt, 'fetch', '--quiet', 'origin');
      const merge = git(wt, 'merge', '--no-edit', `origin/${repo.default}`);
      ev('sync', { detail: merge.code === 0 ? 'merged main' : 'merge conflict left for the agent' });
      if (repo.env_file && !existsSync(join(wt, repo.env_file)) && existsSync(join(repo.path, repo.env_file)))
        copyFileSync(join(repo.path, repo.env_file), join(wt, repo.env_file));
      const pr0 = ghPr(repo, branch);
      const item = { kind: isPlan ? 'plan' : 'task', pr: pr0 && readPrFacts({ ...pr0, comments: [] }) };
      if (mode === 'fix' && pr0) item.pr.fix_rounds = readPrFacts(json('gh', ['pr', 'view', String(pr0.number), '-R', repo.github, '--json', 'comments,headRefOid,number,state'])).fix_rounds;
      const role = roleFor(item, mode);
      rmSync(bodyFile, { force: true });
      // The hub checkout can lag origin (a plan PR just merged), so a task reads its feature folder as merged on origin.
      const hubCopy = join(dir, 'hub');
      if (!isPlan) for (const f of tree.files.filter(f => f.startsWith(`.flow/${feature}/`))) {
        mkdirSync(dirname(join(hubCopy, f)), { recursive: true });
        writeFileSync(join(hubCopy, f), tree.show(f));
      }
      const args = isPlan ? `feature: ${feature}\npr body: ${bodyFile}` : `task file: ${join(hubCopy, task.path)}\nhub path of the task: ${task.path}\nmode: ${mode}\npr body: ${bodyFile}`;
      result = runAgent(cfg, { cwd: wt, access: 'worker', role, skill: isPlan ? 'flow-plan' : 'flow-task', args, dir, kind: mode, allow: repo.allow });
      ev(mode, { detail: `${result.agent}/${result.model}: ${result.status}${result.reason ? ` (${result.reason})` : ''}${result.denials.length ? ` denied: ${result.denials.join(' | ')}` : ''}`, session_id: result.session_id, usage: result.usage });
      if (result.decisions?.length) appendFileSync(join(dir, 'decisions.md'), result.decisions.map(d => `- ${d}`).join('\n') + '\n');
      const ahead = git(wt, 'rev-list', '--count', `origin/${repo.default}..HEAD`).out;
      if (Number(ahead) > 0 && git(wt, 'diff', '--name-only', '--diff-filter=U').out === '') {
        must('git', ['push', '-u', 'origin', `HEAD:${branch}`], { cwd: wt });
        ev('push', { detail: git(wt, 'rev-parse', '--short', 'HEAD').out });
        const body = existsSync(bodyFile) ? bodyFile : null;
        let pr = ghPr(repo, branch);
        if (!pr) {
          // Repos title PRs as conventional commits: the branch's first conventional commit subject is the title.
          const conventional = git(wt, 'log', '--no-merges', '--reverse', '--format=%s', `origin/${repo.default}..HEAD`).out
            .split('\n').find(s => /^[a-z]+(\([\w./-]+\))?!?: \S/.test(s));
          const title = isPlan ? `docs(flow): plan ${feature}`
            : conventional || `feat: ${task.title.charAt(0).toLowerCase()}${task.title.slice(1)}`;
          const args = ['pr', 'create', '-R', repo.github, '--draft', '--head', branch, '--base', repo.default, '--title', title];
          if (body) args.push('--body-file', body); else args.push('--body', isPlan ? `Plan for \`.flow/${feature}/spec.md\`.` : `Task: ${task.path}`);
          must('gh', args, { cwd: wt });
          pr = ghPr(repo, branch);
          ev('pr', { detail: `opened #${pr?.number}` });
        } else if (body) must('gh', ['pr', 'edit', String(pr.number), '-R', repo.github, '--body-file', body], { cwd: wt });
        if (result.status === 'question' && pr)
          must('gh', ['pr', 'comment', String(pr.number), '-R', repo.github, '--body', `**Question from the implementer:** ${result.question}\n\n${(result.options || []).map(o => `- ${o}`).join('\n')}\n\nRecommended: ${result.recommended || 'none'}\n\n${aiFooter('flow-task', result.agent, result.model)}`]);
      }
    }
    if (result.status === 'done' && ghPr(repo, branch)) {
      const number = ghPr(repo, branch).number;
      const args = `pr: ${number}\nrepo: ${repo.github}\nreview comment file: ${join(dir, 'review.md')}\npr body file: ${join(dir, 'pr-body-reviewed.md')}`;
      const r = runAgent(cfg, { cwd: wt, access: 'worker', role: 'review', skill: 'flow-review', args, dir, kind: 'review', allow: repo.allow });
      ev('review', { detail: `${r.agent}/${r.model}: ${r.recommendation || r.status}`, session_id: r.session_id, usage: r.usage });
      if (r.status !== 'done') result = r;
    }
  } catch (e) {
    result = { status: 'error', reason: String(e.message).slice(0, 500) };
    ev('error', { detail: result.reason });
  } finally {
    writeFileSync(join(dir, 'last.json'), JSON.stringify({ mode, ...result, at: new Date().toISOString() }));
    rmSync(join(dir, 'pid'), { force: true });
  }
}

// ---------- tick: one orchestrator pass, headless, with the orchestrator's settings ----------
function cmdTick(cfg, flags) {
  const lock = join(cfg.state, 'tick.pid');
  if (existsSync(lock) && alive(Number(readFileSync(lock, 'utf8')))) return console.log('a tick is already running');
  // Only a finished tick marks a state as seen. Reading the status (by the sync agent, or a person) must not
  // consume the change, or the orchestrator would never act on it.
  const seenFile = join(cfg.state, 'seen.sha');
  const hash = statusHash(buildStatus(cfg));
  const changed = hash !== (existsSync(seenFile) ? readFileSync(seenFile, 'utf8') : '');
  if (!changed && !flags.has('--force')) return console.log('nothing changed');
  writeFileSync(lock, String(process.pid));
  try {
    const dir = runDir(cfg, 'orchestrator');
    // --force must reach the orchestrator too: its first rule is to stop when status says changed: false, so a
    // forced tick has to tell it to act anyway (the unstick path after a tick that consumed the signal wrongly).
    const forced = flags.has('--force') ? '\nforce: this tick was forced; act even when status says changed: false' : '';
    const args = `flow.js: node ${SELF}\nhub: ${cfg.hub}\nhuman: ${cfg.human || 'the repo owner'}\nrepos: ${JSON.stringify(Object.fromEntries(Object.entries(cfg.repos).map(([k, r]) => [k, r.github])))}${forced}`;
    const r = runAgent(cfg, { cwd: cfg.hub, access: 'orchestrator', role: 'orchestrator', skill: 'flow-orchestrate', args, dir, kind: 'tick' });
    logEvent(cfg, { id: 'orchestrator', action: 'tick', detail: `${r.agent}/${r.model}: ${r.summary || r.reason || r.status}`, session_id: r.session_id, usage: r.usage });
    console.log(r.summary || r.reason || r.status);
    if (r.status !== 'error') writeFileSync(seenFile, hash);
    if (cfg.tracker) cmdSync(cfg);
  } finally {
    rmSync(lock, { force: true });
  }
}

// ---------- sync: mirror the flow to the issue tracker, one way ----------
// The tracker is a mirror, never a source: the sync agent reads the hub and writes only the tracker, through its MCP server.
export function syncPlan(cfg) {
  const t = cfg.tracker;
  if (!t) throw new Error('no tracker in .flow/flow.json');
  if (t.kind !== 'linear') throw new Error(`tracker kind ${t.kind} is not supported (only linear)`);
  const mcp = resolve(cfg.hub, t.mcp_config || '.mcp.json');
  const hub = cfg.hubRepo;
  const args = `flow.js: node ${SELF}\nhub: ${cfg.hub}\nhub github: ${hub.github || 'unknown'}\nhub default: ${hub.default}\n`
    + `tracker: ${JSON.stringify({ team: t.team, states: t.states || {} })}`;
  return { args, mcpConfig: mcp };
}

function cmdSync(cfg) {
  const { args, mcpConfig } = syncPlan(cfg);
  const r = runAgent(cfg, { cwd: cfg.hub, access: 'tracker', role: 'sync', skill: 'flow-sync', args, dir: runDir(cfg, 'tracker'), kind: 'sync', mcpConfig });
  logEvent(cfg, { id: 'tracker', action: 'sync', detail: `${r.agent}/${r.model}: ${r.summary || r.reason || r.status}`, session_id: r.session_id, usage: r.usage });
  console.log(`sync: ${r.summary || r.reason || r.status}`);
}

// ---------- merge ----------
export function checkMerge(prFacts, checks) {
  if (prFacts.state !== 'OPEN') return `PR is ${prFacts.state}`;
  if (!prFacts.review) return 'no review';
  if (!prFacts.review.current) return `review is for ${prFacts.review.sha}, head is ${prFacts.head}`;
  if (prFacts.review.recommendation !== 'merge') return `review recommends ${prFacts.review.recommendation}`;
  if (prFacts.escalation?.open) return 'an escalation is waiting for the human';
  if (prFacts.mergeable === 'CONFLICTING') return 'PR has conflicts';
  if (checks === 'fail' || checks === 'pending' || checks === 'unknown') return `CI is ${checks}`;
  return null;
}

function cmdMerge(cfg, repoKey, number) {
  const repo = repoKey === 'hub' ? cfg.hubRepo : cfg.repos[repoKey];
  if (!repo?.github) throw new Error(`unknown repo ${repoKey}`);
  const pr = json('gh', ['pr', 'view', String(number), '-R', repo.github, '--json', 'number,state,isDraft,mergeable,headRefOid,headRefName,url,comments']);
  const facts = readPrFacts(pr, cfg.human);
  const checks = checksState(repo, number);
  const refusal = checkMerge(facts, checks);
  const id = pr.headRefName.replace(/^flow\//, '');
  if (refusal) { logEvent(cfg, { id, action: 'refused', detail: `merge #${number}: ${refusal}` }); console.log(`refused: ${refusal}`); process.exit(2); }
  if (pr.isDraft) must('gh', ['pr', 'ready', String(number), '-R', repo.github]);
  must('gh', ['pr', 'merge', String(number), '-R', repo.github, '--squash', '--delete-branch', '--match-head-commit', pr.headRefOid]);
  logEvent(cfg, { id, action: 'merge', detail: `#${number} at ${pr.headRefOid.slice(0, 7)}` });
  recordDecisions(cfg, id);
  removeWorktree(pr.headRefName);
  console.log(`merged #${number}`);
}

function recordDecisions(cfg, id) {
  const file = join(runDir(cfg, id), 'decisions.md');
  if (!existsSync(file) || id.endsWith('/plan')) return;
  const [feature, nn] = id.split('/');
  const hub = cfg.hubRepo.path;
  git(hub, 'pull', '--ff-only', '--quiet');
  const dir = join(hub, '.flow', feature, 'tasks');
  const taskFile = existsSync(dir) && readdirSync(dir).find(f => f.startsWith(`${nn}-`));
  if (!taskFile) return;
  const path = join(dir, taskFile);
  const text = readFileSync(path, 'utf8');
  writeFileSync(path, `${text.trimEnd()}\n${text.includes('\n## Decisions') ? '' : '\n## Decisions\n'}${readFileSync(file, 'utf8')}`);
  must('git', ['commit', '-q', '-m', `docs(flow): decisions ${id}`, '--', path], { cwd: hub });
  must('git', ['push', '-q', 'origin', `HEAD:${cfg.hubRepo.default}`], { cwd: hub });
  rmSync(file);
}

function removeWorktree(branch) {
  const wt = findWorktree(branch);
  if (wt) sh(ORCA(), ['worktree', 'rm', '--worktree', `path:${wt.path}`, '--force', '--delete-branch', '--json']);
}

// ---------- CLI ----------
function parseFlags(argv) {
  const flags = new Map();
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags.set(argv[i], argv[i + 1] && !argv[i + 1].startsWith('--') && ['--task', '--hub'].includes(argv[i]) ? argv[++i] : true);
    else pos.push(argv[i]);
  }
  return { flags, pos };
}

if (process.argv[1] === SELF) {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, pos } = parseFlags(rest);
  try {
    const cfg = loadConfig(flags.get('--hub') || undefined);
    if (cmd === 'status') cmdStatus(cfg, flags);
    else if (cmd === 'tick') cmdTick(cfg, flags);
    else if (cmd === 'launch' && pos[0]) cmdLaunch(cfg, pos[0], flags);
    else if (cmd === 'merge' && pos[1]) cmdMerge(cfg, pos[0], pos[1]);
    else if (cmd === 'sync') cmdSync(cfg);
    else if (cmd === '_run' && pos[1]) cmdRun(cfg, pos[0], pos[1]);
    else {
      console.error('usage: flow.js tick [--force] | status [--json|--changed-exit|--log [--task <id>]] | launch <feature>/<NN> [--fix|--review] | launch <feature> --plan | merge <repo|hub> <pr> | sync');
      process.exit(64);
    }
  } catch (e) {
    console.error(`flow.js: ${e.message}`);
    process.exit(1);
  }
}
