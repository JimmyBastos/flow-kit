import { describe, it, expect } from 'vitest';
import { trackerFor, validIssues, withIssue } from '../skills/flow-orchestrate/trackers.js';

const linear = trackerFor({ tracker: { kind: 'linear', team: 'DOS' } });
const issue = { task: 'feat/01', key: 'DOS-62', url: 'https://linear.app/x/issue/DOS-62' };

describe('tracker adapters', () => {
  it('refuses a missing or unknown tracker', () => {
    expect(() => trackerFor({})).toThrow(/no tracker/);
    expect(() => trackerFor({ tracker: { kind: 'jira' } })).toThrow(/jira is not supported/);
  });

  it('keeps only well-formed issues from a sync run', () => {
    const issues = validIssues([issue, { task: 'feat/02', key: 'not a key', url: 'https://x' }, { task: 'feat/03', key: 'DOS-1' }, null], linear);

    expect(issues).toEqual([issue]);
    expect(validIssues(undefined, linear)).toEqual([]);
  });

  it('names the issue in the PR title and above the Task line', () => {
    const next = withIssue({ title: 'feat(db): store links', body: 'What\n\nTask: .flow/feat/tasks/01-x.md' }, issue, linear);

    expect(next.title).toBe('feat(db): store links (DOS-62)');
    expect(next.body).toBe('What\n\nLinear: [DOS-62](https://linear.app/x/issue/DOS-62)\nTask: .flow/feat/tasks/01-x.md');
    expect(next.changed).toBe(true);
  });

  it('changes nothing when the PR already names the issue', () => {
    const pr = { title: 'feat: x (DOS-62)', body: 'Linear: [DOS-62](https://linear.app/x/issue/DOS-62)\nTask: y' };

    expect(withIssue(pr, issue, linear)).toEqual({ ...pr, changed: false });
  });

  it('appends the line when the body has no Task line', () => {
    expect(withIssue({ title: 't', body: 'only text' }, issue, linear).body).toBe('only text\n\nLinear: [DOS-62](https://linear.app/x/issue/DOS-62)');
  });
});
