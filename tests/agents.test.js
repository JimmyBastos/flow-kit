import { describe, it, expect } from 'vitest';
import { buildSettings, parseResult, skillPrompt, statusHash, frontmatter } from '../skills/flow-orchestrate/flow.js';

describe('agent results', () => {
  it('takes the last JSON object of the final message', () => {
    const message = 'Done. Earlier {"status":"question"} was wrong.\n{"status":"done","decisions":["kept the name"]}';

    expect(parseResult(message)).toEqual({ status: 'done', decisions: ['kept the name'] });
  });

  it('reads a result inside a code fence', () => {
    expect(parseResult('```json\n{"status":"question","options":["A","B"]}\n```')).toMatchObject({ status: 'question' });
  });

  it('treats a message without a result as a failed run', () => {
    expect(parseResult('I could not finish.')).toMatchObject({ status: 'failed' });
  });
});

describe('agent prompts', () => {
  it('uses the skill text without its frontmatter, followed by the arguments', () => {
    const prompt = skillPrompt('flow-task', 'task file: /x/01.md');

    expect(prompt.startsWith('# flow-task')).toBe(true);
    expect(prompt).not.toMatch(/^name:/m);
    expect(prompt.trimEnd().endsWith('## Arguments\ntask file: /x/01.md')).toBe(true);
  });
});

describe('agent settings', () => {
  it('limits the orchestrator to this flow.js and gh reads and comments, failing closed', () => {
    const { permissions } = buildSettings('orchestrator', { flowJs: '/kit/flow.js' });

    expect(permissions.defaultMode).toBe('dontAsk');
    expect(permissions.allow).toContain('Bash(node /kit/flow.js launch *)');
    expect(permissions.allow.some(rule => rule.includes('__FLOW_JS__'))).toBe(false);
    expect(permissions.deny).toEqual(expect.arrayContaining(['Edit', 'Write']));
  });

  it('adds the repo commands to the worker allow list and keeps pushing and agent spawning denied', () => {
    const { permissions } = buildSettings('worker', { allow: ['Bash(pnpm *)'] });

    expect(permissions.defaultMode).toBe('dontAsk');
    expect(permissions.allow).toContain('Bash(pnpm *)');
    expect(permissions.deny).toEqual(expect.arrayContaining(['Bash(git push *)', 'Bash(claude *)', 'Bash(orca *)', 'Edit(**/.flow/**)']));
  });
});

describe('change detection', () => {
  it('ignores timestamps', () => {
    const at = time => ({ task: 'feat/01', last_run: { status: 'done', at: time } });

    expect(statusHash(at('2026-01-01'))).toBe(statusHash(at('2026-02-02')));
  });

  it('notices a real change', () => {
    expect(statusHash({ state: 'ready' })).not.toBe(statusHash({ state: 'running' }));
  });
});

describe('frontmatter', () => {
  it('reads scalars and lists', () => {
    expect(frontmatter('---\nrepo: api\ndepends: [01, 02]\n---\nbody').fm).toEqual({ repo: 'api', depends: ['01', '02'] });
  });

  it('returns nothing for a file without frontmatter', () => {
    expect(frontmatter('# Title').fm).toEqual({});
  });
});
