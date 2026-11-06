// Shared behavior of the fake agents (claude.cjs, opencode.cjs). It plays the next outcome from $FAKE/script
// (one per line) for whichever skill the prompt holds, and logs each call to $FAKE/calls.jsonl.
//   task runs:   done | question       (commits a change and writes the PR body file)
//   review runs: merge | fix | escalate (writes the summary with a review marker for HEAD; a fix also writes one line comment)
//   any run:     limit                 (the model is unavailable; the outcome is not consumed by a later model)
//   tick/sync:   error                 (the run fails)
const fs = require('fs');
const { execFileSync } = require('child_process');

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

exports.play = (agent, model, prompt) => {
  const argument = name => (prompt.match(new RegExp(`^${name}: (.+)$`, 'm')) || [])[1];
  const scriptFile = `${process.env.FAKE}/script`;
  const [outcome, ...rest] = fs.readFileSync(scriptFile, 'utf8').split('\n').filter(Boolean);
  fs.writeFileSync(scriptFile, rest.join('\n'));
  const skill = (prompt.match(/^# (flow-[\w-]+)/m) || [])[1];
  fs.appendFileSync(`${process.env.FAKE}/calls.jsonl`, JSON.stringify({ agent, model, skill, outcome, forced: !!argument('force') }) + '\n');

  if (outcome === 'limit') return { unavailable: `usage limit reached for ${model}` };
  if (skill === 'flow-orchestrate' || skill === 'flow-sync') {
    if (outcome === 'error') return { error: 'the run crashed' };
    return { result: { status: 'done', summary: 'nothing to do' } };
  }
  if (skill === 'flow-review') {
    const sha = git('rev-parse', 'HEAD');
    const marker = `## Review\n<!-- flow-review sha=${sha} recommendation=${outcome} -->`;
    fs.writeFileSync(argument('review summary file'), marker);
    const inline = outcome === 'fix' ? [{ path: 'a.txt', line: 1, body: '**🔴 Block** · fake line comment' }] : [];
    fs.writeFileSync(argument('review line comments file'), JSON.stringify(inline));
    return { result: { status: 'done', recommendation: outcome, sha } };
  }
  fs.writeFileSync(`change-${Date.now()}.txt`, 'a change');
  git('add', '-A');
  git('commit', '-qm', 'feat: a change');
  fs.writeFileSync(argument('pr body'), '## What\n- A capability\n\nTask: .flow/feat/tasks/01-first.md\n');
  return { result: outcome === 'question'
    ? { status: 'question', question: 'A or B?', options: ['A', 'B'], recommended: 'A' }
    : { status: 'done', summary: 'did it', decisions: ['kept the old name'] } };
};
