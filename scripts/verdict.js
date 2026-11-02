#!/usr/bin/env node
// Verdict validation + severity policy.
//   node verdict.js <verdict.json>                       -> prints {action, ...}; exit 0 pass/ask/log, 1 retry, 3 invalid
//   node verdict.js ci <base> [--branch <name>] [--head <ref>]   -> exit 0 when every task verdict is fresh and passing
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SEVERITIES = ['block', 'ask', 'log'];

export function validateVerdict(v) {
  const errors = [];
  if (!v || typeof v !== 'object') return ['verdict must be an object'];
  if (!['pass', 'fail'].includes(v.verdict)) errors.push('verdict must be "pass" or "fail"');
  if (!Array.isArray(v.violations)) errors.push('violations must be an array');
  else v.violations.forEach((x, i) => {
    if (!x.rule) errors.push(`violations[${i}].rule is required`);
    if (!x.file) errors.push(`violations[${i}].file is required`);
    if (!x.why) errors.push(`violations[${i}].why is required`);
    if (!SEVERITIES.includes(x.severity)) errors.push(`violations[${i}].severity must be block | ask | log`);
  });
  if (!errors.length) {
    const hasBlock = v.violations.some((x) => x.severity === 'block');
    if (v.verdict === 'pass' && hasBlock) errors.push('verdict "pass" contradicts a block violation');
    if (v.verdict === 'fail' && !hasBlock) errors.push('verdict "fail" needs at least one block violation');
  }
  return errors;
}

// -> { action: 'pass' | 'retry' | 'invalid', questions: Violation[], logged: Violation[], blocking: Violation[], errors }
export function applyPolicy(v) {
  const errors = validateVerdict(v);
  if (errors.length) return { action: 'invalid', errors, blocking: [], questions: [], logged: [] };
  const by = (s) => v.violations.filter((x) => x.severity === s);
  return { action: v.verdict === 'fail' ? 'retry' : 'pass', errors: [], blocking: by('block'), questions: by('ask'), logged: by('log') };
}

// Fixed severity of each finding category. The skills state the same lists.
export const FINDING_SEVERITY = {
  analyze: { block: ['contract', 'coverage', 'not_included'], ask: ['scope'], log: ['format'] },
  drift: { block: ['contradicts_spec'], ask: ['new_behavior'], log: ['rename', 'refactor'] },
};

// Classify a finding category for a kind of check (analyze | drift).
// Unknown categories fail SAFE: they block, because an unclassified finding is not known to be harmless.
export function classify(category, kind) {
  const buckets = FINDING_SEVERITY[kind];
  for (const s of SEVERITIES) if (buckets?.[s]?.includes(category)) return s;
  return 'block';
}

// A passing verdict only counts if no non-.flow/ file changed after the commit that was reviewed.
export function isFresh(verdict, changedSinceReviewed) {
  if (!verdict?.reviewed_commit) return { fresh: false, reason: 'verdict has no reviewed_commit' };
  const stale = changedSinceReviewed.filter((f) => !f.startsWith('.flow/'));
  return stale.length ? { fresh: false, reason: `code changed after review: ${stale.slice(0, 3).join(', ')}` } : { fresh: true };
}

// flow/<slug>/<id> -> the task folder whose verdict must exist. Other branch names return null.
export function taskDirForBranch(branch) {
  const m = String(branch ?? '').match(/^flow\/([^/]+)\/([^/]+)$/);
  return m ? `.flow/active/${m[1]}/tasks/${m[2]}` : null;
}

// CI: the branch's own task, and every task folder the PR touches, needs a fresh passing verdict.json.
// Files are read from git at `head`, so CI can judge a PR without checking out or running its code.
export function checkFeatureVerdicts(base, { branch = null, head = 'HEAD' } = {}) {
  const git = (...args) => spawnSync('git', args, { encoding: 'utf8' });
  const problems = [];
  const own = taskDirForBranch(branch);
  if (String(branch ?? '').startsWith('flow/') && !own) problems.push(`branch ${branch} must be named flow/<slug>/<id>`);
  const changed = git('diff', '--name-only', `${base}...${head}`).stdout.split('\n').filter(Boolean);
  const touched = changed.filter((f) => /^\.flow\/active\/[^/]+\/tasks\/[^/]+\//.test(f)).map((f) => f.split('/').slice(0, 5).join('/'));
  const dirs = [...new Set([...(own ? [own] : []), ...touched])];
  for (const d of dirs) {
    const shown = git('show', `${head}:${d}/verdict.json`);
    if (shown.status !== 0) { problems.push(`${d}: no verdict.json`); continue; }
    let v;
    try { v = JSON.parse(shown.stdout); } catch { problems.push(`${d}: verdict is invalid`); continue; }
    const r = applyPolicy(v);
    if (r.action !== 'pass') { problems.push(`${d}: verdict is ${r.action}`); continue; }
    const since = git('diff', '--name-only', `${v.reviewed_commit}..${head}`);
    if (since.status !== 0) { problems.push(`${d}: reviewed_commit ${v.reviewed_commit} not found`); continue; }
    const f = isFresh(v, since.stdout.split('\n').filter(Boolean));
    if (!f.fresh) problems.push(`${d}: ${f.reason}`);
  }
  return { ok: problems.length === 0, checked: dirs, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'ci') {
  const rest = process.argv.slice(3);
  const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : null; };
  const base = rest[0] && !rest[0].startsWith('--') ? rest[0] : 'origin/main';
  const head = opt('--head') ?? 'HEAD';
  const branch = opt('--branch') ?? (head === 'HEAD' ? spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).stdout.trim() : null);
  const r = checkFeatureVerdicts(base, { branch, head });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file] = process.argv.slice(2);
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch (e) {
    console.log(JSON.stringify({ action: 'invalid', errors: [`cannot read verdict: ${e.message}`] }));
    process.exit(3);
  }
  const r = applyPolicy(parsed);
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.action === 'invalid' ? 3 : r.action === 'retry' ? 1 : 0);
}
