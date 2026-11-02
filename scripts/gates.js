#!/usr/bin/env node
// Machine checks that run BEFORE any AI judgment.
//   node gates.js run   --target <tag> [--e2e]     run the target's gate commands, fail fast
//   node gates.js size  --feature <slug>           spec/plan line caps
//   node gates.js diff  --base origin/main [--head <ref>]   task diff-size cap (test files reported apart)
//   node gates.js testfirst --base origin/main [--prove [--target <tag>]] [--optional]
//                                                  fix tasks: failing test commit must precede the fix;
//                                                  --prove also runs the gates without the fix and requires a failure
// Exit codes: 0 ok, 1 gate failed, 3 config error.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flowDir, loadConfig, targetDir } from './lib/config.js';
import { matchesAny } from './lib/glob.js';

export function countLines(text) { return text.split('\n').filter((l, i, a) => !(i === a.length - 1 && l === '')).length; }

export function checkSizeCaps(files, limits) {
  const problems = [];
  for (const { name, text } of files) {
    const n = countLines(text);
    const cap = name === 'spec.md' ? limits.max_spec_lines : /^plan-.+\.md$/.test(name) ? limits.max_plan_lines : null;
    if (cap && n > cap) problems.push({ file: name, lines: n, cap, fix: 'split the feature; never compress to fit' });
  }
  return problems;
}

export function collectFlowDocuments(root) {
  const files = [];
  const addMarkdown = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) addMarkdown(path);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push({ name: entry.name, text: readFileSync(path, 'utf8'), path });
    }
  };
  addMarkdown(join(root, 'active'));
  addMarkdown(join(root, 'decisions'));
  return files;
}

// numstat: [{file, added, deleted}] -> excludes .flow/ and lockfiles (not reviewable code).
// Test files are reported apart and do not count, so the cap never rewards writing fewer tests.
export function checkDiffSize(numstat, maxLines, testGlobs = []) {
  const counted = numstat.filter((r) => !r.file.startsWith('.flow/') && !/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|uv\.lock|Cargo\.lock|go\.sum)$/.test(r.file));
  const lines = (rows) => rows.reduce((s, r) => s + r.added + r.deleted, 0);
  const isTest = (r) => matchesAny(r.file, testGlobs);
  const total = lines(counted.filter((r) => !isTest(r)));
  return { total, test_lines: lines(counted.filter(isTest)), cap: maxLines, ok: total <= maxLines };
}

const isMetaFile = (f) => f.startsWith('.flow/') || /\.(md|txt)$/.test(f);

// commits: oldest -> newest, each {sha, files:[...]}. A fix must have a commit touching tests
// strictly before the first commit touching production code.
export function checkTestFirst(commits, testGlobs) {
  const isTest = (f) => matchesAny(f, testGlobs);
  let testCommit = null;
  for (const c of commits) {
    const prod = c.files.filter((f) => !isTest(f) && !isMetaFile(f));
    const tests = c.files.filter(isTest);
    if (prod.length && tests.length && !testCommit) return { ok: false, sha: c.sha, reason: `commit ${c.sha.slice(0, 7)} mixes tests and production code; commit the failing test first, alone` };
    if (prod.length && !testCommit) return { ok: false, sha: c.sha, reason: `commit ${c.sha.slice(0, 7)} changes production code (${prod[0]}) before any test commit` };
    if (tests.length && !prod.length && !testCommit) testCommit = c.sha;
  }
  return testCommit ? { ok: true, test_commit: testCommit } : { ok: false, reason: 'no test commit found' };
}

// Proves the test reproduces the problem: put the production files back as they were at the test commit,
// run the gates, require a failure, then restore HEAD. Needs a clean tree, and touches only those files.
export function proveTestFails({ testCommit, testGlobs, targets, cfg }) {
  const isTest = (f) => matchesAny(f, testGlobs);
  const existsAt = (ref, f) => spawnSync('git', ['cat-file', '-e', `${ref}:${f}`]).status === 0;
  if (git(['status', '--porcelain']).trim()) return { ok: false, reason: '--prove needs a clean working tree; commit or stash first' };
  const root = git(['rev-parse', '--show-toplevel']).trim();
  const files = git(['diff', '--name-only', testCommit, 'HEAD']).split('\n').filter((f) => f && !isTest(f) && !isMetaFile(f));
  if (!files.length) return { ok: false, reason: `no production change after test commit ${testCommit.slice(0, 7)}` };
  const place = (ref) => {
    for (const f of files) {
      if (existsAt(ref, f)) git(['-C', root, 'checkout', ref, '--', f]);
      else rmSync(join(root, f), { force: true });
    }
  };
  let results;
  try {
    place(testCommit);
    results = targets.map((t) => ({ target: t.tag, ...runGates(t.gates, targetDir(cfg, t)) }));
  } finally {
    spawnSync('git', ['-C', root, 'reset', '-q', 'HEAD', '--', ...files]);
    place('HEAD');
  }
  const failed = results.filter((r) => !r.ok).map((r) => r.target);
  return failed.length
    ? { ok: true, test_commit: testCommit, failed_without_fix: failed }
    : { ok: false, test_commit: testCommit, reason: `the gates pass at ${testCommit.slice(0, 7)} without the fix; the test does not reproduce the problem` };
}

export function runGates(commands, cwd) {
  const results = [];
  for (const cmd of commands) {
    // a gate that inherits an outer test runner's context can skip all its tests and still exit 0
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(cmd, { shell: true, cwd, encoding: 'utf8', env });
    results.push({ cmd, status: r.status, output: ((r.stdout ?? '') + (r.stderr ?? '')).slice(-4000) });
    if (r.status !== 0) break; // fail fast: cheapest gates first, ordering is the config's job
  }
  return { ok: results.every((r) => r.status === 0), results };
}

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = (n, d) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : d; };
  const { cfg, errors } = loadConfig();
  if (errors.length) { console.error(errors.join('\n')); process.exit(3); }
  let out;
  if (cmd === 'run') {
    const t = cfg.targets.find((x) => x.tag === arg('--target', cfg.targets[0].tag));
    if (!t) { console.error('unknown target'); process.exit(3); }
    const commands = [...t.gates, ...(rest.includes('--e2e') && t.e2e ? [t.e2e] : [])];
    out = runGates(commands, targetDir(cfg, t));
  } else if (cmd === 'size') {
    const dir = join(flowDir(cfg), 'active', arg('--feature'));
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') })) : [];
    const problems = checkSizeCaps(files, cfg.limits);
    out = { ok: problems.length === 0, problems };
  } else if (cmd === 'docs') {
    const files = collectFlowDocuments(flowDir(cfg));
    const size = checkSizeCaps(files, cfg.limits);
    out = { ok: size.length === 0, size };
  } else if (cmd === 'diff') {
    const base = arg('--base', 'origin/main');
    const head = arg('--head', 'HEAD');
    const numstat = git(['diff', '--numstat', `${base}...${head}`]).split('\n').filter(Boolean).map((l) => { const [a, d, f] = l.split('\t'); return { file: f, added: Number(a) || 0, deleted: Number(d) || 0 }; });
    out = checkDiffSize(numstat, cfg.limits.max_task_diff_lines, cfg.test_globs);
  } else if (cmd === 'testfirst') {
    const base = arg('--base', 'origin/main');
    const shas = git(['rev-list', '--reverse', `${base}..HEAD`]).split('\n').filter(Boolean);
    const commits = shas.map((sha) => ({ sha, files: git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha]).split('\n').filter(Boolean) }));
    out = checkTestFirst(commits, cfg.test_globs);
    // --optional: CI cannot see the task type, so a branch without test-first commits is skipped, not failed.
    if (!out.ok && rest.includes('--optional')) out = { ok: true, skipped: `not a test-first branch: ${out.reason}` };
    else if (out.ok && rest.includes('--prove')) {
      const tag = arg('--target', null);
      const targets = tag ? cfg.targets.filter((t) => t.tag === tag) : cfg.targets;
      if (!targets.length) { console.error('unknown target'); process.exit(3); }
      out = proveTestFails({ testCommit: out.test_commit, testGlobs: cfg.test_globs, targets, cfg });
    }
  } else { console.error('usage: gates.js run|size|docs|diff|testfirst'); process.exit(2); }
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}
