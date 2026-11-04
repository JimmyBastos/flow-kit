// A throwaway product for end-to-end tests: a hub repo with a planned feature, a bare remote,
// and fake gh / orca / claude / opencode first on PATH. Everything else is real: git, flow.js, the state files.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FLOW = fileURLToPath(new URL('../../skills/flow-orchestrate/flow.js', import.meta.url));
const FAKES = fileURLToPath(new URL('./fakes', import.meta.url));

export function createSandbox({ config = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'flow-e2e-'));
  const bin = join(root, 'bin');
  const remote = join(root, 'remote.git');
  const hub = join(root, 'hub');
  mkdirSync(bin);
  for (const tool of ['gh', 'orca', 'claude', 'opencode']) symlinkSync(join(FAKES, `${tool}.cjs`), join(bin, tool));

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`, ORCA_CLI_COMMAND: join(bin, 'orca'),
    FAKE: root, REMOTE: remote, FLOW_STATE: join(root, 'state'),
    GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.test', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.test',
  };
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
  const write = (path, text) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); };

  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  git(root, 'init', '-q', '-b', 'main', hub);
  write(join(hub, '.flow/flow.json'), JSON.stringify({ product: 'e2e', human: 'me', parallel: 2, repos: { app: { path: '.', github: 'org/app', default: 'main' } }, ...config }));
  write(join(hub, '.flow/feat/spec.md'), '# Feature\n## Success criteria\n- SC-1: it works\n');
  git(hub, 'add', '-A');
  git(hub, 'commit', '-qm', 'docs(flow): spec feat');
  const specSha = git(hub, 'rev-parse', 'HEAD:.flow/feat/spec.md');
  write(join(hub, '.flow/feat/plan-app.md'), `---\nspec_sha: ${specSha}\n---\n# Plan\n`);
  write(join(hub, '.flow/feat/tasks/01-first.md'), '---\nrepo: app\ndepends: []\n---\n# 01 First thing\n');
  write(join(hub, '.flow/feat/tasks/02-second.md'), '---\nrepo: app\ndepends: [01]\n---\n# 02 Second thing\n');
  git(hub, 'add', '-A');
  git(hub, 'commit', '-qm', 'docs(flow): plan feat');
  git(hub, 'remote', 'add', 'origin', remote);
  git(hub, 'push', '-q', '-u', 'origin', 'main');

  const flow = (...args) => spawnSync('node', [FLOW, ...args, '--hub', hub], { cwd: hub, env, encoding: 'utf8' });

  return {
    hub,
    git,
    flow,
    /** The agent runs so far: { agent, model, skill, outcome }. */
    calls: () => { try { return readFileSync(join(root, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } },
    /** The next outcomes the fake agents play, in order (see fakes/agent.cjs). */
    script: (...outcomes) => writeFileSync(join(root, 'script'), outcomes.join('\n')),
    task: id => JSON.parse(flow('status', '--json').stdout).features.flatMap(f => f.items).find(i => i.id === id),
    pullRequests: () => JSON.parse(readFileSync(join(root, 'prs.json'), 'utf8')),
    worktree: id => join(root, 'wt', `flow-${id.replace(/\//g, '-')}`),
    markRunning: id => { const dir = join(root, 'state', 'runs', id.replace(/\//g, '__')); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'pid'), String(process.pid)); },
  };
}
