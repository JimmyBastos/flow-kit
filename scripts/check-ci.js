#!/usr/bin/env node
// Checks named pull-request CI results. Missing, pending, or failed checks block automation.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, requiredChecks } from './lib/config.js';

const SUCCESS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

export function checkRequiredChecks(results, requiredChecks) {
  const checks = Array.isArray(results) ? results : [];
  const missing = [];
  const pending = [];
  const failed = [];
  if (!Array.isArray(requiredChecks) || requiredChecks.length === 0) return { ok: false, missing: ['merge.required_checks'], pending: [], failed: [] };
  for (const required of requiredChecks) {
    const matches = checks.filter((check) => check.name === required || `${check.workflowName} / ${check.name}` === required);
    if (!matches.length) { missing.push(required); continue; }
    const passed = matches.some((check) => {
      const state = String(check.state ?? check.conclusion ?? '').toUpperCase();
      const status = String(check.status ?? '').toUpperCase();
      return SUCCESS.has(state) && (!status || status === 'COMPLETED');
    });
    if (passed) continue;
    if (matches.some((check) => !['COMPLETED', ...SUCCESS].includes(String(check.status ?? '').toUpperCase()) && !check.conclusion)) pending.push(required);
    else failed.push(required);
  }
  return { ok: missing.length === 0 && pending.length === 0 && failed.length === 0, missing, pending, failed };
}

export function readPullRequestChecks(pr, run = spawnSync) {
  const out = run('gh', ['pr', 'view', String(pr), '--json', 'statusCheckRollup'], { encoding: 'utf8' });
  if (out.status !== 0) return { error: (out.stderr ?? '').trim() || 'gh pr view failed' };
  try { return { checks: JSON.parse(out.stdout).statusCheckRollup ?? [] }; }
  catch (error) { return { error: `cannot parse check results: ${error.message}` }; }
}

export async function waitForRequiredChecks(pr, requiredChecks, { timeoutMs = 30 * 60 * 1000, intervalMs = 30 * 1000, read = readPullRequestChecks, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const deadline = Date.now() + timeoutMs;
  let result;
  do {
    const snapshot = read(pr);
    if (snapshot.error) return { error: snapshot.error };
    result = checkRequiredChecks(snapshot.checks, requiredChecks);
    if (result.ok || result.failed.length) return result;
    if (Date.now() >= deadline) return result;
    await wait(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  } while (Date.now() <= deadline);
  return result;
}

async function main() {
  const pr = process.argv[2];
  if (!pr) { console.error('usage: node check-ci.js <pull-request-number>'); process.exit(2); }
  const { cfg, errors } = loadConfig();
  if (errors.length) { console.error(errors.join('\n')); process.exit(3); }
  const required = requiredChecks(cfg);
  if (!required.length) { console.error('the selected target must name at least one required CI check'); process.exit(3); }
  const waitIndex = process.argv.indexOf('--wait-seconds');
  const waitSeconds = waitIndex >= 0 ? Number(process.argv[waitIndex + 1]) : 0;
  const result = waitSeconds > 0
    ? await waitForRequiredChecks(pr, required, { timeoutMs: waitSeconds * 1000 })
    : (() => {
      const snapshot = readPullRequestChecks(pr);
      return snapshot.error ? snapshot : checkRequiredChecks(snapshot.checks, required);
    })();
  if (result.error) { console.error(result.error); process.exit(3); }
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exit(3); });
