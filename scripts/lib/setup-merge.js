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

export const CLAUDE_MD = '@AGENTS.md\n';
export const PRE_PUSH_HOOK = '#!/bin/sh\nexec node scripts/flow/pre-push.js "$@"\n';
