#!/usr/bin/env node
// Verifies the enforcement layer is REALLY on (it tests behaviour, not just file presence).
//   node scripts/flow/doctor.js         full local check
//   node scripts/flow/doctor.js --ci    config + guard + tracked secrets only (no harness/gh checks)
// Exit 1 if any check fails. Warnings (unverifiable here) do not fail.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, requiredChecks } from './lib/config.js';
import { SECRET_DENY } from './lib/setup-merge.js';

const here = dirname(fileURLToPath(import.meta.url));

export const SECRET_FILE = /(^|\/)(\.env(\..+)?|.*creds.*|.*\.pem|id_(rsa|ed25519|ecdsa))$/i;
export const SECRET_OK = /\.(example|sample|template|dist)$/i;
export const findTrackedSecrets = (files) => files.filter((f) => SECRET_FILE.test(f) && !SECRET_OK.test(f));

// The merge workflow must run base-branch code (pull_request_target), check the verdict and CI results, then merge.
export function checkMergeWorkflow(text, configuredChecks) {
  if (!Array.isArray(configuredChecks) || !configuredChecks.length) return { status: 'fail', detail: 'configure merge.required_checks' };
  if (!text) return { status: 'fail', detail: 'missing .github/workflows/flow-merge.yml (run flow-setup)' };
  const need = ['pull_request_target', 'pull_request.base.sha', 'verdict.js ci', 'check-ci.js', 'merge.js run'];
  const missing = need.filter((n) => !text.includes(n));
  return missing.length ? { status: 'fail', detail: `flow-merge.yml lacks ${missing.join(', ')} (run flow-setup)` } : { status: 'ok' };
}

export function guardBlocks(guardPath) {
  const run = (command) => spawnSync('node', [guardPath], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8' });
  const bad = run('git push --force origin main'); const good = run('git status');
  if (bad.status !== 2) return { status: 'fail', detail: `guard exited ${bad.status} on a force push (must be 2 to block)` };
  if (good.status !== 0) return { status: 'fail', detail: `guard blocked a harmless command (exit ${good.status})` };
  return { status: 'ok' };
}

function run(ci) {
  const out = [];
  const add = (name, r) => out.push({ name, ...r });
  const cfgPath = process.env.FLOW_CONFIG ?? 'flow.config.yaml';
  const hasInlineConfig = Boolean(process.env.FLOW_CONFIG_B64 || process.env.FLOW_CONFIG_JSON);
  const { cfg, errors, warnings = [] } = hasInlineConfig || existsSync(cfgPath) ? loadConfig() : { cfg: null, errors: ['flow.config.yaml not found; run /flow-init'] };
  add('flow.config.yaml valid', errors.length ? { status: 'fail', detail: errors.join('; ') } : { status: 'ok' });
  if (warnings.length) add('flow.config.yaml warnings', { status: 'warn', detail: warnings.join('; ') });
  const guard = existsSync('scripts/flow/guard-destructive.js') ? 'scripts/flow/guard-destructive.js' : join(here, 'guard-destructive.js');
  add('guard denies force push (exit 2) and allows normal commands', guardBlocks(guard));
  const tracked = spawnSync('git', ['ls-files'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const secrets = findTrackedSecrets(tracked);
  add('no secret-like files tracked in git', secrets.length ? { status: 'fail', detail: `tracked: ${secrets.join(', ')} (rotate if real, git rm --cached, purge history)` } : { status: 'ok' });
  if (ci || !cfg) return out;

  const hp = spawnSync('git', ['config', 'core.hooksPath'], { encoding: 'utf8' }).stdout.trim();
  const hookOk = hp === '.githooks' && existsSync('.githooks/pre-push') && (statSync('.githooks/pre-push').mode & 0o111) !== 0;
  add('git pre-push hook active', hookOk ? { status: 'ok' } : { status: 'fail', detail: 'core.hooksPath must be .githooks and .githooks/pre-push executable (run flow-setup)' });
  add('CI gates workflow installed', existsSync('.github/workflows/flow-gates.yml') ? { status: 'ok' } : { status: 'fail', detail: 'missing .github/workflows/flow-gates.yml' });

  const cs = existsSync('.claude/settings.json') ? JSON.parse(readFileSync('.claude/settings.json', 'utf8')) : {};
  const hasHook = JSON.stringify(cs.hooks ?? {}).includes('guard-destructive.js');
  const hasDeny = SECRET_DENY.every((d) => cs.permissions?.deny?.includes(d));
  add('Claude Code: guard hook + secret deny rules', hasHook && hasDeny ? { status: 'ok' } : { status: 'fail', detail: 'run flow-setup' });

  if (cfg.workspace === 'orca') {
    const orca = spawnSync('sh', ['-c', 'command -v orca'], { encoding: 'utf8' });
    add('workspace: orca CLI installed', orca.status === 0 ? { status: 'ok' } : { status: 'warn', detail: 'workspace is "orca" but the orca CLI was not found; /flow-run cannot open worktrees in Orca' });
  }

  const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
  const workflow = read('.github/workflows/flow-gates.yml');
  const configuredChecks = requiredChecks(cfg);
  const hubMode = cfg.topology === 'multi' && !process.env.FLOW_TARGET;
  if (hubMode) add('hub document CI', workflow.includes('gates.js docs') ? { status: 'ok' } : { status: 'fail', detail: 'install the hub flow-gates workflow' });
  else add('base-branch CI merge gate', checkMergeWorkflow(read('.github/workflows/flow-merge.yml'), configuredChecks));
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = run(process.argv.includes('--ci'));
  const icon = { ok: 'PASS', warn: 'WARN', fail: 'FAIL' };
  for (const r of results) console.log(`${icon[r.status]}  ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
  process.exit(results.some((r) => r.status === 'fail') ? 1 : 0);
}
