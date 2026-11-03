import { describe, it, expect } from 'vitest';
import { buildStatus, checkLaunch, checkMerge, modelFor, readPrFacts } from '../skills/flow-orchestrate/flow.js';
import { aConfig, aHubTree, aPlannedFeature, aPlanFile, aPr, aReview, anEscalation } from './support/builders.js';

const statusWith = ({ running = [], prs = [], files = aPlannedFeature() } = {}) =>
  buildStatus(aConfig(), { tree: aHubTree(files), prsByRepo: { api: prs, __hub: [] }, pid: id => running.includes(id), last: () => null, checks: () => 'pass' });

describe('launch', () => {
  it('allows a ready task', () => {
    expect(checkLaunch(aConfig(), statusWith(), 'feat/01', 'implement')).toBeNull();
  });

  it('refuses a second run of the same task', () => {
    expect(checkLaunch(aConfig(), statusWith({ running: ['feat/01'] }), 'feat/01', 'implement')).toMatch(/already running/);
  });

  it('refuses when the parallel limit is reached', () => {
    const status = statusWith({ running: ['feat/03'] });
    status.running = 2;

    expect(checkLaunch(aConfig(), status, 'feat/01', 'implement')).toMatch(/parallel limit reached \(2\/2\)/);
  });

  it('refuses a task whose dependencies are not merged', () => {
    expect(checkLaunch(aConfig(), statusWith(), 'feat/02', 'implement')).toMatch(/dependencies not merged \(01\)/);
  });

  it('refuses a task whose plan is older than the spec', () => {
    const files = { ...aPlannedFeature(), '.flow/feat/plan-api.md': aPlanFile({ specSha: 'older-spec' }) };

    expect(checkLaunch(aConfig(), statusWith({ files }), 'feat/01', 'implement')).toMatch(/re-plan first/);
  });

  it('refuses a model that the model policy excludes', () => {
    const config = aConfig({ model_policy: { deny: ['sonnet'] } });

    expect(checkLaunch(config, statusWith(), 'feat/01', 'implement')).toMatch(/model sonnet is excluded/);
  });

  it('refuses a review when there is no pull request', () => {
    expect(checkLaunch(aConfig(), statusWith(), 'feat/01', 'review')).toMatch(/no PR to review/);
  });
});

describe('model choice', () => {
  const task = fixRounds => ({ kind: 'task', pr: { fix_rounds: fixRounds } });

  it('implements and fixes the first round with the implement model', () => {
    expect(modelFor(aConfig(), task(0), 'implement')).toBe('sonnet');
    expect(modelFor(aConfig(), task(1), 'fix')).toBe('sonnet');
  });

  it('uses the retry model from the second fix round', () => {
    expect(modelFor(aConfig(), task(2), 'fix')).toBe('opus');
  });

  it('uses the plan and review models for their runs', () => {
    expect(modelFor(aConfig({ models: { ...aConfig().models, plan: 'p', review: 'r' } }), { kind: 'plan' }, 'implement')).toBe('p');
    expect(modelFor(aConfig({ models: { ...aConfig().models, review: 'r' } }), task(0), 'review')).toBe('r');
  });
});

describe('merge', () => {
  const facts = (overrides = {}) => readPrFacts(aPr({ comments: [aReview('merge')], ...overrides }), 'me');

  it('allows a merge review on the current head with green CI', () => {
    expect(checkMerge(facts(), 'pass')).toBeNull();
  });

  it('allows a repo without CI checks', () => {
    expect(checkMerge(facts(), 'none')).toBeNull();
  });

  it.each([
    ['no review at all', facts({ comments: [] }), 'pass', /no review/],
    ['a review of an older commit', facts({ comments: [aReview('merge', '1111111')] }), 'pass', /review is for 1111111/],
    ['a fix recommendation', facts({ comments: [aReview('fix')] }), 'pass', /recommends fix/],
    ['an open escalation', facts({ comments: [aReview('merge'), anEscalation()] }), 'pass', /escalation is waiting/],
    ['conflicts', facts({ mergeable: 'CONFLICTING' }), 'pass', /conflicts/],
    ['failing CI', facts(), 'fail', /CI is fail/],
    ['pending CI', facts(), 'pending', /CI is pending/],
    ['a merged PR', { ...facts(), state: 'MERGED' }, 'pass', /PR is MERGED/],
  ])('refuses %s', (_, prFacts, checks, reason) => {
    expect(checkMerge(prFacts, checks)).toMatch(reason);
  });
});
