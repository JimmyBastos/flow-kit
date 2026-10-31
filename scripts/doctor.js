#!/usr/bin/env node
// Verifies the enforcement layer is REALLY on (it tests behaviour, not just file presence).
//   node scripts/flow/doctor.js         full local check
//   node scripts/flow/doctor.js --ci    config + guard + tracked secrets only (no harness/gh checks)
// Exit 1 if any check fails. Warnings (unverifiable here) do not fail.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.js';
import { SECRET_DENY } from './lib/setup-merge.js';

const here = dirname(fileURLToPath(import.meta.url));

export const SECRET_FILE = /(^|\/)(\.env(\..+)?|.*creds.*|.*\.pem|id_(rsa|ed25519|ecdsa))$/i;
export const SECRET_OK = /\.(example|sample|template|dist)$/i;
export const findTrackedSecrets = (files) => files.filter((f) => SECRET_FILE.test(f) && !SECRET_OK.test(f));

export function checkCodexToml(text, win, pct) {
  const want = Math.floor((win * pct) / 100);
  const got = Number((text.match(/^model_auto_compact_token_limit\s*=\s*(\d+)/m) ?? [])[1]);
  return got === want ? { status: 'ok' } : { status: 'fail', detail: `model_auto_compact_token_limit is ${got || 'unset'}, expected ${want}` };
}

export function checkOpencode(json, major, win, pct) {
  const c = json?.compaction;
  if (!c) return { status: 'fail', detail: 'opencode.json has no compaction block' };
  if (major === null) return { status: 'warn', detail: 'opencode not installed or version unreadable: cannot verify the compaction key name' };
  const key = major >= 2 ? 'buffer' : 'reserved';
  if (c[key] === undefined) return { status: 'fail', detail: `installed opencode v${major} reads compaction.${key}, but opencode.json sets ${Object.keys(c).filter((k) => k !== 'auto').join(',') || 'nothing'}` };
  const want = win - Math.floor((win * pct) / 100);
  return c[key] === want ? { status: 'ok' } : { status: 'fail', detail: `compaction.${key} is ${c[key]}, expected ${want}` };
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
  const { cfg, errors, warnings = [] } = existsSync(cfgPath) ? loadConfig() : { cfg: null, errors: ['flow.config.yaml not found; run /flow-init'] };
  add('flow.config.yaml valid', errors.length ? { status: 'fail', detail: errors.join('; ') } : { status: 'ok' });
  if (warnings.length) add('review harness', { status: 'warn', detail: warnings.join('; ') });
  const guard = existsSync('scripts/flow/guard-destructive.js') ? 'scripts/flow/guard-destructive.js' : join(here, 'guard-destructive.js');
  add('guard denies force push (exit 2) and allows normal commands', guardBlocks(guard));
  const tracked = spawnSync('git', ['ls-files'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const secrets = findTrackedSecrets(tracked);
  add('no secret-like files tracked in git', secrets.length ? { status: 'fail', detail: `tracked: ${secrets.join(', ')} (rotate if real, git rm --cached, purge history)` } : { status: 'ok' });
  if (ci || !cfg) return out;

  const hp = spawnSync('git', ['config', 'core.hooksPath'], { encoding: 'utf8' }).stdout.trim();
  const hookOk = hp === '.githooks' && existsSync('.githooks/pre-push') && (statSync('.githooks/pre-push').mode & 0o111) !== 0;
  add('git pre-push hook active', hookOk ? { status: 'ok' } : { status: 'fail', detail: 'core.hooksPath must be .githooks and .githooks/pre-push executable (run flow-setup)' });
  add('CI workflow installed', existsSync('.github/workflows/flow-gates.yml') ? { status: 'ok' } : { status: 'fail', detail: 'missing .github/workflows/flow-gates.yml' });

  const cs = existsSync('.claude/settings.json') ? JSON.parse(readFileSync('.claude/settings.json', 'utf8')) : {};
  const hasHook = JSON.stringify(cs.hooks ?? {}).includes('guard-destructive.js');
  const hasDeny = SECRET_DENY.every((d) => cs.permissions?.deny?.includes(d));
  add('Claude Code: guard hook + secret deny rules', hasHook && hasDeny ? { status: 'ok' } : { status: 'fail', detail: 'run flow-setup' });
  const envPct = process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;
  add('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE exported', Number(envPct) === cfg.compaction.trigger_percent ? { status: 'ok' } : { status: 'warn', detail: `not exported in this shell (want ${cfg.compaction.trigger_percent}); it only lowers the default of ~77-83%` });

  const { context_window: win, trigger_percent: pct } = cfg.compaction;
  add('Codex compaction limit', existsSync('.codex/config.toml') ? checkCodexToml(readFileSync('.codex/config.toml', 'utf8'), win, pct) : { status: 'fail', detail: 'missing .codex/config.toml' });
  const ov = spawnSync('opencode', ['--version'], { encoding: 'utf8' });
  const major = ov.status === 0 ? parseInt((ov.stdout.match(/(\d+)\./) ?? [])[1], 10) : null;
  add('OpenCode compaction key matches installed version', existsSync('opencode.json') ? checkOpencode(JSON.parse(readFileSync('opencode.json', 'utf8')), Number.isNaN(major) ? null : major, win, pct) : { status: 'fail', detail: 'missing opencode.json' });

  if (cfg.workspace === 'orca') {
    const orca = spawnSync('sh', ['-c', 'command -v orca'], { encoding: 'utf8' });
    add('workspace: orca CLI installed', orca.status === 0 ? { status: 'ok' } : { status: 'warn', detail: 'workspace is "orca" but the orca CLI was not found; /flow-run cannot open worktrees in Orca' });
  }

  const gh = spawnSync('gh', ['api', 'repos/{owner}/{repo}/branches/main/protection', '--jq', '.required_status_checks.contexts'], { encoding: 'utf8' });
  if (gh.status !== 0) add('branch protection requires the gates check', { status: 'warn', detail: 'cannot verify via gh (not installed, not authenticated, or no protection on main). Without it the CI gates are advisory.' });
  else add('branch protection requires the gates check', /gates/.test(gh.stdout) ? { status: 'ok' } : { status: 'fail', detail: `required checks: ${gh.stdout.trim()}; add "gates"` });
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = run(process.argv.includes('--ci'));
  const icon = { ok: 'PASS', warn: 'WARN', fail: 'FAIL' };
  for (const r of results) console.log(`${icon[r.status]}  ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
  process.exit(results.some((r) => r.status === 'fail') ? 1 : 0);
}
