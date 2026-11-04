// Agent adapters: how flow.js starts one headless agent run. The flow runs on one agent at a time, chosen in
// .flow/flow.json ("agent") or with FLOW_AGENT. To add an agent CLI, add an adapter with the same shape and its
// models in defaults.json.
//
// adapter.run({ cwd, prompt, model, settings, dir, kind, maxTurns, env, dirs, mcpConfig }) returns
//   { code, text, isError, error, sessionId, usage, denials, transcript }
// `settings` is the kit's canonical permission format: Claude Code settings ({ permissions: { allow, deny } }).
// Each adapter translates it for its CLI. Runs must fail closed: anything not allowed is denied.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A run that failed for one of these reasons may succeed on the role's next model. A task failure never matches.
const UNAVAILABLE = /usage limit|rate.?limit|quota|insufficient (credits|balance|quota)|credit balance|overloaded|\b(429|529)\b|model unavailable|no-route|model .{0,40}not (found|available|supported)|not logged in|unauthori[sz]ed|authentication|binary not found/i;
export const isUnavailable = r => !!r.isError && UNAVAILABLE.test(`${r.error || ''} ${r.text || ''}`);

function spawn(cmd, args, { cwd, env, input = '' }) {
  const r = spawnSync(cmd, args, { cwd, env, input, encoding: 'utf8', maxBuffer: 256 << 20 });
  if (r.error?.code === 'ENOENT') return { code: 127, out: '', err: `${cmd}: binary not found` };
  if (r.error) throw r.error;
  return { code: r.status ?? 1, out: r.stdout || '', err: r.stderr || '' };
}

const stamp = (dir, kind, ext) => join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${kind}.${ext}`);

// ---------- Claude Code ----------
const claude = {
  name: 'claude',
  run({ cwd, prompt, model, settings, dir, kind, maxTurns, env, dirs = [], mcpConfig }) {
    const settingsFile = join(dir, `settings-${kind}.json`);
    writeFileSync(settingsFile, JSON.stringify(settings, null, 1));
    // User-level settings are not loaded: a user hook that rewrites commands would slip past the deny rules.
    const args = ['-p', prompt, '--model', model, '--output-format', 'json', '--max-turns', String(maxTurns),
      '--settings', settingsFile, '--setting-sources', 'project,local', ...dirs.flatMap(d => ['--add-dir', d])];
    if (mcpConfig) args.push('--mcp-config', mcpConfig, '--strict-mcp-config');
    const r = spawn('claude', args, { cwd, env });
    const transcript = stamp(dir, kind, 'json');
    writeFileSync(transcript, r.out || r.err);
    let meta = {};
    try { meta = JSON.parse(r.out); } catch {}
    const isError = r.code !== 0 || !!meta.is_error;
    return {
      code: r.code, text: meta.result || '', isError, error: isError ? (meta.result || r.err || `exit ${r.code}`) : null,
      sessionId: meta.session_id, usage: meta.usage && { ...meta.usage, cost_usd: meta.total_cost_usd },
      // A run can report success while tool calls were denied, so the denials travel with the result.
      denials: (meta.permission_denials || []).map(d => d.tool_input?.command || d.tool_name), transcript,
    };
  },
};

// ---------- OpenCode ----------
// Claude rule names to OpenCode permission keys. Read-only listing tools follow Glob.
const OC_KEYS = { Read: ['read'], Glob: ['glob', 'list'], Grep: ['grep'], Edit: ['edit'], Write: ['edit'], NotebookEdit: ['edit'],
  Agent: ['task'], Skill: ['skill'], Bash: ['shell'], WebFetch: ['webfetch'], WebSearch: ['websearch'] };
const ocPattern = p => p.replace(/^\.\//, '');
// OpenCode's built-in tools (v2). MCP tools have exact keys only (`linear_list_teams`; `linear_*` does not match), so a
// role allowed an MCP server gets '*': 'allow' and an explicit deny on every built-in it is not allowed.
const OC_BUILTINS = ['read', 'edit', 'write', 'patch', 'glob', 'grep', 'list', 'shell', 'bash', 'task', 'skill', 'webfetch',
  'websearch', 'codesearch', 'lsp', 'question', 'doom_loop'];

function setRule(perm, key, pattern, action) {
  if (pattern === undefined || pattern === '*') {
    if (typeof perm[key] === 'object') perm[key]['*'] = action; else perm[key] = action;
    return;
  }
  if (typeof perm[key] !== 'object') perm[key] = { '*': perm[key] ?? 'deny' };
  delete perm[key][pattern];
  perm[key][pattern] = action; // OpenCode applies the last matching pattern, so later rules win.
}

export function opencodeConfig(settings, { maxTurns = 200, dirs = [], mcp } = {}) {
  const { allow = [], deny = [] } = settings.permissions || {};
  const usesMcp = allow.some(r => r.startsWith('mcp__'));
  // Deny by default, never ask: a headless run has no one to answer. MCP tools need '*': 'allow' (see OC_BUILTINS).
  const permission = { '*': usesMcp ? 'allow' : 'deny', ...Object.fromEntries(OC_BUILTINS.map(k => [k, 'deny'])),
    todowrite: 'allow', todoread: 'allow', execute: usesMcp ? 'allow' : 'deny',
    external_directory: Object.fromEntries([['*', 'deny'], ...dirs.map(d => [`${d}/**`, 'allow'])]) };
  const apply = (rule, action) => {
    const mcpTool = rule.match(/^mcp__([\w-]+)__([\w-]+)$/);
    if (mcpTool) return setRule(permission, `${mcpTool[1]}_${mcpTool[2]}`, undefined, action);
    if (rule.startsWith('mcp__')) return;
    const m = rule.match(/^(\w+)(?:\((.*)\))?$/);
    for (const key of (m && OC_KEYS[m[1]]) || []) setRule(permission, key, m[2] === undefined ? undefined : ocPattern(m[2]), action);
  };
  allow.forEach(r => apply(r, 'allow'));
  deny.forEach(r => apply(r, 'deny'));
  // A flat 'bash': 'deny' hides the shell tool entirely: OpenCode treats 'bash' as the shell alias and a literal deny
  // on it wins over the pattern rules on 'shell'. Mirror the shell rules onto the alias instead. Without Bash rules
  // the flat deny stays, which is equivalent because '*' already denies every command.
  if (typeof permission.shell === 'object') permission.bash = permission.shell;
  const config = { $schema: 'https://opencode.ai/config.json', permission, agent: { build: { steps: maxTurns } } };
  if (mcp) config.mcp = mcp;
  return config;
}

// Claude's .mcp.json servers in OpenCode's format.
export function opencodeMcp(file) {
  if (!file || !existsSync(file)) return undefined;
  const servers = JSON.parse(readFileSync(file, 'utf8')).mcpServers || {};
  return Object.fromEntries(Object.entries(servers).map(([name, s]) => [name, s.url
    ? { type: 'remote', url: s.url, enabled: true, ...(s.headers ? { headers: s.headers } : {}) }
    : { type: 'local', command: [s.command, ...(s.args || [])], enabled: true, ...(s.env ? { environment: s.env } : {}) }]));
}

export function parseOpencodeEvents(out) {
  const events = out.split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
  const usage = { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cache_read_tokens: 0, cost_usd: 0 };
  const denials = [], errors = [], texts = [];
  for (const e of events) {
    const p = e.part || {};
    if (e.type === 'text' && p.text) texts.push(p.text);
    if (e.type === 'step_finish') {
      usage.input_tokens += p.tokens?.input || 0; usage.output_tokens += p.tokens?.output || 0;
      usage.reasoning_tokens += p.tokens?.reasoning || 0; usage.cache_read_tokens += p.tokens?.cache?.read || 0;
      usage.cost_usd += p.cost || 0;
    }
    if (e.type === 'tool_use' && p.state?.status === 'error' && /permission denied/i.test(p.state.error || ''))
      denials.push(p.state.input?.command || p.state.input?.path || p.tool);
    if (e.type === 'error') errors.push(e.error?.message || e.error?.data?.message || JSON.stringify(e.error));
  }
  return { sessionId: events.find(e => e.sessionID)?.sessionID, text: texts.join('\n'), usage, denials, errors };
}

const opencode = {
  name: 'opencode',
  run({ cwd, prompt, model, settings, dir, kind, maxTurns, env, dirs = [], mcpConfig }) {
    const config = opencodeConfig(settings, { maxTurns, dirs, mcp: opencodeMcp(mcpConfig) });
    writeFileSync(join(dir, `opencode-${kind}.json`), JSON.stringify(config, null, 1));
    // --standalone: the shared background service would ignore this run's permissions.
    // OPENCODE_CONFIG_CONTENT has the highest precedence, above the user's and the repo's opencode.json.
    const r = spawn('opencode', ['run', '--standalone', '--format', 'json', '-m', model, prompt],
      { cwd, env: { ...env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) } });
    const transcript = stamp(dir, kind, 'jsonl');
    writeFileSync(transcript, r.out || r.err);
    const e = parseOpencodeEvents(r.out);
    const isError = r.code !== 0 || (e.errors.length > 0 && !e.text);
    return { code: r.code, text: e.text, isError, error: isError ? (e.errors.join(' | ') || r.err || `exit ${r.code}`) : null,
      sessionId: e.sessionId, usage: e.usage, denials: e.denials, transcript };
  },
};

export const AGENTS = { claude, opencode };
