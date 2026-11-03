import { describe, it, expect } from 'vitest';
import { buildStatus, deriveState, readFeatures, readPrFacts } from '../skills/flow-orchestrate/flow.js';
import { aConfig, aHubTree, aPlannedFeature, aPlanFile, aPr, aReview, anEscalation, aComment, SPEC_SHA } from './support/builders.js';

function statusOf(files, { prs = [], hubPrs = [], running = [], lastRuns = {}, checks = 'pass' } = {}) {
  return buildStatus(aConfig(), {
    tree: aHubTree(files),
    prsByRepo: { api: prs, __hub: hubPrs },
    pid: id => running.includes(id),
    last: id => lastRuns[id] ?? null,
    checks: () => checks,
  });
}
const stateOf = (status, id) => status.features.flatMap(f => f.items).find(i => i.id === id)?.state;
const withoutPlan = () => { const files = aPlannedFeature(); delete files['.flow/feat/plan-api.md']; return files; };

describe('reading the plan', () => {
  it('reads the spec, the plans and the tasks of each feature', () => {
    const feature = readFeatures(aHubTree(aPlannedFeature())).feat;

    expect(feature.spec.sha).toBe(SPEC_SHA);
    expect(feature.plans.api.spec_sha).toBe(SPEC_SHA);
    expect(Object.keys(feature.tasks)).toEqual(['01', '02', '03']);
    expect(feature.tasks['02']).toMatchObject({ repo: 'api', depends: ['01'], title: 'Second' });
  });
});

describe('task readiness', () => {
  it('makes independent tasks ready at the same time', () => {
    const status = statusOf(aPlannedFeature());

    expect(stateOf(status, 'feat/01')).toBe('ready');
    expect(stateOf(status, 'feat/03')).toBe('ready');
  });

  it('holds a task until its dependency is merged', () => {
    expect(stateOf(statusOf(aPlannedFeature()), 'feat/02')).toBe('waiting-deps');

    const afterMerge = statusOf(aPlannedFeature(), { prs: [aPr({ state: 'MERGED' })] });

    expect(stateOf(afterMerge, 'feat/01')).toBe('merged');
    expect(stateOf(afterMerge, 'feat/02')).toBe('ready');
  });

  it('asks for a plan when a spec has none, and holds its tasks', () => {
    const status = statusOf(withoutPlan());

    expect(stateOf(status, 'feat/plan')).toBe('ready');
    expect(stateOf(status, 'feat/01')).toBe('needs-plan');
  });

  it('asks for a new plan when the spec changed after planning', () => {
    const files = { ...aPlannedFeature(), '.flow/feat/plan-api.md': aPlanFile({ specSha: 'older-spec' }) };

    const status = statusOf(files);

    expect(status.features[0].spec_stale).toBe(true);
    expect(stateOf(status, 'feat/plan')).toBe('ready');
    expect(stateOf(status, 'feat/01')).toBe('needs-plan');
  });
});

describe('run states', () => {
  it.each([
    ['running', { running: ['feat/01'] }],
    ['question', { lastRuns: { 'feat/01': { status: 'question' } } }],
    ['failed', { lastRuns: { 'feat/01': { status: 'error' } } }],
    ['conflicting', { prs: [aPr({ mergeable: 'CONFLICTING' })] }],
  ])('reports %s', (expected, facts) => {
    expect(stateOf(statusOf(aPlannedFeature(), facts), 'feat/01')).toBe(expected);
  });
});

describe('reviews', () => {
  it('counts a review only for the commit it reviewed', () => {
    const reviewed = readPrFacts(aPr({ comments: [aReview('merge')] }));
    const outdated = readPrFacts(aPr({ comments: [aReview('merge', '1111111')] }));

    expect(reviewed.review).toEqual({ sha: 'abcdef1', recommendation: 'merge', current: true });
    expect(outdated.review.current).toBe(false);
  });

  it('turns the current recommendation into the state, and asks for a new review when it is outdated', () => {
    const state = comments => deriveState({ kind: 'task', plan_current: true, pr: readPrFacts(aPr({ comments })) });

    expect(state([aReview('merge')])).toBe('review-merge');
    expect(state([aReview('fix')])).toBe('review-fix');
    expect(state([aReview('merge', '1111111')])).toBe('needs-review');
  });

  it('counts the fix rounds of a pull request', () => {
    const facts = readPrFacts(aPr({ comments: [aReview('fix', '1111111'), aReview('fix', '2222222'), aReview('merge')] }));

    expect(facts.fix_rounds).toBe(2);
  });
});

describe('escalations', () => {
  it('waits for the human after an escalation', () => {
    const facts = readPrFacts(aPr({ comments: [anEscalation()] }), 'me');

    expect(facts.escalation).toEqual({ open: true, replied: false });
    expect(deriveState({ kind: 'task', plan_current: true, pr: facts })).toBe('escalated');
  });

  it('ignores comments from anyone but the human', () => {
    const facts = readPrFacts(aPr({ comments: [anEscalation(), aComment('bot', 'still thinking')] }), 'me');

    expect(facts.escalation.open).toBe(true);
  });

  it('hands the human reply to the orchestrator', () => {
    const facts = readPrFacts(aPr({ comments: [anEscalation(), aComment('me', 'Go with A')] }), 'me');

    expect(facts.escalation).toEqual({ open: false, replied: true });
    expect(facts.replies).toEqual([{ author: 'me', body: 'Go with A' }]);
    expect(deriveState({ kind: 'task', plan_current: true, pr: facts })).toBe('human-replied');
  });
});
