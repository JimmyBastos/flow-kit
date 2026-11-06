import { describe, it, expect } from 'vitest';
import { skillPrompt } from '../skills/flow-orchestrate/flow.js';

describe('skillPrompt', () => {
  it('tells a headless run to act, then gives the skill and its arguments', () => {
    const prompt = skillPrompt('flow-sync', 'hub: /x');
    expect(prompt.startsWith('Run the skill below now')).toBe(true);
    expect(prompt).toMatch(/^# flow-sync$/m);
    expect(prompt.endsWith('## Arguments\nhub: /x\n')).toBe(true);
  });
});
