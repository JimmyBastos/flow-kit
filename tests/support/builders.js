// Builders for the facts flow.js reads. Each returns a valid default; tests override only what they are about.

export const SPEC_SHA = 'aaaa1111';
export const HEAD = 'abcdef1234567890';

export function aConfig(overrides = {}) {
  return {
    product: 'test',
    human: 'me',
    parallel: 2,
    repos: { api: { github: 'org/api', default: 'main', allow: [] } },
    hubRepo: { github: 'org/hub', default: 'main', allow: [] },
    agent: 'claude',
    models: { orchestrator: ['opus'], plan: ['opus'], implement: ['sonnet'], fix_retry: ['opus'], review: ['opus'], sync: ['sonnet'] },
    ...overrides,
  };
}

export function aTaskFile({ repo = 'api', depends = [], title = 'Do the thing' } = {}) {
  return `---\nrepo: ${repo}\ndepends: [${depends.join(', ')}]\n---\n# 01 ${title}\n## Goal\nA goal.\n`;
}

export function aPlanFile({ specSha = SPEC_SHA } = {}) {
  return `---\nspec_sha: ${specSha}\n---\n# Plan\n`;
}

/** A feature with a current plan and three tasks: 01, 02 (depends on 01) and 03. */
export function aPlannedFeature(name = 'feat') {
  return {
    [`.flow/${name}/spec.md`]: '# Feature',
    [`.flow/${name}/plan-api.md`]: aPlanFile(),
    [`.flow/${name}/tasks/01-first.md`]: aTaskFile({ title: 'First' }),
    [`.flow/${name}/tasks/02-second.md`]: aTaskFile({ title: 'Second', depends: ['01'] }),
    [`.flow/${name}/tasks/03-third.md`]: aTaskFile({ title: 'Third' }),
  };
}

/** The hub's default branch, as flow.js reads it through git. */
export function aHubTree(files) {
  return {
    files: Object.keys(files),
    show: path => files[path],
    blob: path => (path.endsWith('spec.md') ? SPEC_SHA : 'other-blob'),
  };
}

export function aPr(overrides = {}) {
  return {
    number: 7, headRefName: 'flow/feat/01', state: 'OPEN', isDraft: true, mergeable: 'MERGEABLE',
    headRefOid: HEAD, url: 'https://example.test/pr/7', comments: [], ...overrides,
  };
}

export const aReview = (recommendation, sha = HEAD.slice(0, 7)) =>
  ({ author: { login: 'bot' }, body: `## Review\n<!-- flow-review sha=${sha} recommendation=${recommendation} -->` });

export const anEscalation = () =>
  ({ author: { login: 'bot' }, body: '@me **Decision needed:** A or B?\n<!-- flow-escalation -->' });

export const aComment = (login, body) => ({ author: { login }, body });
