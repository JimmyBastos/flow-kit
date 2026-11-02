import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { globToRegExp, matchesAny } from '../scripts/lib/glob.js';
import { normalize, validate, warnings, ALWAYS_HIGH_RISK, flowDir, targetDir } from '../scripts/lib/config.js';
import { parse } from '../scripts/lib/miniyaml.js';
import { applyPolicy, classify, validateVerdict } from '../scripts/verdict.js';
import { decide } from '../scripts/merge.js';
import { checkSizeCaps, checkDiffSize, checkTestFirst, runGates } from '../scripts/gates.js';
import { parseState, serializeState, validateState, parseTasks, deriveStatus } from '../scripts/flow-state.js';
import { checkPush } from '../scripts/pre-push.js';
import { selectCandidate, detectInstalledHarnesses, resolveDefaultModel, candidatesFor } from '../scripts/capabilities.js';
import { checkRequiredChecks, waitForRequiredChecks } from '../scripts/check-ci.js';

const goodCfg = () => normalize(parse(`
topology: single
flow_dir: .flow
targets:
  - tag: api
    path: .
    gates: ["npm test"]
capabilities:
  planning:
    candidates:
      - harness: claude-code
        model: opus
      - harness: opencode
        model: opencode-go/glm-5.3
  implementation:
    candidates:
      - harness: claude-code
        model: sonnet
  review:
    prefer_different_harness: true
    candidates:
      - harness: opencode
        model: opencode-go/glm-5.3
      - harness: claude-code
        model: sonnet
`));

test('glob: ** crosses directories, * does not', () => {
  assert.ok(globToRegExp('**/migrations/**').test('db/migrations/001.sql'));
  assert.ok(globToRegExp('**/migrations/**').test('migrations/001.sql'));
  assert.ok(globToRegExp('infra/**').test('infra/a/b.tf'));
  assert.ok(!globToRegExp('src/*.js').test('src/a/b.js'));
  assert.ok(matchesAny('src/a.test.ts', ['**/*.test.*']));
});

test('config: defaults fill in, valid config has no errors', () => {
  const cfg = goodCfg();
  assert.equal(cfg.limits.max_attempts_per_task, 3);
  assert.deepEqual(validate(cfg), []);
});

test('config: flow folder and target paths resolve from the config file', () => {
  const cfg = normalize(parse(`topology: multi
flow_dir: .flow-data
targets:
  - tag: api
    path: ../api
    gates: ["npm test"]
`));
  assert.equal(flowDir(cfg, '/workspace/docs/flow.config.yaml'), '/workspace/docs/.flow-data');
  assert.equal(targetDir(cfg, cfg.targets[0], '/workspace/docs/flow.config.yaml'), '/workspace/api');
  const oldTarget = process.env.FLOW_TARGET; const oldPath = process.env.FLOW_TARGET_PATH;
  process.env.FLOW_TARGET = 'api'; process.env.FLOW_TARGET_PATH = '/worktrees/api-task';
  assert.equal(targetDir(cfg, cfg.targets[0], '/workspace/docs/flow.config.yaml'), '/worktrees/api-task');
  if (oldTarget === undefined) delete process.env.FLOW_TARGET; else process.env.FLOW_TARGET = oldTarget;
  if (oldPath === undefined) delete process.env.FLOW_TARGET_PATH; else process.env.FLOW_TARGET_PATH = oldPath;
});

test('config: catches the mistakes that matter', () => {
  const cfg = goodCfg();
  cfg.capabilities.review.candidates[0].harness = 'claude-code';
  assert.equal(validate(cfg).join(), '');
  assert.match(warnings(cfg).join(), /same first-choice harness/);
  assert.match(validate({ ...goodCfg(), workspace: 'tmux' }).join(), /workspace/);
  assert.equal(validate({ ...goodCfg(), workspace: 'orca' }).join(), '');
  const multi = { ...goodCfg(), topology: 'multi' };
  assert.equal(validate(multi).join(), '');
  const nogates = goodCfg(); nogates.targets[0].gates = [];
  assert.match(validate(nogates).join(), /at least one gate/);
});

test('verdict: policy maps severities to actions', () => {
  const v = (verdict, ...sev) => ({ verdict, violations: sev.map((s, i) => ({ rule: `R-${i}`, file: 'a.js', why: 'x', severity: s })) });
  assert.equal(applyPolicy(v('pass')).action, 'pass');
  const withAsk = applyPolicy(v('pass', 'ask', 'log'));
  assert.equal(withAsk.action, 'pass');
  assert.equal(withAsk.questions.length, 1);
  assert.equal(withAsk.logged.length, 1);
  assert.equal(applyPolicy(v('fail', 'block')).action, 'retry');
});

test('verdict: inconsistent or malformed verdicts are invalid (never silently pass)', () => {
  assert.equal(applyPolicy({ verdict: 'pass', violations: [{ rule: 'R', file: 'f', why: 'w', severity: 'block' }] }).action, 'invalid');
  assert.equal(applyPolicy({ verdict: 'fail', violations: [] }).action, 'invalid');
  assert.equal(applyPolicy({ verdict: 'maybe', violations: [] }).action, 'invalid');
  assert.ok(validateVerdict(null).length);
});

test('classify: unknown categories fail safe to block', () => {
  assert.equal(classify('rename', 'drift'), 'log');
  assert.equal(classify('new_behavior', 'drift'), 'ask');
  assert.equal(classify('contradicts_spec', 'drift'), 'block');
  assert.equal(classify('totally_new_category', 'drift'), 'block');
  assert.equal(classify('rename', 'unknown-kind'), 'block');
});

test('merge: auto only when checks pass and no high-risk path is touched', () => {
  const config = goodCfg();
  assert.equal(decide({ changedFiles: ['src/a.js', 'tests/a.test.js'], config }).action, 'auto');
  assert.equal(decide({ changedFiles: ['db/migrations/1.sql'], config }).action, 'human');
  assert.equal(decide({ changedFiles: ['src/a.js'], config, checksPassed: false }).action, 'human');
  assert.equal(decide({ changedFiles: [], config }).action, 'human');
  config.merge.auto = false;
  assert.equal(decide({ changedFiles: ['src/a.js'], config }).action, 'human');
});

test('merge: the agent cannot auto-merge changes to its own guardrails', () => {
  const config = goodCfg();
  for (const f of ['flow.config.yaml', '.github/workflows/ci.yml', 'scripts/flow/guard-destructive.js', '.flow/decisions/0001-choice.md', 'docs/rules/r.md', '.githooks/pre-push']) {
    assert.equal(decide({ changedFiles: [f], config }).action, 'human', f);
  }
  assert.ok(ALWAYS_HIGH_RISK.length > 3);
});

test('capabilities: ordered candidates skip unavailable harnesses and prefer an independent review harness', () => {
  const profile = {
    prefer_different_harness: true,
    candidates: [
      { harness: 'opencode', model: 'opencode-go/glm-5.3' },
      { harness: 'opencode', model: 'opencode-go/glm-5.3-flash' },
      { harness: 'claude-code', model: 'sonnet' },
    ],
  };
  assert.deepEqual(selectCandidate(profile, { usedHarness: 'claude-code' }), profile.candidates[0]);
  assert.deepEqual(selectCandidate(profile, { usedHarness: 'opencode' }), profile.candidates[2]);
  assert.deepEqual(selectCandidate(profile, { availableHarnesses: ['opencode'], unavailableModels: ['opencode-go/glm-5.3'] }), profile.candidates[1]);
  assert.equal(selectCandidate(profile, { availableHarnesses: ['codex'] }), null);
});

test('capabilities: provider privacy policy excludes models with retention or training', () => {
  const profile = { candidates: [
    { harness: 'opencode', model: 'opencode-go/gpt-6-luna', data_policy: { retention_days: 30, trains_on_requests: false } },
    { harness: 'opencode', model: 'opencode-go/glm-5.3', data_policy: { retention_days: 0, trains_on_requests: false } },
  ] };
  const chosen = selectCandidate(profile, { modelPolicy: { providers: { 'opencode-go': { max_retention_days: 0, allow_training: false } } } });
  assert.equal(chosen.model, 'opencode-go/glm-5.3');
});

test('capabilities: auto/default candidates use installed harness adapters', () => {
  const registry = new URL('../adapters/harness/registry.json', import.meta.url);
  const harnesses = detectInstalledHarnesses(fileURLToPath(registry), (command) => ({ status: command === 'opencode' ? 0 : 1 }));
  assert.deepEqual(harnesses, ['opencode']);
  const profile = { candidates: [{ harness: 'auto', model: 'default' }, { harness: 'auto', model: 'default' }] };
  assert.deepEqual(selectCandidate(profile, { availableHarnesses: harnesses }), { harness: 'opencode', model: 'default' });
  assert.deepEqual(resolveDefaultModel({ harness: 'claude-code', model: 'default' }, 'research', {
    'claude-code': { defaults: { research: { model: 'opus' } } },
  }), { harness: 'claude-code', model: 'opus' });
});

test('capabilities: retry variants are declared, ordered first, and fall back to base candidates', () => {
  const profile = {
    candidates: [{ harness: 'claude-code', model: 'sonnet' }],
    retry_candidates: [{ harness: 'codex', model: 'gpt' }],
  };
  assert.deepEqual(selectCandidate(profile, { availableHarnesses: ['claude-code', 'codex', 'opencode'] }), profile.candidates[0]);
  assert.equal(selectCandidate(profile, { availableHarnesses: ['claude-code', 'codex'], retry: true }).model, 'gpt');
  assert.equal(selectCandidate(profile, { availableHarnesses: ['claude-code', 'codex'], retry: true }).variant, 'retry');
  assert.equal(selectCandidate(profile, { availableHarnesses: ['claude-code'], retry: true }).model, 'sonnet');
  assert.deepEqual(candidatesFor({ candidates: [{ harness: 'a', model: 'b' }] }, { retry: true }), [{ harness: 'a', model: 'b' }]);
  const registry = { 'claude-code': { defaults: { implementation: { model: 'sonnet' }, 'implementation.retry': { model: 'opus' } } } };
  assert.equal(resolveDefaultModel({ harness: 'claude-code', model: 'default', variant: 'retry' }, 'implementation', registry).model, 'opus');
  assert.equal(resolveDefaultModel({ harness: 'claude-code', model: 'default', variant: 'other' }, 'implementation', registry).model, 'sonnet');
});

test('capabilities: research subagents use the smaller model, in the leader\'s harness, with the leader as fallback', () => {
  const profile = {
    candidates: [{ harness: 'claude-code', model: 'opus' }, { harness: 'opencode', model: 'big' }],
    subagent_candidates: [{ harness: 'claude-code', model: 'haiku' }, { harness: 'opencode', model: 'small' }],
  };
  const pick = (opts) => selectCandidate(profile, opts);
  assert.equal(pick({ availableHarnesses: ['claude-code', 'opencode'] }).model, 'opus', 'without --subagent the leader is chosen');
  assert.deepEqual(pick({ availableHarnesses: ['claude-code'], subagent: true }), { harness: 'claude-code', model: 'haiku', variant: 'subagent' });
  assert.equal(pick({ availableHarnesses: ['opencode'], subagent: true }).model, 'small', 'stays in the leader\'s harness');
  assert.equal(pick({ availableHarnesses: ['claude-code'], subagent: true, unavailableModels: ['claude-code/haiku'] }).model, 'opus', 'falls back to the leader model');
  assert.equal(pick({ availableHarnesses: ['claude-code'], subagent: true, retry: true }).variant, 'subagent', 'research has no retry list');
  const registry = { 'claude-code': { defaults: { research: { model: 'opus' }, 'research.subagent': { model: 'haiku' } } } };
  const auto = selectCandidate({ candidates: [{ harness: 'auto', model: 'default' }], subagent_candidates: [{ harness: 'auto', model: 'default' }] }, { availableHarnesses: ['claude-code'], subagent: true });
  assert.equal(resolveDefaultModel(auto, 'research', registry).model, 'haiku');
});

test('config: variant candidate lists are validated like base candidates', () => {
  const cfg = goodCfg();
  cfg.capabilities.implementation.retry_candidates = [{ harness: 'codex' }];
  cfg.capabilities.review.retry_candidates = [];
  cfg.capabilities.planning.subagent_candidates = [{ model: 'haiku' }];
  const errs = validate(cfg).join('\n');
  assert.match(errs, /implementation\.retry_candidates\[0\]\.model is required/);
  assert.match(errs, /review\.retry_candidates must be a non-empty list/);
  assert.match(errs, /planning\.subagent_candidates\[0\]\.harness is required/);
});

test('config: keys from older configs still parse and are reported as unused', () => {
  const cfg = goodCfg();
  assert.deepEqual(warnings(cfg), []);
  cfg.compaction = { trigger_percent: 80 };
  cfg.approvals = {};
  cfg.capabilities.review.high_risk_candidates = [{ harness: 'codex', model: 'gpt' }];
  cfg.capabilities.planning.candidates[0].context_window = 1000000;
  cfg.capabilities.repository_exploration = { candidates: [{ harness: 'claude-code', model: 'haiku' }] };
  cfg.capabilities.utility = { candidates: [{ harness: 'claude-code', model: 'haiku' }] };
  assert.deepEqual(validate(cfg), []);
  const w = warnings(cfg).join('\n');
  for (const key of ['compaction', 'approvals', 'review.high_risk_candidates', 'planning: context_window', 'repository_exploration', 'utility']) assert.match(w, new RegExp(key.replace('.', '\\.')));
});

test('CI gate: every configured check must exist and pass', () => {
  const required = ['flow-gates / gates', 'test / unit'];
  assert.deepEqual(checkRequiredChecks([
    { workflowName: 'flow-gates', name: 'gates', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { workflowName: 'test', name: 'unit', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ], required), { ok: true, missing: [], pending: [], failed: [] });
  assert.deepEqual(checkRequiredChecks([{ name: 'flow-gates / gates', status: 'IN_PROGRESS' }], required), {
    ok: false, missing: ['test / unit'], pending: ['flow-gates / gates'], failed: [],
  });
  assert.deepEqual(checkRequiredChecks([{ name: 'flow-gates / gates', status: 'COMPLETED', conclusion: 'FAILURE' }], ['flow-gates / gates']).failed, ['flow-gates / gates']);
});

test('CI gate waits for checks that are pending, then returns the final result', async () => {
  const snapshots = [
    { checks: [{ name: 'flow-gates / gates', status: 'IN_PROGRESS' }] },
    { checks: [{ name: 'flow-gates / gates', status: 'COMPLETED', conclusion: 'SUCCESS' }] },
  ];
  let i = 0;
  const result = await waitForRequiredChecks(7, ['flow-gates / gates'], {
    timeoutMs: 1000,
    read: () => snapshots[i++],
    wait: async () => {},
  });
  assert.deepEqual(result, { ok: true, missing: [], pending: [], failed: [] });
});

test('gates: size caps for spec and plan only', () => {
  const lines = (n) => 'x\n'.repeat(n);
  const limits = { max_spec_lines: 60, max_plan_lines: 60 };
  assert.deepEqual(checkSizeCaps([{ name: 'spec.md', text: lines(60) }, { name: 'tasks.md', text: lines(500) }], limits), []);
  const p = checkSizeCaps([{ name: 'spec.md', text: lines(61) }, { name: 'plan-api.md', text: lines(61) }], limits);
  assert.equal(p.length, 2);
});

test('gates: diff cap ignores .flow/ and lockfiles', () => {
  const r = checkDiffSize([{ file: 'src/a.js', added: 200, deleted: 50 }, { file: 'pnpm-lock.yaml', added: 9000, deleted: 0 }, { file: '.flow/x.md', added: 500, deleted: 0 }], 300);
  assert.deepEqual(r, { total: 250, test_lines: 0, cap: 300, ok: true });
  assert.equal(checkDiffSize([{ file: 'src/a.js', added: 301, deleted: 0 }], 300).ok, false);
});

test('gates: diff cap does not count test files, and reports them apart', () => {
  const r = checkDiffSize([{ file: 'src/a.js', added: 250, deleted: 0 }, { file: 'tests/a.test.js', added: 400, deleted: 0 }], 300, goodCfg().test_globs);
  assert.deepEqual(r, { total: 250, test_lines: 400, cap: 300, ok: true });
});

test('gates: test-first ordering', () => {
  const globs = goodCfg().test_globs;
  const ok = [{ sha: 'a1111111', files: ['tests/a.test.js'] }, { sha: 'b2222222', files: ['src/a.js'] }];
  assert.deepEqual(checkTestFirst(ok, globs), { ok: true, test_commit: 'a1111111' });
  const fixFirst = [{ sha: 'a1111111', files: ['src/a.js'] }, { sha: 'b2222222', files: ['tests/a.test.js'] }];
  assert.equal(checkTestFirst(fixFirst, globs).ok, false);
  const mixed = [{ sha: 'a1111111', files: ['src/a.js', 'tests/a.test.js'] }];
  assert.match(checkTestFirst(mixed, globs).reason, /mixes/);
  assert.equal(checkTestFirst([{ sha: 'c3333333', files: ['README.md'] }], globs).ok, false);
});

test('gates: runGates fails fast and reports output', () => {
  const r = runGates(['node -e "process.exit(0)"', 'node -e "console.error(1);process.exit(7)"', 'node -e "process.exit(0)"'], '.');
  assert.equal(r.ok, false);
  assert.equal(r.results.length, 2);
  assert.equal(r.results[1].status, 7);
});

test('state: round-trips and validates', () => {
  const s = { task: '3', status: 'in_progress', branch: 'flow/f/3', last_commit: 'abc1234', steps_done: ['test', 'impl'], next_step: 'run gates', next_harness: 'codex', attempts: 1 };
  assert.deepEqual(parseState(serializeState(s)), s);
  assert.deepEqual(validateState(s), []);
  assert.ok(validateState({ task: '3', status: 'in_progress' }).join().includes('next_step'));
  assert.ok(validateState({ task: '3', status: 'weird', next_step: 'x' }).length);
});

test('state: derives feature status from tasks.md and merged states', () => {
  const tasks = parseTasks('### 1. [api] Add endpoint\nGoal\n### 2. [app] Show it\n### 3. [api] Docs');
  assert.equal(tasks.length, 3);
  const st = deriveStatus(tasks, { 1: { status: 'done' }, 2: { status: 'blocked' } });
  assert.deepEqual({ done: st.done, next: st.next, blocked: st.blocked, complete: st.complete }, { done: 1, next: '2', blocked: ['2'], complete: false });
  assert.equal(deriveStatus(tasks, { 1: { status: 'done' }, 2: { status: 'done' }, 3: { status: 'done' } }).complete, true);
});

test('pre-push: blocks force, delete and protected pushes; allows fast-forward feature pushes', () => {
  const Z = '0'.repeat(40);
  const ff = () => true; const nonFf = () => false;
  assert.deepEqual(checkPush([`refs/heads/f aaa refs/heads/f bbb`], ff), []);
  assert.deepEqual(checkPush([`refs/heads/f aaa refs/heads/f ${Z}`], nonFf), []);
  assert.match(checkPush([`refs/heads/f aaa refs/heads/f bbb`], nonFf)[0], /non-fast-forward/);
  assert.match(checkPush([`(delete) ${Z} refs/heads/f bbb`], ff)[0], /deleting/);
  assert.match(checkPush([`refs/heads/f aaa refs/heads/main bbb`], ff)[0], /protected/);
});

test('state: all-digit shas keep their leading zero', () => {
  const s = { task: '3', status: 'todo', last_commit: '0123456', next_step: 'x' };
  assert.equal(parseState(serializeState(s)).last_commit, '0123456');
});

import { isFresh } from '../scripts/verdict.js';
test('verdict freshness: code changes after review invalidate a pass', () => {
  const v = { reviewed_commit: 'abc' };
  assert.equal(isFresh(v, ['.flow/active/f/tasks/1/verdict.json', '.flow/active/f/tasks/1/state.md']).fresh, true);
  assert.equal(isFresh(v, ['src/a.js']).fresh, false);
  assert.equal(isFresh({}, []).fresh, false);
});

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync as rf } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pj } from 'node:path';
import { fileURLToPath as fu } from 'node:url';
test('flow-state CLI: FLOW_DIR lets a target worktree write state into the hub', () => {
  const hub = mkdtempSync(pj(tmpdir(), 'hub-')); const work = mkdtempSync(pj(tmpdir(), 'work-'));
  const cli = fu(new URL('../scripts/flow-state.js', import.meta.url));
  const run = (...a) => spawnSync('node', [cli, ...a], { cwd: work, env: { ...process.env, FLOW_DIR: pj(hub, '.flow') }, encoding: 'utf8' });
  assert.equal(run('write', 'feat', '2', 'status=in_progress', 'next_step=run gates', 'steps_done=test,impl').status, 0);
  assert.match(rf(pj(hub, '.flow/active/feat/tasks/2/state.md'), 'utf8'), /next_step: "run gates"/);
  assert.equal(run('ask', 'feat', '2', 'Which table?', '--options', 'a|b').status, 0);
  const q = rf(pj(hub, '.flow/active/feat/tasks/2/questions.md'), 'utf8');
  assert.match(q, /## Q1\nWhich table\?\noptions: a\|b/);
  assert.equal(JSON.parse(run('read', 'feat', '2').stdout).status, 'blocked');
  assert.equal(run('write', 'feat', '2', 'status=bogus').status, 3);
});

test('gates: a gate never inherits NODE_TEST_CONTEXT (nested node --test would skip and pass vacuously)', () => {
  const r = runGates(['node -e "process.exit(process.env.NODE_TEST_CONTEXT ? 9 : 0)"'], '.');
  assert.equal(r.ok, true);
});


import { checkFeature, parseTaskBlocks } from '../scripts/gates.js';
import { parseQueue, nextInQueue, setQueueStatus } from '../scripts/flow-state.js';

const SPEC = '# Spec: f\n\n## Success criteria\n- SC-1: one\n- SC-2: two\n';
const task = (id, tag, criteria, extra = '') => `### ${id}. [${tag}] Do a thing\n- Goal: g\n- Context: c\n- Acceptance criteria:\n${criteria.map((c) => `  - ${c}`).join('\n')}\n- Type: feature\n- Estimate: S\n${extra}`;

test('check: a complete feature passes', () => {
  const tasks = `# Tasks: f\n\n${task(1, 'api', ['[SC-1] works'])}\n${task(2, 'app', ['[SC-2] shows `digest.summary` field'])}\n## Tracker\n| Task | Issue |\n`;
  assert.deepEqual(checkFeature({ spec: SPEC, tasks, tags: ['api', 'app'] }), []);
  assert.equal(parseTaskBlocks(tasks).length, 2, 'the Tracker section is not a task');
});

test('check: uncited and unknown SCs, unknown tags, missing fields and code in ticket text are problems', () => {
  const tasks = [
    task(1, 'api', ['[SC-1] works', '[SC-9] ghost']),
    task(2, 'web', ['no citation here']),
    '### 3. [api] Edit src/auth/login.ts\n- Goal: fix it in 2 hours\n- Acceptance criteria:\n  - [SC-1] see login.ts:42\n- Type: chore\n',
  ].join('\n');
  const what = checkFeature({ spec: SPEC, tasks, tags: ['api'] }).map((p) => `${p.where}: ${p.what}`).join('\n');
  for (const re of [/task 1: cites SC-9/, /task 2: tag \[web\]/, /task 2: acceptance criterion cites no/, /coverage: SC-2 is not cited/, /task 3: missing Context/, /task 3: Type must be feature or fix/, /task 3: ticket text contains a file path/, /task 3: ticket text contains a line number/, /task 3: ticket text contains an estimate/]) assert.match(what, re);
  assert.match(checkFeature({ spec: '', tasks: '', tags: [] }).map((p) => p.what).join(), /no success criteria.*no tasks/);
});

test('queue: running resumes first, then the first approved row whose dependencies are done', () => {
  const md = `# Queue\n\n| Slug | Status | Depends on | Requirement |\n|---|---|---|---|\n| a | done | - | first |\n| b | approved | c | needs c |\n| c | approved | a | needs a |\n| d | draft | - | later |\n| e | blocked | - | waits |\n`;
  const rows = parseQueue(md);
  assert.deepEqual(rows.map((r) => r.slug), ['a', 'b', 'c', 'd', 'e']);
  const q = nextInQueue(rows);
  assert.deepEqual({ next: q.next, waiting: q.waiting_on_dependencies, blocked: q.blocked, drafts: q.drafts, complete: q.complete }, { next: 'c', waiting: ['b'], blocked: ['e'], drafts: ['d'], complete: false });
  const running = setQueueStatus(md, 'b', 'running');
  assert.equal(nextInQueue(parseQueue(running)).next, 'b');
  assert.match(running, /\| b \| running \| c \| needs c \|/);
  assert.throws(() => setQueueStatus(md, 'zz', 'done'), /no queue row/);
  assert.throws(() => setQueueStatus(md, 'a', 'maybe'), /status must be/);
  assert.match(nextInQueue(parseQueue('| x | approved | nope | r |\n')).problems.join(), /unknown feature nope/);
});
