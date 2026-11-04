import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSandbox } from './support/sandbox.js';

describe('a task from launch to merge', () => {
  it('implements, pushes, opens a draft PR and reviews it in one launch', () => {
    const product = createSandbox();
    product.script('done', 'merge');

    const launch = product.flow('launch', 'feat/01');

    expect(launch.status, launch.stderr).toBe(0);
    expect(product.task('feat/01')).toMatchObject({ state: 'review-merge', running: false, pr: { number: 1, draft: true } });
  });

  it('merges on a merge review, records the decisions and unblocks the next task', () => {
    const product = createSandbox();
    product.script('done', 'merge');
    product.flow('launch', 'feat/01');

    const merge = product.flow('merge', 'app', '1');

    expect(merge.status, merge.stderr).toBe(0);
    expect(product.task('feat/01').state).toBe('merged');
    expect(product.task('feat/02').state).toBe('ready');
    expect(product.git(product.hub, 'show', 'origin/main:.flow/feat/tasks/01-first.md')).toMatch(/## Decisions\n- kept the old name/);
  });

  it('logs every step with the session of each run', () => {
    const product = createSandbox();
    product.script('done', 'merge');
    product.flow('launch', 'feat/01');
    product.flow('merge', 'app', '1');

    const log = product.flow('status', '--log', '--task', 'feat/01').stdout;

    expect(log).toMatch(/launch[\s\S]*sync[\s\S]*implement[\s\S]*push[\s\S]*pr[\s\S]*review[\s\S]*merge/);
    expect(log).toMatch(/session=session-/);
  });
});

describe('fix rounds', () => {
  it('refuses to merge on a fix review, and a fix run brings it to merge', () => {
    const product = createSandbox();
    product.script('done', 'fix');
    product.flow('launch', 'feat/01');

    expect(product.task('feat/01').state).toBe('review-fix');
    expect(product.flow('merge', 'app', '1').stdout).toMatch(/refused: review recommends fix/);

    product.script('done', 'merge');
    product.flow('launch', 'feat/01', '--fix');

    expect(product.task('feat/01')).toMatchObject({ state: 'review-merge', pr: { fix_rounds: 1 } });
  });

  it('refuses to merge a commit pushed after the review', () => {
    const product = createSandbox();
    product.script('done', 'merge');
    product.flow('launch', 'feat/01');
    const worktree = product.worktree('feat/01');
    writeFileSync(join(worktree, 'late.txt'), 'pushed after the review');
    product.git(worktree, 'add', '-A');
    product.git(worktree, 'commit', '-qm', 'late change');
    product.git(worktree, 'push', '-q', 'origin', 'HEAD:flow/feat/01');

    expect(product.task('feat/01').state).toBe('needs-review');
    expect(product.flow('merge', 'app', '1').stdout).toMatch(/refused: review is for/);
  });
});

describe('questions and limits', () => {
  it('opens a draft PR with the implementer question as a comment', () => {
    const product = createSandbox();
    product.script('question');

    product.flow('launch', 'feat/01');

    expect(product.task('feat/01').state).toBe('question');
    expect(product.pullRequests()[0].comments[0].body).toMatch(/Question from the implementer:\*\* A or B\?/);
  });

  it('refuses a second launch while the task runs', () => {
    const product = createSandbox();
    product.markRunning('feat/01');

    const launch = product.flow('launch', 'feat/01');

    expect(launch.status).toBe(2);
    expect(launch.stdout).toMatch(/refused: feat\/01 is already running/);
  });

  it('refuses a task whose dependency is not merged', () => {
    const product = createSandbox();

    expect(product.flow('launch', 'feat/02').stdout).toMatch(/refused: feat\/02: dependencies not merged/);
  });
});
