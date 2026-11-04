#!/usr/bin/env node
// Fake `claude -p ... --output-format json` (see agent.cjs for the outcomes).
const args = process.argv.slice(2);
const r = require('./agent.cjs').play('claude', args[args.indexOf('--model') + 1], args[args.indexOf('-p') + 1]);

const failure = r.unavailable || r.error;
console.log(JSON.stringify(failure
  ? { type: 'result', is_error: true, result: failure }
  : { type: 'result', is_error: false, session_id: `session-${Date.now()}`, permission_denials: [], usage: { output_tokens: 1 },
      total_cost_usd: 0.01, result: `Finished.\n${JSON.stringify(r.result)}` }));
