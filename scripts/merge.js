#!/usr/bin/env node
// Auto-merge decision by risk.
//   node merge.js decide --base origin/main [--head HEAD]   -> prints decision JSON; exit 0 auto, 10 human
//   node merge.js run <pr-number>                          -> decide, then `gh pr merge --auto --squash` or label for human
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, ALWAYS_HIGH_RISK } from './lib/config.js';
import { matchingGlob } from './lib/glob.js';

export function decide({ changedFiles, config, checksPassed = true }) {
  const risky = [...(config.merge?.high_risk_paths ?? []), ...ALWAYS_HIGH_RISK];
  const hits = changedFiles.map((f) => ({ file: f, glob: matchingGlob(f, risky) })).filter((h) => h.glob);
  if (!checksPassed) return { action: 'human', reason: 'required checks have not all passed', hits };
  if (!config.merge?.auto) return { action: 'human', reason: 'merge.auto is false', hits };
  if (changedFiles.length === 0) return { action: 'human', reason: 'empty diff', hits };
  if (hits.length) return { action: 'human', reason: `touches high-risk paths: ${hits.map((h) => h.file).join(', ')}`, hits };
  return { action: 'auto', reason: 'all checks passed and no high-risk path touched', hits: [] };
}

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = (name, dflt) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : dflt; };
  const { cfg, errors } = loadConfig();
  if (errors.length) { console.error(errors.join('\n')); process.exit(3); }
  if (cmd === 'decide') {
    const base = arg('--base', 'origin/main'); const head = arg('--head', 'HEAD');
    const files = git(['diff', '--name-only', `${base}...${head}`]).split('\n').filter(Boolean);
    const d = decide({ changedFiles: files, config: cfg, checksPassed: arg('--checks', 'pass') === 'pass' });
    console.log(JSON.stringify(d, null, 2));
    process.exit(d.action === 'auto' ? 0 : 10);
  } else if (cmd === 'run') {
    const pr = rest[0];
    const out = spawnSync('gh', ['pr', 'view', pr, '--json', 'files,statusCheckRollup'], { encoding: 'utf8' });
    if (out.status !== 0) { console.error(out.stderr); process.exit(3); }
    const info = JSON.parse(out.stdout);
    const checksPassed = (info.statusCheckRollup ?? []).length > 0 && info.statusCheckRollup.every((c) => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c.conclusion));
    const d = decide({ changedFiles: info.files.map((f) => f.path), config: cfg, checksPassed });
    console.log(JSON.stringify(d, null, 2));
    if (d.action === 'auto') process.exit(spawnSync('gh', ['pr', 'merge', pr, '--auto', '--squash'], { stdio: 'inherit' }).status ?? 1);
    spawnSync('gh', ['pr', 'edit', pr, '--add-label', 'needs-human-merge'], { stdio: 'inherit' });
    process.exit(10);
  } else { console.error('usage: merge.js decide|run'); process.exit(2); }
}
