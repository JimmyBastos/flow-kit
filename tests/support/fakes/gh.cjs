#!/usr/bin/env node
// Fake `gh`: pull requests live in $FAKE/prs.json; a PR's head is read from the bare remote in $REMOTE.
// Reviews posted with `gh api repos/<r>/pulls/<n>/reviews` land in `reviews`, their line comments in `lineComments`.
// If $FAKE/reject-inline exists, a review with line comments is refused (the flow must then post it summary-only).
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

const [top, sub, target] = args;
const command = top === 'api' ? 'api' : sub;
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
      mergeable: 'MERGEABLE', headRefOid: headOf(branch), url: 'u', body: text(), comments: [], reviews: [], lineComments: [] });
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
  api: () => {
    const endpoint = args.find(a => a.startsWith('repos/')) || '';
    const m = endpoint.match(/\/pulls\/(\d+)\/(reviews|comments)$/);
    const pr = m && find(m[1]);
    if (!pr) { console.error(`fake gh: unsupported api: ${args.join(' ')}`); process.exit(1); }
    if (m[2] === 'comments') { for (const c of pr.lineComments) console.log(JSON.stringify(c)); return; }
    const payload = JSON.parse(fs.readFileSync(option('--input'), 'utf8'));
    if (fs.existsSync(`${process.env.FAKE}/reject-inline`) && payload.comments.length) {
      console.error('Validation Failed: pull_request_review_thread.line could not be resolved');
      process.exit(1);
    }
    pr.reviews.push({ author: { login: 'me' }, body: payload.body, submittedAt: new Date().toISOString(), state: 'COMMENTED', commit_id: payload.commit_id });
    for (const c of payload.comments) {
      pr.lineComments.push({ id: pr.lineComments.length + 1, path: c.path, line: c.line, original_line: c.line, in_reply_to_id: null, body: c.body, user: 'me' });
    }
    save();
  },
};
if (!commands[command]) { console.error(`fake gh: unsupported: ${args.join(' ')}`); process.exit(1); }
commands[command]();
