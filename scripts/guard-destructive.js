#!/usr/bin/env node
// PreToolUse guard. Reads the harness hook payload (JSON) on stdin.
// Deny protocol: exit code 2 with the reason on stderr. Claude Code blocks the tool call on exit 2
// (exit 1 is a NON-blocking error, which is the bug in older guard scripts).
// Also prints the JSON permissionDecision form on stdout for harnesses that read it.
// Fails CLOSED on unparseable input for Bash calls.
import { evaluate } from './lib/guard-rules.js';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stderr.write('flow guard: could not parse hook payload; blocking to be safe\n');
    process.exit(2);
  }
  const result = evaluate(input);
  if (result.deny) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `flow guard: ${result.reason}` },
    }));
    process.stderr.write(`flow guard: ${result.reason}\n`);
    process.exit(2);
  }
  process.exit(0);
});
