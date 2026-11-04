#!/usr/bin/env node
// Fake `orca`: real git worktrees under $FAKE/wt; `terminal create` runs its command to completion before returning.
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const store = `${process.env.FAKE}/worktrees.json`;
const worktrees = fs.existsSync(store) ? JSON.parse(fs.readFileSync(store, 'utf8')) : [];
const save = list => fs.writeFileSync(store, JSON.stringify(list, null, 1));
const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const reply = result => console.log(JSON.stringify({ ok: true, result }));
const stripPath = selector => selector.replace(/^path:/, '');

const commands = {
  'repo add': () => reply({}),
  'worktree list': () => reply({ worktrees }),
  'worktree create': () => {
    const repo = stripPath(option('--repo'));
    const branch = option('--branch');
    const dir = path.join(process.env.FAKE, 'wt', option('--name'));
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-B', branch, dir, option('--base-branch')]);
    save([...worktrees, { path: dir, branch: `refs/heads/${branch}` }]);
    reply({});
  },
  'worktree rm': () => { save(worktrees.filter(w => w.path !== stripPath(option('--worktree')))); reply({}); },
  'terminal create': () => {
    const run = spawnSync('bash', ['-c', option('--command')], { cwd: stripPath(option('--worktree')), encoding: 'utf8' });
    fs.appendFileSync(`${process.env.FAKE}/terminal.log`, run.stdout + run.stderr);
    reply({ terminal: { handle: 'term-1' } });
  },
};
const command = commands[`${args[0]} ${args[1]}`];
if (!command) { console.error(`fake orca: unsupported: ${args.join(' ')}`); process.exit(1); }
command();
