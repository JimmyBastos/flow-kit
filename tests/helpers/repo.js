import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const kit = fileURLToPath(new URL('../..', import.meta.url));
const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

// NODE_TEST_CONTEXT is set by an outer `node --test`; if inherited, a nested `node --test` silently
// skips every file and exits 0 (a vacuous pass). Never let child processes see it.
const cleanEnv = (extra) => { const e = { ...process.env, ...GIT_ENV, ...extra }; delete e.NODE_TEST_CONTEXT; return e; };

export function sh(cwd, cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: cleanEnv(env) });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? ''), stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
export const git = (cwd, ...args) => sh(cwd, 'git', args);

// Copy a fixture dir into a temp location, init git with a bare remote, and push main (hooks not installed yet).
export function makeRepo(fixtureDir, tmpRoot = mkdtempSync(join(tmpdir(), 'flowfx-')), name = 'repo') {
  const dir = join(tmpRoot, name);
  cpSync(join(kit, 'fixtures', fixtureDir), dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init');
  const remote = join(tmpRoot, `${name}.git`);
  sh(tmpRoot, 'git', ['init', '-q', '--bare', '-b', 'main', remote]);
  git(dir, 'remote', 'add', 'origin', remote);
  git(dir, 'push', '-q', 'origin', 'main');
  return dir;
}

export function write(dir, files) {
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); }
}
export function commit(dir, files, msg) {
  write(dir, files);
  git(dir, 'add', '-A');
  const r = git(dir, 'commit', '-qm', msg);
  if (r.status !== 0) throw new Error(`commit failed: ${r.out}`);
  return git(dir, 'rev-parse', 'HEAD').stdout.trim();
}
// push bypassing the installed hook: only for fixture bootstrap (it stands in for "a human merged this")
export const bootstrapPush = (dir) => sh(dir, 'git', ['-c', 'core.hooksPath=/dev/null', 'push', '-q', 'origin', 'main']);
export const flow = (dir, script, args = [], env = {}) => sh(dir, 'node', [join(dir, 'scripts/flow', script), ...args], env);
export const setup = (dir, env = {}) => sh(dir, 'node', [join(kit, 'scripts/flow-setup.js')], env);
