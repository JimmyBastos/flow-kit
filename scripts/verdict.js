#!/usr/bin/env node
// Verdict validation + severity policy.
//   node verdict.js <verdict.json> [flow.config.yaml]   -> prints {action, ...}; exit 0 pass/ask/log, 1 retry, 3 invalid
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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

// Classify a finding category (analyze/drift) with the configured severity buckets.
// Unknown categories fail SAFE: they block, because an unclassified finding is not known to be harmless.
export function classify(category, buckets) {
  for (const s of SEVERITIES) if (buckets?.[s]?.includes(category)) return s;
  return 'block';
}

// A passing verdict only counts if no non-.flow/ file changed after the commit that was reviewed.
export function isFresh(verdict, changedSinceReviewed) {
  if (!verdict?.reviewed_commit) return { fresh: false, reason: 'verdict has no reviewed_commit' };
  const stale = changedSinceReviewed.filter((f) => !f.startsWith('.flow/'));
  return stale.length ? { fresh: false, reason: `code changed after review: ${stale.slice(0, 3).join(', ')}` } : { fresh: true };
}

// CI: every task state.md marked done on this PR must have a fresh passing verdict.json next to it.
function checkFeatureVerdicts(base) {
  const changed = spawnSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const dirs = [...new Set(changed.filter((f) => /^\.flow\/active\/[^/]+\/tasks\/[^/]+\//.test(f)).map((f) => f.split('/').slice(0, 5).join('/')))];
  const problems = [];
  for (const d of dirs) {
    const vf = `${d}/verdict.json`;
    if (!existsSync(vf)) { problems.push(`${d}: no verdict.json`); continue; }
    const v = JSON.parse(readFileSync(vf, 'utf8'));
    const r = applyPolicy(v);
    if (r.action !== 'pass') { problems.push(`${d}: verdict is ${r.action}`); continue; }
    const since = spawnSync('git', ['diff', '--name-only', `${v.reviewed_commit}..HEAD`], { encoding: 'utf8' });
    if (since.status !== 0) { problems.push(`${d}: reviewed_commit ${v.reviewed_commit} not found`); continue; }
    const f = isFresh(v, since.stdout.split('\n').filter(Boolean));
    if (!f.fresh) problems.push(`${d}: ${f.reason}`);
  }
  return { ok: problems.length === 0, checked: dirs, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'ci') {
  const r = checkFeatureVerdicts(process.argv[3] ?? 'origin/main');
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
