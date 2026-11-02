#!/usr/bin/env node
// Selects an ordered harness/model candidate for a requested capability.
// Availability is supplied by the harness adapter. Task failures do not trigger fallback;
// only a declared retry_candidates list may change the model after a failed attempt.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadConfig } from './lib/config.js';

export function detectInstalledHarnesses(registryPath = null, run = spawnSync) {
  const adapters = readRegistry(registryPath);
  if (!adapters) return [];
  return Object.entries(adapters).filter(([, adapter]) => run(adapter.command, adapter.detect_args ?? ['--version'], { encoding: 'utf8' }).status === 0).map(([id]) => id);
}

export function readRegistry(registryPath = null) {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = registryPath ?? [join(here, 'adapters/harness/registry.json'), join(here, '../adapters/harness/registry.json')].find(existsSync);
  return path ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

export function resolveDefaultModel(candidate, capability, registry = {}) {
  if (candidate.model !== 'default') return candidate;
  const adapter = registry[candidate.harness] ?? {};
  const variantDefaults = candidate.variant ? adapter.defaults?.[`${capability}.${candidate.variant}`] : null;
  const defaults = variantDefaults ?? adapter.defaults?.[capability] ?? { model: adapter.default_model ?? 'default' };
  return { ...candidate, ...defaults };
}

// Declared variants come first; the base candidates stay as the availability fallback.
// high_risk wins over retry because a risky diff needs the stronger reviewer on every attempt.
export const VARIANT_LISTS = { high_risk: 'high_risk_candidates', retry: 'retry_candidates' };

export function candidatesFor(profile, { retry = false, highRisk = false } = {}) {
  const base = profile?.candidates ?? [];
  const variant = highRisk && profile?.high_risk_candidates?.length ? 'high_risk'
    : retry && profile?.retry_candidates?.length ? 'retry'
    : null;
  if (!variant) return base;
  return [...profile[VARIANT_LISTS[variant]].map((candidate) => ({ ...candidate, variant })), ...base];
}

export function selectCandidate(profile, options = {}) {
  const { availableHarnesses = null, unavailableModels = [], preferDifferentHarness = profile?.prefer_different_harness === true, usedHarness = null, modelPolicy = {}, retry = false, highRisk = false } = options;
  const candidates = candidatesFor(profile, { retry, highRisk });
  const unavailable = new Set(unavailableModels);
  const availableIds = availableHarnesses ?? [...new Set(candidates.filter((candidate) => candidate.harness !== 'auto').map((candidate) => candidate.harness))];
  const expanded = candidates.flatMap((candidate) => candidate.harness === 'auto'
    ? availableIds.map((harness) => ({ ...candidate, harness }))
    : [candidate]);
  const available = expanded.filter((candidate) =>
    availableIds.includes(candidate.harness) &&
    candidateAllowed(candidate, modelPolicy) &&
    !unavailable.has(`${candidate.harness}/${candidate.model}`) &&
    !unavailable.has(candidate.model),
  );
  if (!available.length) return null;
  if (preferDifferentHarness && usedHarness) {
    return available.find((candidate) => candidate.harness !== usedHarness) ?? available[0];
  }
  return available[0];
}

export function compactionForCandidate(candidate, compaction = {}) {
  const contextWindow = candidate.context_window ?? compaction.default_context_window ?? 200000;
  const triggerPercent = compaction.trigger_percent ?? 80;
  return {
    context_window: contextWindow,
    trigger_percent: triggerPercent,
    compact_at_tokens: Math.floor(contextWindow * triggerPercent / 100),
  };
}

export function candidateAllowed(candidate, modelPolicy = {}) {
  const provider = candidate.provider ?? (String(candidate.model ?? '').includes('/') ? String(candidate.model).split('/')[0] : null);
  const policy = provider ? modelPolicy.providers?.[provider] : null;
  if (!policy) return true;
  const data = candidate.data_policy ?? {};
  if (policy.max_retention_days !== undefined && (!Number.isInteger(data.retention_days) || data.retention_days > policy.max_retention_days)) return false;
  if (policy.allow_training === false && data.trains_on_requests !== false) return false;
  return true;
}

function main(args) {
  const [cmd, capability, ...rest] = args;
  if (cmd !== 'select' || !capability) {
    console.error('usage: node capabilities.js select <capability> [--available-harness <id>] [--unavailable <harness/model>] [--used-harness <id>] [--retry] [--high-risk]');
    process.exit(2);
  }
  const { cfg, errors } = loadConfig();
  if (errors.length) { console.error(errors.join('\n')); process.exit(3); }
  const profile = cfg.capabilities?.[capability];
  if (!profile) { console.error(`unknown capability: ${capability}`); process.exit(3); }
  const values = (flag) => {
    const out = [];
    for (let i = 0; i < rest.length; i++) if (rest[i] === flag && rest[i + 1]) out.push(rest[++i]);
    return out;
  };
  const requestedHarnesses = values('--available-harness');
  const available = requestedHarnesses.length ? requestedHarnesses : detectInstalledHarnesses();
  const selected = selectCandidate(profile, {
    availableHarnesses: available,
    unavailableModels: values('--unavailable'),
    preferDifferentHarness: profile.prefer_different_harness === true,
    usedHarness: values('--used-harness')[0] ?? null,
    modelPolicy: cfg.model_policy,
    retry: rest.includes('--retry'),
    highRisk: rest.includes('--high-risk'),
  });
  if (!selected) {
    console.error(`no available candidate for capability: ${capability}`);
    process.exit(4);
  }
  const resolved = resolveDefaultModel(selected, capability, readRegistry());
  console.log(JSON.stringify({ capability, ...resolved, compaction: compactionForCandidate(resolved, cfg.compaction) }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
