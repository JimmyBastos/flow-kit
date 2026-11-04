import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSettings, resolveAgent, runAgent, DEFAULTS } from '../skills/flow-orchestrate/flow.js';
import { isUnavailable, opencodeConfig, opencodeMcp, parseOpencodeEvents } from '../skills/flow-orchestrate/agents.js';
import { aConfig } from './support/builders.js';
import { writeFileSync } from 'node:fs';

describe('choosing the agent', () => {
  it('runs on Claude Code with the kit defaults when flow.json names nothing', () => {
    const { agent, review_agent, models } = resolveAgent({});

    expect(agent).toBe('claude');
    expect(review_agent).toBe('claude');
    expect(models.implement).toEqual(DEFAULTS.models.claude.implement);
  });

  it('runs every role on the agent flow.json names, with that agent\'s models', () => {
    const { agent, models } = resolveAgent({ agent: 'opencode' });

    expect(agent).toBe('opencode');
    expect(models.plan).toEqual(DEFAULTS.models.opencode.plan);
  });

  it('lets FLOW_AGENT override flow.json for one run', () => {
    expect(resolveAgent({ agent: 'claude' }, 'opencode').agent).toBe('opencode');
  });

  it('reviews on review_agent with that agent\'s review models', () => {
    const { agent, models } = resolveAgent({ agent: 'claude', review_agent: 'opencode' });

    expect(agent).toBe('claude');
    expect(models.review).toEqual(DEFAULTS.models.opencode.review);
    expect(models.implement).toEqual(DEFAULTS.models.claude.implement);
  });

  it('takes per-agent model overrides, as one model or a fallback list', () => {
    const { models } = resolveAgent({ agent: 'opencode', models: { opencode: { review: 'x/one', plan: ['x/a', 'x/b'] } } });

    expect(models.review).toEqual(['x/one']);
    expect(models.plan).toEqual(['x/a', 'x/b']);
  });

  it('reads the legacy role-to-model map as Claude models', () => {
    expect(resolveAgent({ models: { review: 'sonnet' } }).models.review).toEqual(['sonnet']);
  });

  it('refuses an agent it has no adapter for', () => {
    expect(() => resolveAgent({ agent: 'nope' })).toThrow(/unknown agent "nope"/);
  });
});

describe('OpenCode permissions', () => {
  const worker = opencodeConfig(buildSettings('worker', { allow: ['Bash(pnpm *)'] }), { maxTurns: 50, dirs: ['/run', '/hub'] });
  const p = worker.permission;

  it('denies every tool the settings do not allow, and never asks', () => {
    expect(p['*']).toBe('deny');
    expect(JSON.stringify(p)).not.toMatch(/"ask"/);
    expect(p.webfetch).toBe('deny');
  });

  it('allows the listed commands and keeps the denied ones denied, later rules winning', () => {
    expect(p.shell['*']).toBe('deny');
    expect(p.shell['git status *']).toBe('allow');
    expect(p.shell['pnpm *']).toBe('allow');
    expect(p.shell['git push *']).toBe('deny');
    const keys = Object.keys(p.shell);
    expect(keys.indexOf('git push *')).toBeGreaterThan(keys.indexOf('git status *'));
  });

  it('keeps secrets unreadable and .flow and .claude read-only', () => {
    expect(p.read).toMatchObject({ '*': 'allow', '.env': 'deny', '**/.env': 'deny' });
    expect(p.edit).toMatchObject({ '*': 'allow', '.flow/**': 'deny', '**/.flow/**': 'deny', '**/.claude/**': 'deny' });
  });

  it('reaches only the run and hub folders outside the worktree, and caps the steps', () => {
    expect(p.external_directory).toEqual({ '*': 'deny', '/run/**': 'allow', '/hub/**': 'allow' });
    expect(worker.agent.build.steps).toBe(50);
  });

  it('lets the orchestrator only read and run flow.js and gh reads', () => {
    const o = opencodeConfig(buildSettings('orchestrator', { flowJs: '/kit/flow.js' })).permission;

    expect(o.edit).toBe('deny');
    expect(o.shell).toMatchObject({ '*': 'deny', 'node /kit/flow.js status *': 'allow', 'gh pr view *': 'allow' });
  });

  it('reaches the MCP tools only for a role allowed an MCP server, with every built-in it is not allowed denied', () => {
    const tracker = opencodeConfig(buildSettings('tracker', { flowJs: '/kit/flow.js' })).permission;

    expect(tracker['*']).toBe('allow');
    expect(tracker.execute).toBe('allow');
    expect(tracker.edit).toBe('deny');
    expect(tracker.webfetch).toBe('deny');
    expect(tracker.shell).toMatchObject({ '*': 'deny', 'node /kit/flow.js status *': 'allow' });
    expect(p['*']).toBe('deny');
    expect(p.execute).toBe('deny');
  });

  it('translates Claude MCP servers to OpenCode ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-'));
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { linear: { type: 'http', url: 'https://mcp.linear.app/mcp' }, local: { command: 'node', args: ['s.js'] } } }));

    expect(opencodeMcp(join(dir, '.mcp.json'))).toEqual({
      linear: { type: 'remote', url: 'https://mcp.linear.app/mcp', enabled: true },
      local: { type: 'local', command: ['node', 's.js'], enabled: true },
    });
  });
});

describe('OpenCode output', () => {
  const line = o => JSON.stringify({ sessionID: 'ses_1', ...o });
  const out = [
    line({ type: 'step_start', part: {} }),
    line({ type: 'tool_use', part: { tool: 'shell', state: { status: 'error', input: { command: 'git push' }, error: 'Permission denied: shell' } } }),
    line({ type: 'step_finish', part: { cost: 0.5, tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 3 } } } }),
    line({ type: 'step_finish', part: { cost: 0.25, tokens: { input: 5, output: 1 } } }),
    line({ type: 'text', part: { text: 'Done.\n{"status":"done"}' } }),
  ].join('\n');

  it('reads the final text, the session, the summed usage and the denied calls', () => {
    expect(parseOpencodeEvents(out)).toEqual({
      sessionId: 'ses_1', text: 'Done.\n{"status":"done"}', denials: ['git push'], errors: [],
      usage: { input_tokens: 15, output_tokens: 3, reasoning_tokens: 1, cache_read_tokens: 3, cost_usd: 0.75 },
    });
  });
});

describe('model fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-'));
  const fakeAgent = outcomes => ({
    calls: [],
    run(o) { this.calls.push(o.model); return outcomes.shift(); },
  });
  const ok = { isError: false, text: '{"status":"done","summary":"ok"}' };
  const config = (extra = {}) => aConfig({ hub: '/hub', max_turns: 10, models: { ...aConfig().models, implement: ['first', 'second'] }, ...extra });
  const run = (cfg, agents, role = 'implement') => runAgent(cfg, { cwd: dir, access: 'worker', role, skill: 'flow-task', args: '', dir, kind: 'implement' }, agents);

  it('tells an unavailable model from a failed run', () => {
    expect(isUnavailable({ isError: true, error: 'Claude AI usage limit reached' })).toBe(true);
    expect(isUnavailable({ isError: true, error: 'Model unavailable: opencode-go/x' })).toBe(true);
    expect(isUnavailable({ isError: true, error: 'opencode: binary not found' })).toBe(true);
    expect(isUnavailable({ isError: true, error: 'the tests failed' })).toBe(false);
    expect(isUnavailable({ isError: false, text: 'rate limit in the code under test' })).toBe(false);
  });

  it('moves to the role\'s next model when one is unavailable, and records it', () => {
    const claude = fakeAgent([{ isError: true, error: 'usage limit reached' }, ok]);

    const r = run(config(), { claude });

    expect(claude.calls).toEqual(['first', 'second']);
    expect(r).toMatchObject({ status: 'done', agent: 'claude', model: 'second' });
    expect(r.fallback_from[0]).toMatch(/^first: usage limit/);
  });

  it('never retries a run that failed for any other reason', () => {
    const claude = fakeAgent([{ isError: true, error: 'segfault' }, ok]);

    expect(run(config(), { claude })).toMatchObject({ status: 'error', model: 'first' });
    expect(claude.calls).toEqual(['first']);
  });

  it('runs the review on review_agent', () => {
    const claude = fakeAgent([]), opencode = fakeAgent([ok]);

    const r = run(config({ review_agent: 'opencode', models: { ...aConfig().models, review: ['oc/review'] } }), { claude, opencode }, 'review');

    expect(r).toMatchObject({ agent: 'opencode', model: 'oc/review' });
    expect(claude.calls).toEqual([]);
  });
});
