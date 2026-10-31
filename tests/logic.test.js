import test from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, matchesAny } from '../scripts/lib/glob.js';
import { normalize, validate, warnings, ALWAYS_HIGH_RISK } from '../scripts/lib/config.js';
import { parse } from '../scripts/lib/miniyaml.js';
import { applyPolicy, classify, validateVerdict } from '../scripts/verdict.js';
import { decide } from '../scripts/merge.js';
import { checkText, checkSizeCaps, checkDiffSize, checkTestFirst, runGates } from '../scripts/gates.js';
import { parseState, serializeState, validateState, parseTasks, deriveStatus } from '../scripts/flow-state.js';
import { checkPush } from '../scripts/pre-push.js';

const goodCfg = () => normalize(parse(`
topology: single
targets:
  - tag: api
    path: .
    gates: ["npm test"]
stages:
  implement: { harness: claude-code, model: opus }
  review: { harness: codex, model: gpt }
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

test('config: catches the mistakes that matter', () => {
  const cfg = goodCfg();
  cfg.stages.review.harness = 'claude-code';
  assert.equal(validate(cfg).join(), '');
  assert.match(warnings(cfg).join(), /same harness/);
  assert.match(validate({ ...goodCfg(), workspace: 'tmux' }).join(), /workspace/);
  assert.equal(validate({ ...goodCfg(), workspace: 'orca' }).join(), '');
  const multi = { ...goodCfg(), topology: 'multi' };
  assert.match(validate(multi).join(), /hub/);
  const empty = { ...goodCfg(), stages: {} };
  assert.match(validate(empty).join(), /stages.implement/);
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
  const b = { block: ['contradicts_spec'], ask: ['new_behavior'], log: ['rename'] };
  assert.equal(classify('rename', b), 'log');
  assert.equal(classify('new_behavior', b), 'ask');
  assert.equal(classify('totally_new_category', b), 'block');
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
  for (const f of ['flow.config.yaml', '.github/workflows/ci.yml', 'scripts/flow/guard-destructive.js', 'docs/rules/r.md', '.githooks/pre-push']) {
    assert.equal(decide({ changedFiles: [f], config }).action, 'human', f);
  }
  assert.ok(ALWAYS_HIGH_RISK.length > 3);
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
  assert.deepEqual(r, { total: 250, cap: 300, ok: true });
  assert.equal(checkDiffSize([{ file: 'src/a.js', added: 301, deleted: 0 }], 300).ok, false);
});

test('gates: test-first ordering', () => {
  const globs = goodCfg().test_globs;
  const ok = [{ sha: 'a1111111', files: ['tests/a.test.js'] }, { sha: 'b2222222', files: ['src/a.js'] }];
  assert.equal(checkTestFirst(ok, globs).ok, true);
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
test('flow-state CLI: FLOW_ROOT lets a target worktree write state into the hub', () => {
  const hub = mkdtempSync(pj(tmpdir(), 'hub-')); const work = mkdtempSync(pj(tmpdir(), 'work-'));
  const cli = fu(new URL('../scripts/flow-state.js', import.meta.url));
  const run = (...a) => spawnSync('node', [cli, ...a], { cwd: work, env: { ...process.env, FLOW_ROOT: hub }, encoding: 'utf8' });
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

test('checkText flags long sentences and vague words, skips code and tables', () => {
  const long = Array(30).fill('word').join(' ') + '.';
  const text = ['# Title', long, 'The review travels with the PR.', '| the result travels | x |', '```', long, '```', 'Short and clear.'].join('\n');
  const p = checkText([{ name: 'spec.md', text }]);
  assert.deepEqual(p.map((x) => x.kind).sort(), ['long_sentence', 'vague_word']);
  assert.equal(p.find((x) => x.kind === 'vague_word').text.toLowerCase(), 'travels');
});
