import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../scripts/lib/miniyaml.js';

test('scalars, null and comments', () => {
  assert.deepEqual(parse('a: 1\nb: true\nc: null # note\nd: "x # y"\ne: hello world'), {
    a: 1, b: true, c: null, d: 'x # y', e: 'hello world',
  });
});

test('nested maps and inline collections', () => {
  const doc = parse(`
topology: single
limits:
  max_attempts_per_task: 3
approvals:
  drift: { block: [contradicts_spec], ask: [new_behavior], log: [rename, refactor] }
`);
  assert.equal(doc.limits.max_attempts_per_task, 3);
  assert.deepEqual(doc.approvals.drift.log, ['rename', 'refactor']);
});

test('block list of maps with inline gates list', () => {
  const doc = parse(`
targets:
  - tag: api
    path: .
    gates: ["npm run lint", "npm test"]
  - tag: app
    remote: git@host:org/app.git
`);
  assert.equal(doc.targets.length, 2);
  assert.equal(doc.targets[0].gates[1], 'npm test');
  assert.equal(doc.targets[1].remote, 'git@host:org/app.git');
});

test('block list of scalars under a key', () => {
  const doc = parse('paths:\n  - "**/migrations/**"\n  - infra/**\nafter: 1');
  assert.deepEqual(doc.paths, ['**/migrations/**', 'infra/**']);
  assert.equal(doc.after, 1);
});

test('rejects tabs', () => {
  assert.throws(() => parse('a:\n\tb: 1'), /tabs/);
});
