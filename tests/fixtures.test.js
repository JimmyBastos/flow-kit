// Runs the REAL enforcement scripts through scripted scenarios in each topology.
// No LLM is involved: this validates the machine side of the loop (gates, state, verdicts, merge-by-risk, push guards).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, commit, git, flow, setup, bootstrapPush, sh } from './helpers/repo.js';

const TASKS = `# Tasks: f

### 1. [TAG] First task
- Goal: g
- Context: c
- Acceptance criteria:
  - [SC-1] works
- Type: feature
- Estimate: S

### 2. [TAG] Second task
- Goal: g
- Context: c
- Acceptance criteria:
  - [SC-1] works
- Type: fix
- Estimate: S
`;
const verdictJson = (sha, verdict = 'pass', violations = []) => JSON.stringify({ verdict, reviewed_commit: sha, reviewer: { harness: 'codex', model: 'gpt' }, violations }, null, 2);

// kind -> context. `code` is where branches/commits happen; `hub` owns .flow state; `env` is passed to scripts run in `code`.
function prepare(kind) {
  if (kind === 'multi') {
    const root = mkdtempSync(join(tmpdir(), 'flowfx-multi-'));
    const hub = makeRepo('multi/hub', root, 'hub');
    const code = makeRepo('multi/api', root, 'api');
    makeRepo('multi/app', root, 'app');
    const env = { FLOW_ROOT: hub, FLOW_CONFIG: join(hub, 'flow.config.yaml') };
    assert.equal(setup(code, env).status, 0);
    git(code, 'add', '-A'); git(code, 'commit', '-qm', 'chore: flow setup'); bootstrapPush(code);
    commit(hub, { '.flow/active/f/tasks.md': TASKS.replaceAll('TAG', 'api') }, 'docs(flow): tasks f');
    return { kind, code, hub, env, tag: 'api', prod: 'src/rest.js', prodBad: 'export const rest = (x) => x;\n', test: 'tests/rest.test.js', newTest: 'tests/rest2.test.js', newProd: 'src/rest2.js' };
  }
  const code = makeRepo(kind);
  const env = {};
  assert.equal(setup(code, env).status, 0);
  const tag = kind === 'single' ? 'app' : 'a';
  const base = kind === 'single' ? '' : 'packages/a/';
  git(code, 'add', '-A'); git(code, 'commit', '-qm', 'chore: flow setup');
  commit(code, { '.flow/active/f/tasks.md': TASKS.replaceAll('TAG', tag) }, 'docs(flow): tasks f');
  bootstrapPush(code);
  const name = kind === 'single' ? 'calc' : 'alpha';
  return { kind, code, hub: code, env, tag, prod: `${base}src/${name}.js`, prodBad: `export const ${name} = (x) => x;\n`, test: `${base}tests/${name}.test.js`, newTest: `${base}tests/${name}2.test.js`, newProd: `${base}src/${name}2.js` };
}

const newTest = (name) => `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { ${name} } from '../src/${name}.js';\ntest('${name}', () => assert.equal(${name}(1), 2));\n`;
const nameOf = (c) => c.newProd.split('/').pop().replace('.js', '');

for (const kind of ['single', 'monorepo', 'multi']) {
  test(`[${kind}] happy path: gates, state, verdict, merge-by-risk, push guard`, () => {
    const c = prepare(kind);
    const n = nameOf(c);
    git(c.code, 'checkout', '-q', '-b', 'flow/f/1');
    commit(c.code, { [c.newProd]: `export const ${n} = (x) => x + 1;\n` }, 'feat: add');
    commit(c.code, { [c.newTest]: newTest(n) }, 'test: add');

    const g = flow(c.code, 'gates.js', ['run', '--target', c.tag], c.env);
    assert.equal(g.status, 0, g.out);
    // guard against vacuous gates: the tests must actually have run (fixture 1 test + the one added here)
    assert.match(JSON.parse(g.stdout).results[0].output, /ℹ pass 2/, 'gate passed without running the tests');
    assert.equal(flow(c.code, 'gates.js', ['diff', '--base', 'origin/main'], c.env).status, 0);

    // state is written through FLOW_ROOT (hub in multi), never in tasks.md
    const w = flow(c.code, 'flow-state.js', ['write', 'f', '1', 'status=in_progress', 'branch=flow/f/1', 'next_step=review', 'next_harness=codex'], c.env);
    assert.equal(w.status, 0, w.out);
    assert.ok(existsSync(join(c.hub, '.flow/active/f/tasks/1/state.md')));
    const st = JSON.parse(flow(c.code, 'flow-state.js', ['status', 'f'], c.env).stdout);
    assert.deepEqual({ total: st.total, done: st.done, next: st.next }, { total: 2, done: 0, next: '1' });

    // review verdict travels WITH the code (in the code worktree), so the target repo's CI can see it
    const reviewed = git(c.code, 'rev-parse', 'HEAD').stdout.trim();
    commit(c.code, { '.flow/active/f/tasks/1/verdict.json': verdictJson(reviewed) }, 'chore(flow): review f/1 pass');
    const ci = flow(c.code, 'verdict.js', ['ci', 'origin/main'], c.env);
    assert.equal(ci.status, 0, ci.out);
    assert.equal(JSON.parse(ci.stdout).checked.length, 1, 'CI must actually find and check the verdict');
    const md = flow(c.code, 'merge.js', ['decide', '--base', 'origin/main'], c.env);
    assert.equal(md.status, 0, md.out);

    // a feature branch pushes; main is protected
    assert.equal(git(c.code, 'push', '-q', 'origin', 'flow/f/1').status, 0);
    git(c.code, 'checkout', '-q', 'main');
    commit(c.code, { 'NOTES.md': 'x' }, 'docs: direct');
    const direct = git(c.code, 'push', 'origin', 'main');
    assert.notEqual(direct.status, 0);
    assert.match(direct.out, /protected branch/);
  });

  test(`[${kind}] stale verdict: code changed after review is rejected by CI`, () => {
    const c = prepare(kind);
    git(c.code, 'checkout', '-q', '-b', 'flow/f/1');
    commit(c.code, { [c.newProd]: 'export const x = 1;\n' }, 'feat: x');
    const reviewed = git(c.code, 'rev-parse', 'HEAD').stdout.trim();
    commit(c.code, { '.flow/active/f/tasks/1/verdict.json': verdictJson(reviewed) }, 'review');
    assert.equal(flow(c.code, 'verdict.js', ['ci', 'origin/main'], c.env).status, 0);
    commit(c.code, { [c.newProd]: 'export const x = 2; // sneaked in after review\n' }, 'feat: late change');
    const ci = flow(c.code, 'verdict.js', ['ci', 'origin/main'], c.env);
    assert.equal(ci.status, 1);
    assert.match(ci.out, /code changed after review/);
  });

  test(`[${kind}] missing, failing and malformed verdicts never pass CI`, () => {
    const c = prepare(kind);
    git(c.code, 'checkout', '-q', '-b', 'flow/f/1');
    commit(c.code, { [c.newProd]: 'export const x = 1;\n', '.flow/active/f/tasks/1/state.md': 'task: "1"\nstatus: in_progress\nnext_step: "review"\n' }, 'feat');
    assert.match(flow(c.code, 'verdict.js', ['ci', 'origin/main'], c.env).out, /no verdict\.json/);
    const sha = git(c.code, 'rev-parse', 'HEAD').stdout.trim();
    const fail = verdictJson(sha, 'fail', [{ rule: 'R-1', file: 'a.js', why: 'w', severity: 'block' }]);
    commit(c.code, { '.flow/active/f/tasks/1/verdict.json': fail }, 'review fail');
    assert.match(flow(c.code, 'verdict.js', ['ci', 'origin/main'], c.env).out, /verdict is retry/);
    commit(c.code, { '.flow/active/f/tasks/1/verdict.json': '{"verdict":"pass","reviewed_commit":"' + sha + '","violations":[{"rule":"R"}]}' }, 'review garbage');
    assert.match(flow(c.code, 'verdict.js', ['ci', 'origin/main'], c.env).out, /verdict is invalid/);
  });

  test(`[${kind}] high-risk paths and guardrail files wait for a human`, () => {
    const c = prepare(kind);
    for (const [branch, file] of [['flow/f/risk1', 'db/migrations/001.sql'], ['flow/f/risk2', '.github/workflows/evil.yml'], ['flow/f/risk3', 'docs/rules/conventions.md'], ['flow/f/risk4', 'scripts/flow/guard-destructive.js']]) {
      git(c.code, 'checkout', '-q', 'main'); git(c.code, 'checkout', '-q', '-b', branch);
      commit(c.code, { [file]: 'changed' }, `change ${file}`);
      const d = flow(c.code, 'merge.js', ['decide', '--base', 'origin/main'], c.env);
      assert.equal(d.status, 10, `${file} must need a human: ${d.out}`);
    }
  });

  test(`[${kind}] fix tasks are test-first: wrong order and mixed commits are rejected`, () => {
    const c = prepare(kind);
    const n = nameOf(c);
    git(c.code, 'checkout', '-q', '-b', 'flow/f/bad');
    commit(c.code, { [c.prod]: c.prodBad }, 'fix first (wrong)');
    commit(c.code, { [c.newTest]: newTest(n) }, 'test later');
    assert.equal(flow(c.code, 'gates.js', ['testfirst', '--base', 'origin/main'], c.env).status, 1);

    git(c.code, 'checkout', '-q', 'main'); git(c.code, 'checkout', '-q', '-b', 'flow/f/mixed');
    commit(c.code, { [c.prod]: c.prodBad, [c.newTest]: newTest(n) }, 'mixed');
    assert.match(flow(c.code, 'gates.js', ['testfirst', '--base', 'origin/main'], c.env).out, /mixes tests and production/);

    git(c.code, 'checkout', '-q', 'main'); git(c.code, 'checkout', '-q', '-b', 'flow/f/good');
    commit(c.code, { [c.newTest]: newTest(n) }, 'test: failing repro');
    commit(c.code, { [c.newProd]: `export const ${n} = (x) => x + 1;\n` }, 'fix');
    assert.equal(flow(c.code, 'gates.js', ['testfirst', '--base', 'origin/main'], c.env).status, 0);
  });

  test(`[${kind}] broken code fails the gates (machine check before any AI judgment)`, () => {
    const c = prepare(kind);
    git(c.code, 'checkout', '-q', '-b', 'flow/f/1');
    commit(c.code, { [c.prod]: c.prodBad }, 'break it');
    const g = flow(c.code, 'gates.js', ['run', '--target', c.tag], c.env);
    assert.equal(g.status, 1);
    assert.match(g.out, /"ok": false/);
  });

  test(`[${kind}] a question blocks the task, survives a fresh session, and is visible in status`, () => {
    const c = prepare(kind);
    git(c.code, 'checkout', '-q', '-b', 'flow/f/2');
    const a = flow(c.code, 'flow-state.js', ['ask', 'f', '2', 'Soft delete or hard delete?', '--options', 'soft|hard'], c.env);
    assert.equal(a.status, 0, a.out);
    const q = readFileSync(join(c.hub, '.flow/active/f/tasks/2/questions.md'), 'utf8');
    assert.match(q, /## Q1\nSoft delete or hard delete\?\noptions: soft\|hard\nanswer:/);
    const s = JSON.parse(flow(c.code, 'flow-state.js', ['read', 'f', '2'], c.env).stdout);
    assert.equal(s.status, 'blocked');
    const st = JSON.parse(flow(c.code, 'flow-state.js', ['status', 'f'], c.env).stdout);
    assert.deepEqual(st.blocked, ['2']);
  });

  test(`[${kind}] retry policy: verdict exits drive the loop (retry, invalid, pass)`, () => {
    const c = prepare(kind);
    const dir = mkdtempSync(join(tmpdir(), 'verdict-'));
    const run = (obj) => { sh(dir, 'node', ['-e', `require('fs').writeFileSync('v.json', ${JSON.stringify(JSON.stringify(obj))})`]); return flow(c.code, 'verdict.js', [join(dir, 'v.json')], c.env); };
    assert.equal(run({ verdict: 'fail', reviewed_commit: 'a', violations: [{ rule: 'R-1', file: 'f', why: 'w', severity: 'block' }] }).status, 1);
    assert.equal(run({ verdict: 'pass', reviewed_commit: 'a', violations: [{ rule: 'R-2', file: 'f', why: 'w', severity: 'ask' }, { rule: 'R-3', file: 'f', why: 'w', severity: 'log' }] }).status, 0);
    assert.equal(run({ verdict: 'pass', reviewed_commit: 'a', violations: [{ rule: 'R-1', file: 'f', why: 'w', severity: 'block' }] }).status, 3);
  });

  test(`[${kind}] force push and history rewrite on a pushed branch are blocked by git itself`, () => {
    const c = prepare(kind);
    git(c.code, 'checkout', '-q', '-b', 'flow/f/1');
    commit(c.code, { [c.newProd]: 'export const x = 1;\n' }, 'feat: x');
    assert.equal(git(c.code, 'push', '-q', 'origin', 'flow/f/1').status, 0);
    git(c.code, 'commit', '--amend', '-qm', 'rewritten');
    const f = git(c.code, 'push', '--force', 'origin', 'flow/f/1');
    assert.notEqual(f.status, 0);
    assert.match(f.out, /non-fast-forward/);
    const del = git(c.code, 'push', 'origin', '--delete', 'flow/f/1');
    assert.notEqual(del.status, 0);
    assert.match(del.out, /deleting/);
  });
}

test('[multi] the hub gates run every target; one broken target fails only itself', () => {
  const c = prepare('multi');
  const hubRun = (tag) => flow(c.code, 'gates.js', ['run', '--target', tag], c.env);
  assert.equal(hubRun('api').status, 0);
  assert.equal(hubRun('app').status, 0);
  const app = join(c.code, '..', 'app');
  commit(app, { 'src/view.js': 'export const view = (x) => x;\n' }, 'break app');
  assert.equal(hubRun('api').status, 0);
  assert.equal(hubRun('app').status, 1);
});

test('[monorepo] one broken package fails only its own target gates', () => {
  const c = prepare('monorepo');
  commit(c.code, { 'packages/b/src/beta.js': 'export const beta = (x) => x;\n' }, 'break b');
  assert.equal(flow(c.code, 'gates.js', ['run', '--target', 'a']).status, 0);
  assert.equal(flow(c.code, 'gates.js', ['run', '--target', 'b']).status, 1);
});
