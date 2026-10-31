import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../scripts/lib/guard-rules.js';

const bash = (command) => evaluate({ tool_name: 'Bash', tool_input: { command } });
const denied = (cmd) => assert.equal(bash(cmd).deny, true, `expected DENY: ${cmd}`);
const allowed = (cmd) => assert.equal(bash(cmd).deny, false, `expected ALLOW: ${cmd} (${bash(cmd).reason})`);

test('blocks force pushes in every spelling', () => {
  for (const c of ['git push --force', 'git push -f origin main', 'git push origin main --force-with-lease',
    'git -C repo push -fu origin x', 'git push origin +main', 'echo hi && git push --force']) denied(c);
});

test('allows normal pushes, including --follow-tags (regex false positive)', () => {
  for (const c of ['git push origin feat/x', 'git push --follow-tags', 'git push -u origin feat/x', 'git push --set-upstream origin f']) allowed(c);
});

test('blocks reset --hard, clean, branch -D, checkout .', () => {
  for (const c of ['git reset --hard HEAD~1', 'git clean -fd', 'git branch -D x', 'git checkout .', 'git restore .']) denied(c);
  for (const c of ['git reset --soft HEAD~1', 'git clean -n', 'git clean --dry-run -fd', 'git branch -d merged', 'git checkout -b new']) allowed(c);
});

test('blocks recursive delete of .flow, docs, and broad targets', () => {
  for (const c of ['rm -rf .flow', 'rm -rf ./docs/', 'rm -r docs/rules', 'rm -rf /', 'rm -rf ~', 'rm -rf .', 'rm -Rf .flow/active/x']) denied(c);
  for (const c of ['rm -rf node_modules', 'rm file.txt', 'rm -rf dist build']) allowed(c);
});

test('sees through sh -c, command chains, subshells and xargs', () => {
  for (const c of ['sh -c "git push --force"', 'bash -c \'cd x && git reset --hard\'', 'true; git clean -fd', 'echo $(git reset --hard)',
    'ls | xargs rm -rf .flow', 'sudo git push -f', 'FOO=1 git push --force']) denied(c);
});

test('does not flag quoted text that merely mentions a command', () => {
  allowed('echo "do not git push --force"');
  allowed('git commit -m "docs: explain git reset --hard risks"');
});

test('blocks reading secrets but allows examples', () => {
  for (const c of ['cat .env', 'cat .env.local', 'grep KEY ./config/.env.production', 'head creds.json', 'cat server.pem']) denied(c);
  for (const c of ['cat .env.example', 'cat README.md', 'ls -la']) allowed(c);
  assert.equal(evaluate({ tool_name: 'Read', tool_input: { file_path: '/p/.env' } }).deny, true);
  assert.equal(evaluate({ tool_name: 'Read', tool_input: { file_path: '/p/.env.example' } }).deny, false);
});

test('CLI exits 2 on deny (the real blocking code), 0 on allow, 2 on garbage', () => {
  const cli = fileURLToPath(new URL('../scripts/guard-destructive.js', import.meta.url));
  const run = (stdin) => spawnSync('node', [cli], { input: stdin, encoding: 'utf8' });
  const d = run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push --force' } }));
  assert.equal(d.status, 2);
  assert.match(d.stderr, /force push/);
  assert.equal(JSON.parse(d.stdout).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } })).status, 0);
  assert.equal(run('not json').status, 2);
});
