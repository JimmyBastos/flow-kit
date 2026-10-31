// Pure functions that merge flow-kit settings into each harness's existing config. Idempotent.
const GUARD_CMD = 'node scripts/flow/guard-destructive.js';
const PRECOMPACT_CMD = 'node scripts/flow/checkpoint.js';
const SESSION_CMD = 'node scripts/flow/session-start.js';
export const SECRET_DENY = ['Read(./.env)', 'Read(./.env.*)', 'Read(./**/.env)', 'Read(./**/.env.*)', 'Read(./**/*creds*)', 'Read(./**/*.pem)'];
const SECRET_ALLOW_BACK = ['Read(./.env.example)', 'Read(./**/.env.example)'];

function addHook(settings, event, matcher, command) {
  settings.hooks ??= {};
  settings.hooks[event] ??= [];
  const exists = settings.hooks[event].some((h) => h.hooks?.some((x) => x.command === command));
  if (!exists) settings.hooks[event].push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout: 30 }] });
}

export function mergeClaudeSettings(existing = {}) {
  const s = structuredClone(existing);
  addHook(s, 'PreToolUse', 'Bash|Read|Edit|Write', GUARD_CMD);
  addHook(s, 'PreCompact', null, PRECOMPACT_CMD);
  addHook(s, 'SessionStart', 'compact|resume', SESSION_CMD);
  s.permissions ??= {};
  s.permissions.deny = [...new Set([...(s.permissions.deny ?? []), ...SECRET_DENY])];
  s.permissions.allow = [...new Set([...(s.permissions.allow ?? []), ...SECRET_ALLOW_BACK])];
  return s;
}

// Codex: token count, not percent; interactive only.
export function mergeCodexToml(existing = '', windowTokens, percent) {
  const limit = Math.floor((windowTokens * percent) / 100);
  const set = (text, key, value) => {
    const re = new RegExp(`^${key}\\s*=.*$`, 'm');
    return re.test(text) ? text.replace(re, `${key} = ${value}`) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${key} = ${value}\n`;
  };
  return set(set(existing, 'model_context_window', windowTokens), 'model_auto_compact_token_limit', limit);
}

// OpenCode: key name depends on major version (v1 "reserved", v2 "buffer"). Unknown version -> "reserved" + warning.
export function mergeOpencodeJson(existing = {}, windowTokens, percent, majorVersion = null) {
  const key = majorVersion !== null && majorVersion >= 2 ? 'buffer' : 'reserved';
  const o = structuredClone(existing);
  o.compaction = { ...(o.compaction ?? {}), auto: true, [key]: windowTokens - Math.floor((windowTokens * percent) / 100) };
  const other = key === 'buffer' ? 'reserved' : 'buffer';
  delete o.compaction[other];
  return { json: o, key, verified: majorVersion !== null };
}

export const CLAUDE_MD = '@AGENTS.md\n';
export const PRE_PUSH_HOOK = '#!/bin/sh\nexec node scripts/flow/pre-push.js "$@"\n';
export const compactionEnvLine = (percent) => `export CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=${percent}`;
