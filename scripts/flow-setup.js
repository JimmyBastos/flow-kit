#!/usr/bin/env node
// Installs flow-kit's enforcement layer into the current project. Idempotent. Run from the project root.
//   node <kit>/scripts/flow-setup.js [--dry-run]
// Writes: scripts/flow/*, .githooks/pre-push (+ core.hooksPath), .github/workflows/flow-gates.yml,
//         .claude/settings.json (hooks + secret deny), .codex/config.toml, opencode.json, CLAUDE.md, .claude/skills link.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, chmodSync, lstatSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadConfig } from './lib/config.js';
import { mergeClaudeSettings, mergeCodexToml, mergeOpencodeJson, CLAUDE_MD, PRE_PUSH_HOOK, compactionEnvLine } from './lib/setup-merge.js';

const kit = join(dirname(fileURLToPath(import.meta.url)), '..');
const dry = process.argv.includes('--dry-run');
const log = [];
const act = (msg, fn) => { log.push(`${dry ? '[dry-run] ' : ''}${msg}`); if (!dry) fn(); };
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});
const writeJson = (p, o) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); };

const { cfg, errors } = loadConfig();
if (errors.length) { console.error(`flow.config.yaml is invalid:\n  ${errors.join('\n  ')}`); process.exit(3); }
const candidates = Object.values(cfg.capabilities ?? {}).flatMap((profile) => profile.candidates ?? []);
const windows = candidates.map((candidate) => candidate.context_window ?? cfg.compaction.default_context_window);
const win = windows.length ? Math.min(...windows) : cfg.compaction.default_context_window;
const { trigger_percent: pct } = cfg.compaction;

// 1. helper scripts (Node, no deps) -> scripts/flow/
act('copy scripts to scripts/flow/', () => {
  mkdirSync('scripts/flow', { recursive: true });
  for (const f of ['guard-destructive.js', 'pre-push.js', 'flow-state.js', 'gates.js', 'verdict.js', 'merge.js', 'check-ci.js', 'doctor.js', 'checkpoint.js', 'session-start.js', 'capabilities.js']) copyFileSync(join(kit, 'scripts', f), join('scripts/flow', f));
  cpSync(join(kit, 'scripts/lib'), 'scripts/flow/lib', { recursive: true });
  cpSync(join(kit, 'adapters'), 'scripts/flow/adapters', { recursive: true });
  writeFileSync('scripts/flow/package.json', '{ "type": "module" }\n');
});

// 2. git-level safety net (harness independent)
act('install .githooks/pre-push and set core.hooksPath', () => {
  mkdirSync('.githooks', { recursive: true });
  writeFileSync('.githooks/pre-push', PRE_PUSH_HOOK); chmodSync('.githooks/pre-push', 0o755);
  spawnSync('git', ['config', 'core.hooksPath', '.githooks']);
});

// 3. CI: the gates run on every PR whether or not an agent ran them locally
act('install .github/workflows/flow-gates.yml', () => {
  mkdirSync('.github/workflows', { recursive: true });
  let workflow;
  if (cfg.topology !== 'multi') {
    workflow = readFileSync(join(kit, 'templates/ci/github.yml'), 'utf8');
  } else if (process.env.FLOW_TARGET) {
    const target = cfg.targets.find((item) => item.tag === process.env.FLOW_TARGET);
    if (!target) throw new Error(`FLOW_TARGET is not configured: ${process.env.FLOW_TARGET}`);
    const ciConfig = {
      topology: 'single', flow_dir: '.flow', targets: [{ ...target, path: '.', required_checks: target.required_checks ?? cfg.merge.required_checks }],
      tracker: 'none', workspace: cfg.workspace, fallback: cfg.fallback, limits: cfg.limits,
      compaction: cfg.compaction, approvals: cfg.approvals, merge: cfg.merge, test_globs: cfg.test_globs,
    };
    workflow = readFileSync(join(kit, 'templates/ci/github-multi.yml'), 'utf8')
      .replaceAll('__FLOW_TARGET__', target.tag)
      .replaceAll('__FLOW_CONFIG_B64__', Buffer.from(JSON.stringify(ciConfig)).toString('base64'));
  } else {
    workflow = readFileSync(join(kit, 'templates/ci/github-hub.yml'), 'utf8');
  }
  writeFileSync('.github/workflows/flow-gates.yml', workflow);
});

// 4. harness config
act('merge .claude/settings.json (guard, checkpoint, session-start hooks, secret deny rules)', () => writeJson('.claude/settings.json', mergeClaudeSettings(readJson('.claude/settings.json'))));
act('write .codex/config.toml compaction limit', () => {
  mkdirSync('.codex', { recursive: true });
  writeFileSync('.codex/config.toml', mergeCodexToml(existsSync('.codex/config.toml') ? readFileSync('.codex/config.toml', 'utf8') : '', win, pct));
});
const ov = spawnSync('opencode', ['--version'], { encoding: 'utf8' });
const major = ov.status === 0 ? parseInt((ov.stdout.match(/(\d+)\./) ?? [])[1], 10) : null;
const oc = mergeOpencodeJson(readJson('opencode.json'), win, pct, Number.isNaN(major) ? null : major);
act(`merge opencode.json compaction.${oc.key}`, () => writeJson('opencode.json', oc.json));
if (!oc.verified) log.push('WARN opencode not found or version unreadable: wrote compaction.reserved; run `doctor` after installing opencode to verify the key name');

// 5. instructions + skills link
act('write CLAUDE.md (imports AGENTS.md)', () => { if (!existsSync('CLAUDE.md')) writeFileSync('CLAUDE.md', CLAUDE_MD); });
act('link .claude/skills -> ../.agents/skills (copy on Windows)', () => {
  if (!existsSync('.agents/skills')) return;
  mkdirSync('.claude', { recursive: true });
  if (existsSync('.claude/skills') || (() => { try { lstatSync('.claude/skills'); return true; } catch { return false; } })()) return;
  if (process.platform === 'win32') cpSync('.agents/skills', '.claude/skills', { recursive: true });
  else symlinkSync('../.agents/skills', '.claude/skills');
});

console.log(log.join('\n'));
console.log(`\nNext, in the shell that opens Claude Code:\n  ${compactionEnvLine(pct)}\nThen run: node scripts/flow/doctor.js`);
