#!/usr/bin/env node
// Fake `gh`: pull requests live in $FAKE/prs.json; a PR's head is read from the bare remote in $REMOTE.
const fs = require('fs');
const { execFileSync } = require('child_process');

const store = `${process.env.FAKE}/prs.json`;
const prs = fs.existsSync(store) ? JSON.parse(fs.readFileSync(store, 'utf8')) : [];
const save = () => fs.writeFileSync(store, JSON.stringify(prs, null, 1));
const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const text = () => option('--body') ?? fs.readFileSync(option('--body-file'), 'utf8');
const headOf = branch => execFileSync('git', ['--git-dir', process.env.REMOTE, 'rev-parse', `refs/heads/${branch}`], { encoding: 'utf8' }).trim();
const withHead = pr => (pr.state === 'OPEN' ? { ...pr, headRefOid: headOf(pr.headRefName) } : pr);
const find = key => prs.find(pr => String(pr.number) === key || pr.headRefName === key);

const [, command, target] = args;
const commands = {
  list: () => console.log(JSON.stringify(prs.map(withHead))),
  view: () => {
    const pr = find(target);
    if (!pr) { console.error('no pull requests found'); process.exit(1); }
    console.log(JSON.stringify(withHead(pr)));
  },
  create: () => {
    const branch = option('--head');
    prs.push({ number: prs.length + 1, headRefName: branch, title: option('--title'), state: 'OPEN', isDraft: args.includes('--draft'),
      mergeable: 'MERGEABLE', headRefOid: headOf(branch), url: 'u', body: text(), comments: [] });
    save();
  },
  edit: () => { find(target).body = text(); save(); },
  comment: () => { find(target).comments.push({ author: { login: 'me' }, body: text() }); save(); },
  checks: () => console.log('[]'),
  ready: () => { find(target).isDraft = false; save(); },
  merge: () => {
    const pr = withHead(find(target));
    if (option('--match-head-commit') !== pr.headRefOid) { console.error('head branch was modified'); process.exit(1); }
    find(target).state = 'MERGED';
    save();
  },
};
if (!commands[command]) { console.error(`fake gh: unsupported: ${args.join(' ')}`); process.exit(1); }
commands[command]();
