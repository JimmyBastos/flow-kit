#!/usr/bin/env node
// Fake `opencode run --standalone --format json -m <model> <prompt>` (see agent.cjs for the outcomes).
// It refuses to run without the per-run permissions flow.js must pass.
const args = process.argv.slice(2);
if (args[0] !== 'run' || !args.includes('--standalone') || !process.env.OPENCODE_CONFIG_CONTENT) {
  console.error('fake opencode: expected run --standalone with OPENCODE_CONFIG_CONTENT');
  process.exit(2);
}
const r = require('./agent.cjs').play('opencode', args[args.indexOf('-m') + 1], args[args.length - 1]);

const sessionID = `ses_${Date.now()}`;
const event = (type, extra) => console.log(JSON.stringify({ type, timestamp: Date.now(), sessionID, ...extra }));
if (r.unavailable || r.error) {
  event('error', { error: { type: r.unavailable ? 'provider.no-route' : 'unknown', message: r.unavailable ? `Model unavailable: ${r.unavailable}` : r.error } });
  process.exit(1);
}
event('step_start', { part: { type: 'step-start' } });
event('tool_use', { part: { type: 'tool', tool: 'shell', state: { status: 'error', input: { command: 'git push' }, error: 'Permission denied: shell' } } });
event('step_finish', { part: { type: 'step-finish', cost: 0.002, tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 5, write: 0 } } } });
event('text', { part: { type: 'text', text: `Finished.\n${JSON.stringify(r.result)}` } });
