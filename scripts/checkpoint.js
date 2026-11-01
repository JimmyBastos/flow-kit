#!/usr/bin/env node
// PreCompact hook: record where the task is so the next context (any harness) can resume.
// Works only on task branches named flow/<slug>/<id>. Writes state.md; never commits (the agent commits at each step).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseState, serializeState } from './flow-state.js';
import { flowDir } from './lib/config.js';
import { join } from 'node:path';

const git = (...a) => spawnSync('git', a, { encoding: 'utf8' }).stdout?.trim() ?? '';
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const m = branch.match(/^flow\/([^/]+)\/([^/]+)$/);
if (m) {
  const f = join(flowDir(null), 'active', m[1], 'tasks', m[2], 'state.md');
  if (existsSync(f)) {
    const s = parseState(readFileSync(f, 'utf8'));
    s.branch = branch;
    s.last_commit = git('rev-parse', 'HEAD');
    if (s.status === 'todo') s.status = 'in_progress';
    s.next_step ||= 'run flow-resume and continue';
    writeFileSync(f, serializeState(s));
  }
}
process.exit(0);
