#!/usr/bin/env node
// Fake `claude -p`: plays the next outcome from $FAKE/script (one per line) for whichever skill the prompt holds.
//   task runs:   done | question       (commits a change and writes the PR body file)
//   review runs: merge | fix | escalate (posts a review marker for HEAD)
const fs = require('fs');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const prompt = args[args.indexOf('-p') + 1];
const argument = name => (prompt.match(new RegExp(`^${name}: (.+)$`, 'm')) || [])[1];
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

const scriptFile = `${process.env.FAKE}/script`;
const [outcome, ...rest] = fs.readFileSync(scriptFile, 'utf8').split('\n').filter(Boolean);
fs.writeFileSync(scriptFile, rest.join('\n'));

let result;
if (prompt.startsWith('# flow-orchestrate') || prompt.startsWith('# flow-sync')) {
  if (outcome === 'error') {
    console.log(JSON.stringify({ type: 'result', is_error: true, result: 'limit reached' }));
    process.exit(0);
  }
  result = { status: 'done', summary: 'nothing to do' };
} else if (prompt.startsWith('# flow-review')) {
  const sha = git('rev-parse', 'HEAD');
  const marker = `## Review\n<!-- flow-review sha=${sha} recommendation=${outcome} -->`;
  execFileSync('gh', ['pr', 'comment', argument('pr'), '-R', argument('repo'), '--body', marker]);
  result = { status: 'done', recommendation: outcome, sha };
} else {
  fs.writeFileSync(`change-${Date.now()}.txt`, 'a change');
  git('add', '-A');
  git('commit', '-qm', 'feat: a change');
  fs.writeFileSync(argument('pr body'), '## What\n- A capability\n\nTask: .flow/feat/tasks/01-first.md\n');
  result = outcome === 'question'
    ? { status: 'question', question: 'A or B?', options: ['A', 'B'], recommended: 'A' }
    : { status: 'done', summary: 'did it', decisions: ['kept the old name'] };
}
console.log(JSON.stringify({ type: 'result', is_error: false, session_id: `session-${Date.now()}`, permission_denials: [],
  usage: { output_tokens: 1 }, result: `Finished.\n${JSON.stringify(result)}` }));
