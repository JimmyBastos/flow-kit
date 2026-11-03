import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parse } from './miniyaml.js';

export const DEFAULTS = {
  topology: 'single',
  tracker: 'none',
  workspace: 'git-worktree',
  flow_dir: '.flow',
  fallback: 'unavailable',
  model_policy: { providers: {} },
  limits: { max_attempts_per_task: 3, max_task_diff_lines: 300, max_spec_lines: 60, max_plan_lines: 60 },
  merge: { auto: true, required_checks: ['flow-gates / gates'], high_risk_paths: ['**/migrations/**', '**/auth/**', '.github/**', 'infra/**'] },
  test_globs: ['**/*.test.*', '**/*.spec.*', '**/test/**', '**/tests/**', '**/__tests__/**', '**/test_*.py', '**/*_test.go'],
  diff_exempt_globs: [],
};

// Paths an agent must never auto-merge changes to: they are the guardrails themselves.
export const ALWAYS_HIGH_RISK = ['flow.config.yaml', '.github/**', 'scripts/flow/**', '.flow/rules/**', '.flow/decisions/**', 'docs/rules/**', '.githooks/**'];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined || over === null ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? merge(base[k], v) : v;
  return out;
}

// A capability lists base candidates plus optional variants: retry (after a failed review)
// and subagent (smaller models for read-only work handed out by an orchestrating session).
export const CANDIDATE_LISTS = ['candidates', 'retry_candidates', 'subagent_candidates'];

// Keys from older configs. They still parse, but nothing reads them.
const IGNORED_KEYS = ['compaction', 'approvals'];
const IGNORED_LISTS = ['high_risk_candidates'];

function validateCandidate(cfg, at, candidate, errors) {
  if (!candidate.harness) errors.push(`${at}.harness is required`);
  if (!candidate.model) errors.push(`${at}.model is required`);
  const provider = candidate.provider ?? (String(candidate.model ?? '').includes('/') ? String(candidate.model).split('/')[0] : null);
  const policy = provider ? cfg.model_policy?.providers?.[provider] : null;
  if (!policy) return;
  const data = candidate.data_policy;
  if (!isObj(data)) { errors.push(`${at} needs data_policy for provider ${provider}`); return; }
  if (policy.max_retention_days !== undefined && (!Number.isInteger(data.retention_days) || data.retention_days > policy.max_retention_days)) errors.push(`${at} exceeds ${provider} retention policy`);
  if (policy.allow_training === false && data.trains_on_requests !== false) errors.push(`${at} violates ${provider} no-training policy`);
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
      if (Array.isArray(t.gates) && t.gates.some((gate) => String(gate).includes('__'))) errors.push(`targets[${i}] (${t.tag}) still has placeholder gate commands`);
      if (t.required_checks !== undefined && (!Array.isArray(t.required_checks) || t.required_checks.some((x) => typeof x !== 'string' || !x.trim()))) errors.push(`targets[${i}] (${t.tag}) required_checks must be a list of check names`);
    });
  }
  if (!cfg.flow_dir || typeof cfg.flow_dir !== 'string') errors.push('flow_dir must point to the directory that contains flow data');
  if (cfg.fallback !== 'unavailable') errors.push('fallback must be unavailable; task failures do not switch models');
  if (cfg.capabilities !== undefined) {
    if (!isObj(cfg.capabilities)) errors.push('capabilities must be a map of capability names to candidate lists');
    else for (const [name, profile] of Object.entries(cfg.capabilities)) {
      if (!Array.isArray(profile?.candidates) || profile.candidates.length === 0) errors.push(`capabilities.${name}.candidates must be a non-empty list`);
      for (const list of CANDIDATE_LISTS) {
        if (profile?.[list] === undefined) continue;
        if (!Array.isArray(profile[list]) || profile[list].length === 0) { if (list !== 'candidates') errors.push(`capabilities.${name}.${list} must be a non-empty list`); continue; }
        profile[list].forEach((candidate, i) => validateCandidate(cfg, `capabilities.${name}.${list}[${i}]`, candidate, errors));
      }
      if (profile?.prefer_different_harness !== undefined && typeof profile.prefer_different_harness !== 'boolean') errors.push(`capabilities.${name}.prefer_different_harness must be boolean`);
    }
  }
  if (!isObj(cfg.model_policy) || !isObj(cfg.model_policy.providers ?? {})) errors.push('model_policy.providers must be a map of provider ids to data policies');
  else for (const [provider, policy] of Object.entries(cfg.model_policy.providers ?? {})) {
    if (!provider || !isObj(policy)) errors.push(`model_policy.providers.${provider} must be a data policy`);
    if (policy.max_retention_days !== undefined && (!Number.isInteger(policy.max_retention_days) || policy.max_retention_days < 0)) errors.push(`model_policy.providers.${provider}.max_retention_days must be a non-negative integer`);
    if (policy.allow_training !== undefined && typeof policy.allow_training !== 'boolean') errors.push(`model_policy.providers.${provider}.allow_training must be boolean`);
  }
  const l = cfg.limits;
  for (const k of ['max_attempts_per_task', 'max_task_diff_lines', 'max_spec_lines', 'max_plan_lines']) {
    if (!Number.isInteger(l?.[k]) || l[k] < 1) errors.push(`limits.${k} must be a positive integer`);
  }
  if (cfg.diff_exempt_globs !== undefined && (!Array.isArray(cfg.diff_exempt_globs) || cfg.diff_exempt_globs.some((x) => typeof x !== 'string' || !x.trim()))) errors.push('diff_exempt_globs must be a list of globs');
  if (cfg.merge?.required_checks !== undefined && (!Array.isArray(cfg.merge.required_checks) || cfg.merge.required_checks.some((x) => typeof x !== 'string' || !x.trim()))) errors.push('merge.required_checks must be a list of check names');
  if (cfg.merge?.auto && (!Array.isArray(cfg.merge.required_checks) || cfg.merge.required_checks.length === 0)) errors.push('merge.auto requires at least one merge.required_checks entry');
  return errors;
}

// Not errors: the config works, but the user should know.
export function warnings(cfg) {
  const out = [];
  const imp = cfg.capabilities?.implementation?.candidates?.[0]?.harness;
  const rev = cfg.capabilities?.review?.candidates?.[0]?.harness;
  if (imp && rev && imp === rev) out.push('review and implementation use the same first-choice harness; an independent review candidate is preferred');
  for (const key of IGNORED_KEYS) if (cfg[key] !== undefined) out.push(`${key} is no longer used; remove it from flow.config.yaml`);
  if (cfg.capabilities?.repository_exploration) out.push('capabilities.repository_exploration is no longer used: rename it to research and move its small models to research.subagent_candidates');
  if (cfg.capabilities?.utility) out.push('capabilities.utility is no longer used; remove it');
  for (const [name, profile] of Object.entries(cfg.capabilities ?? {})) {
    for (const list of IGNORED_LISTS) if (profile?.[list] !== undefined) out.push(`capabilities.${name}.${list} is no longer used; remove it`);
    if (CANDIDATE_LISTS.some((list) => (profile?.[list] ?? []).some?.((candidate) => candidate?.context_window !== undefined))) out.push(`capabilities.${name}: context_window is no longer used; remove it`);
  }
  return out;
}

export function normalize(raw) {
  return merge(DEFAULTS, raw);
}

export function configPath(path = process.env.FLOW_CONFIG ?? 'flow.config.yaml') {
  return resolve(path);
}

export function flowDir(cfg, path = process.env.FLOW_CONFIG ?? 'flow.config.yaml') {
  if (process.env.FLOW_DIR) return resolve(process.env.FLOW_DIR);
  const configured = cfg?.flow_dir ?? '.flow';
  return isAbsolute(configured) ? configured : resolve(dirname(configPath(path)), configured);
}

export function targetDir(cfg, target, path = process.env.FLOW_CONFIG ?? 'flow.config.yaml') {
  if (process.env.FLOW_TARGET === target.tag) return resolve(process.env.FLOW_TARGET_PATH ?? '.');
  const targetPath = target.path ?? '.';
  return isAbsolute(targetPath) ? targetPath : resolve(dirname(configPath(path)), targetPath);
}

export function requiredChecks(cfg, targetTag = process.env.FLOW_TARGET) {
  const target = targetTag ? cfg.targets?.find((item) => item.tag === targetTag) : null;
  return target?.required_checks ?? cfg.merge?.required_checks ?? [];
}

// In multi topology, targets share the hub config. FLOW_TARGET makes a target worktree run its own gates at ".".
export function loadConfig(path = process.env.FLOW_CONFIG ?? 'flow.config.yaml') {
  const absolute = configPath(path);
  const serialized = process.env.FLOW_CONFIG_B64
    ? Buffer.from(process.env.FLOW_CONFIG_B64, 'base64').toString('utf8')
    : process.env.FLOW_CONFIG_JSON ?? readFileSync(absolute, 'utf8');
  const cfg = normalize(serialized.trimStart().startsWith('{') ? JSON.parse(serialized) : parse(serialized));
  const errors = validate(cfg);
  return { cfg, errors, warnings: warnings(cfg), path: absolute, flowDir: flowDir(cfg, absolute) };
}
