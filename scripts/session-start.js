#!/usr/bin/env node
// SessionStart hook (matcher compact|resume). Stdout is added to the model's context.
import { spawnSync } from 'node:child_process';
const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() ?? '';
const m = branch.match(/^flow\/([^/]+)\/([^/]+)$/);
if (m) {
  console.log(`flow-kit: you are on task branch ${branch} (feature "${m[1]}", task ${m[2]}). Context was reset or compacted. Run /flow-resume before doing anything else; state lives in .flow/active/${m[1]}/tasks/${m[2]}/state.md, not in this session.`);
}
process.exit(0);
