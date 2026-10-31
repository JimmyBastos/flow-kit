#!/usr/bin/env node
// Git pre-push hook (harness-independent safety net, D7). Installed by flow-setup as .githooks/pre-push.
// stdin lines: <local ref> <local sha> <remote ref> <remote sha>
// Blocks: non-fast-forward (force) pushes, deleting remote branches, and pushing straight to protected branches.
import { spawnSync } from 'node:child_process';

const PROTECTED = (process.env.FLOW_PROTECTED_BRANCHES ?? 'main,master').split(',');
const ZERO = /^0+$/;

export function checkPush(lines, isAncestor) {
  const problems = [];
  for (const line of lines) {
    const [localRef, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
    if (!remoteRef) continue;
    const branch = remoteRef.replace('refs/heads/', '');
    if (ZERO.test(localSha)) { problems.push(`deleting ${remoteRef} is blocked`); continue; }
    if (PROTECTED.includes(branch)) problems.push(`direct push to protected branch "${branch}" is blocked; open a pull request`);
    else if (!ZERO.test(remoteSha) && !isAncestor(remoteSha, localSha)) problems.push(`non-fast-forward push to ${remoteRef} is blocked`);
  }
  return problems;
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', () => {
    const isAncestor = (a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b]).status === 0;
    const problems = checkPush(raw.split('\n').filter(Boolean), isAncestor);
    if (problems.length) { console.error(`flow pre-push:\n  ${problems.join('\n  ')}`); process.exit(1); }
  });
}
