import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prThread, reviewPayload, formatLineComments } from '../skills/flow-orchestrate/flow.js';
import { createSandbox } from './support/sandbox.js';
import { aPr, aComment } from './support/builders.js';

describe('prThread', () => {
  it('orders reviews and comments by time and skips empty reviews', () => {
    const pr = aPr({
      comments: [{ author: { login: 'a' }, body: 'first', createdAt: '2026-01-01T10:00:00Z' }],
      reviews: [
        { author: { login: 'bot' }, body: 'later', submittedAt: '2026-01-01T12:00:00Z' },
        { author: { login: 'bot' }, body: '', submittedAt: '2026-01-01T11:00:00Z' },
      ],
    });
    expect(prThread(pr).map(x => x.body)).toEqual(['first', 'later']);
  });

  it('returns the comments when there are no reviews', () => {
    const pr = aPr({ comments: [aComment('a', 'hi')] });
    expect(prThread(pr)).toEqual(pr.comments);
  });
});

describe('reviewPayload', () => {
  it('keeps only comments on a whole line, on the right side of the reviewed commit', () => {
    const payload = reviewPayload('## Review', [
      { path: 'a.ts', line: 3, body: 'ok' },
      { path: 'a.ts', line: '4', body: 'string line' },
      { path: 'b.ts', body: 'no line' },
      { path: 'c.ts', line: 9, body: '' },
    ], 'abc1234');
    expect(payload).toEqual({
      commit_id: 'abc1234', event: 'COMMENT', body: '## Review',
      comments: [{ path: 'a.ts', line: 3, side: 'RIGHT', body: 'ok' }],
    });
  });
});

describe('formatLineComments', () => {
  it('marks outdated comments and replies, and says so when there are none', () => {
    const text = formatLineComments([
      { id: 1, path: 'a.ts', line: null, original_line: 5, user: 'bot', body: 'old' },
      { id: 2, path: 'a.ts', line: 7, in_reply_to_id: 1, user: 'me', body: 'answer' },
    ]);
    expect(text).toContain('#1 a.ts:5 (outdated) by bot');
    expect(text).toContain('#2 a.ts:7 by me (reply to #1)');
    expect(formatLineComments([])).toBe('No line comments.');
  });
});

describe('the review is one GitHub review', () => {
  it('posts the summary and its line comments as one review', () => {
    const product = createSandbox();
    product.script('done', 'fix');

    const launch = product.flow('launch', 'feat/01');

    expect(launch.status, launch.stderr).toBe(0);
    const [pr] = product.pullRequests();
    expect(pr.reviews).toHaveLength(1);
    expect(pr.reviews[0].body).toMatch(/flow-review sha=\w+ recommendation=fix/);
    expect(pr.lineComments).toMatchObject([{ path: 'a.txt', line: 1, body: expect.stringMatching(/Block/) }]);
  });

  it('falls back to a summary-only review when GitHub refuses the line comments', () => {
    const product = createSandbox();
    product.rejectInline();
    product.script('done', 'fix');

    const launch = product.flow('launch', 'feat/01');

    expect(launch.status, launch.stderr).toBe(0);
    expect(product.task('feat/01').state).toBe('review-fix');
    const [pr] = product.pullRequests();
    expect(pr.reviews).toHaveLength(1);
    expect(pr.reviews[0].body).toMatch(/Line comments that could not be placed on the diff/);
    expect(pr.lineComments).toHaveLength(0);
  });
});

describe('the review template', () => {
  it('ships next to the flow-review skill', () => {
    expect(existsSync(fileURLToPath(new URL('../skills/flow-review/templates/review.md', import.meta.url)))).toBe(true);
  });
});
