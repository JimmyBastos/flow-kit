import { readFileSync } from 'node:fs';
import { parse } from './miniyaml.js';

export const DEFAULTS = {
  topology: 'single',
  tracker: 'none',
  workspace: 'git-worktree',
  limits: { max_attempts_per_task: 3, max_task_diff_lines: 300, max_spec_lines: 60, max_plan_lines: 60 },
  compaction: { context_window: 200000, trigger_percent: 80 },
  approvals: {
    analyze: { block: ['contract', 'coverage', 'not_included'], ask: ['scope'], log: ['format'] },
    drift: { block: ['contradicts_spec'], ask: ['new_behavior'], log: ['rename', 'refactor'] },
  },
  merge: { auto: true, high_risk_paths: ['**/migrations/**', '**/auth/**', '.github/**', 'infra/**'] },
  test_globs: ['**/*.test.*', '**/*.spec.*', '**/test/**', '**/tests/**', '**/__tests__/**', '**/test_*.py', '**/*_test.go'],
};

// Paths an agent must never auto-merge changes to: they are the guardrails themselves.
export const ALWAYS_HIGH_RISK = ['flow.config.yaml', '.github/**', 'scripts/flow/**', '.flow/rules/**', 'docs/rules/**', '.githooks/**'];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined || over === null ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? merge(base[k], v) : v;
  return out;
}

export function validate(cfg) {
  const errors = [];
  if (!['single', 'monorepo', 'multi'].includes(cfg.topology)) errors.push('topology must be single | monorepo | multi');
  if (!['linear', 'github-issues', 'none'].includes(cfg.tracker)) errors.push('tracker must be linear | github-issues | none');
  if (!['git-worktree', 'orca'].includes(cfg.workspace)) errors.push('workspace must be git-worktree | orca');
  if (!Array.isArray(cfg.targets) || cfg.targets.length === 0) errors.push('targets must be a non-empty list');
  else {
    const tags = new Set();
    cfg.targets.forEach((t, i) => {
      if (!t.tag) errors.push(`targets[${i}].tag is required`);
      else if (tags.has(t.tag)) errors.push(`duplicate target tag "${t.tag}"`);
      else tags.add(t.tag);
      if (!t.path && !t.remote) errors.push(`targets[${i}] (${t.tag}) needs path or remote`);
      if (!Array.isArray(t.gates) || t.gates.length === 0) errors.push(`targets[${i}] (${t.tag}) needs at least one gate command`);
    });
  }
  if (cfg.topology === 'multi' && !cfg.hub) errors.push('multi topology requires "hub" (path of the repo that owns .flow/)');
  for (const stage of ['implement', 'review']) {
    const s = cfg.stages?.[stage];
    if (!s?.harness || !s?.model) errors.push(`stages.${stage} needs harness and model (flow-init asks for them)`);
  }
  const l = cfg.limits;
  for (const k of ['max_attempts_per_task', 'max_task_diff_lines', 'max_spec_lines', 'max_plan_lines']) {
    if (!Number.isInteger(l?.[k]) || l[k] < 1) errors.push(`limits.${k} must be a positive integer`);
  }
  const { trigger_percent: p } = cfg.compaction ?? {};
  if (!(p >= 50 && p <= 95)) errors.push('compaction.trigger_percent must be between 50 and 95');
  return errors;
}

// Not errors: the config works, but the user should know.
export function warnings(cfg) {
  const out = [];
  const imp = cfg.stages?.implement?.harness; const rev = cfg.stages?.review?.harness;
  if (imp && rev && imp === rev) out.push('review and implement use the same harness; the review runs in a new session');
  return out;
}

export function normalize(raw) {
  return merge(DEFAULTS, raw);
}

// multi topology: target repos point at the hub's config with FLOW_CONFIG=<hub>/flow.config.yaml
export function loadConfig(path = process.env.FLOW_CONFIG ?? 'flow.config.yaml') {
  const cfg = normalize(parse(readFileSync(path, 'utf8')));
  const errors = validate(cfg);
  return { cfg, errors, warnings: warnings(cfg) };
}
