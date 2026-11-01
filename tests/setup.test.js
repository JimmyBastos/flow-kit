import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeClaudeSettings, mergeCodexToml, mergeOpencodeJson } from '../scripts/lib/setup-merge.js';
import { checkCodexToml, checkOpencode, findTrackedSecrets, guardBlocks } from '../scripts/doctor.js';

const kit = fileURLToPath(new URL('..', import.meta.url));

test('claude settings: merge is idempotent and preserves existing config', () => {
  const existing = { permissions: { allow: ['Bash(ls)'], deny: ['Bash(curl:*)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'mine.sh' }] }] }, theme: 'dark' };
  const once = mergeClaudeSettings(existing);
  const twice = mergeClaudeSettings(once);
  assert.deepEqual(once, twice);
  assert.equal(once.theme, 'dark');
  assert.ok(once.permissions.deny.includes('Bash(curl:*)') && once.permissions.deny.includes('Read(./.env)'));
  assert.equal(once.hooks.PreToolUse.length, 2);
  assert.ok(once.hooks.PreCompact && once.hooks.SessionStart);
});

test('flow-setup installs a hub workflow for multi topology', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-hub-'));
  const sh = (cmd, args, env = {}) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
  sh('git', ['init', '-q', '-b', 'main']);
  mkdirSync(join(dir, '.agents/skills'), { recursive: true });
  writeFileSync(join(dir, 'flow.config.yaml'), `topology: multi
flow_dir: .flow
targets:
  - tag: api
    path: ../api
    gates: ["node --test"]
tracker: none
`);
  const setup = sh('node', [join(kit, 'scripts/flow-setup.js')]);
  assert.equal(setup.status, 0, setup.stderr);
  const workflow = readFileSync(join(dir, '.github/workflows/flow-gates.yml'), 'utf8');
  assert.match(workflow, /node scripts\/flow\/gates\.js docs/);
  const doctor = sh('node', ['scripts/flow/doctor.js']);
  assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
  assert.match(doctor.stdout, /PASS {2}hub document CI/);
});

test('codex toml: sets token limit (not percent) and replaces existing values', () => {
  const t = mergeCodexToml('model = "gpt"\nmodel_auto_compact_token_limit = 1\n', 200000, 80);
  assert.match(t, /model_context_window = 200000/);
  assert.match(t, /model_auto_compact_token_limit = 160000/);
  assert.equal((t.match(/model_auto_compact_token_limit/g) ?? []).length, 1);
  assert.deepEqual(checkCodexToml(t, 200000, 80), { status: 'ok' });
  assert.equal(checkCodexToml('', 200000, 80).status, 'fail');
});

test('opencode: key follows major version; unverified when version unknown', () => {
  assert.equal(mergeOpencodeJson({}, 200000, 80, 1).key, 'reserved');
  assert.equal(mergeOpencodeJson({}, 200000, 80, 2).key, 'buffer');
  const unknown = mergeOpencodeJson({}, 200000, 80, null);
  assert.equal(unknown.verified, false);
  assert.equal(unknown.json.compaction.reserved, 40000);
  const v2 = mergeOpencodeJson({ compaction: { reserved: 40000 } }, 200000, 80, 2).json;
  assert.equal(v2.compaction.buffer, 40000);
  assert.equal(v2.compaction.reserved, undefined);
  assert.equal(checkOpencode(unknown.json, null, 200000, 80).status, 'warn');
  assert.equal(checkOpencode(unknown.json, 2, 200000, 80).status, 'fail');
  assert.equal(checkOpencode(v2, 2, 200000, 80).status, 'ok');
});

test('doctor: finds tracked secrets but not examples', () => {
  assert.deepEqual(findTrackedSecrets(['.env', 'a/.env.local', 'n8n_creds.json', 'k.pem', '.env.example', 'src/a.js']), ['.env', 'a/.env.local', 'n8n_creds.json', 'k.pem']);
});

test('doctor: guardBlocks passes for the real guard and fails for a guard that exits 1', () => {
  assert.equal(guardBlocks(join(kit, 'scripts/guard-destructive.js')).status, 'ok');
  const dir = mkdtempSync(join(tmpdir(), 'flow-'));
  const bad = join(dir, 'bad-guard.js');
  writeFileSync(bad, 'process.stdin.resume();process.stdin.on("end",()=>process.exit(1))');
  assert.match(guardBlocks(bad).detail, /must be 2/);
});

test('flow-setup end to end in a scratch repo, then doctor passes the hard checks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-proj-'));
  const sh = (cmd, args) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' });
  sh('git', ['init', '-q', '-b', 'main']);
  mkdirSync(join(dir, '.agents/skills'), { recursive: true });
  writeFileSync(join(dir, 'flow.config.yaml'), `topology: single
targets:
  - tag: app
    path: .
    gates: ["node -e 0"]
capabilities:
  implementation:
    candidates:
      - harness: claude-code
        model: opus
        context_window: 200000
  review:
    prefer_different_harness: true
    candidates:
      - harness: codex
        model: gpt
        context_window: 200000
`);
  const setup = sh('node', [join(kit, 'scripts/flow-setup.js')]);
  assert.equal(setup.status, 0, setup.stderr);
  for (const f of ['scripts/flow/guard-destructive.js', 'scripts/flow/check-ci.js', 'scripts/flow/capabilities.js', 'scripts/flow/lib/miniyaml.js', 'scripts/flow/adapters/harness.md', '.githooks/pre-push', '.github/workflows/flow-gates.yml', '.claude/settings.json', '.codex/config.toml', 'opencode.json', 'CLAUDE.md']) {
    assert.ok(existsSync(join(dir, f)), `missing ${f}`);
  }
  assert.ok((statSync(join(dir, '.githooks/pre-push')).mode & 0o111) !== 0);
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  const again = sh('node', [join(kit, 'scripts/flow-setup.js')]);
  assert.equal(again.status, 0, 'second run must be idempotent');
  const doc = sh('node', ['scripts/flow/doctor.js']);
  assert.match(doc.stdout, /PASS {2}guard denies force push/);
  assert.match(doc.stdout, /PASS {2}git pre-push hook active/);
  assert.match(doc.stdout, /PASS {2}Claude Code: guard hook/);
  assert.match(doc.stdout, /PASS {2}Codex compaction limit/);
  assert.match(doc.stdout, /WARN {2}CLAUDE_AUTOCOMPACT_PCT_OVERRIDE/);
  // the installed pre-push hook really blocks a force push to a protected branch
  const remote = mkdtempSync(join(tmpdir(), 'flow-remote-'));
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: remote });
  sh('git', ['remote', 'add', 'origin', remote]);
  sh('git', ['-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'init']);
  const push = sh('git', ['push', 'origin', 'main']);
  assert.notEqual(push.status, 0);
  assert.match(push.stderr, /protected branch/);
});
