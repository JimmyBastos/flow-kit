// Pure decision logic for the destructive-command guard. No I/O, so it is unit-testable.
// evaluate({ tool_name, tool_input }) -> { deny: boolean, reason?: string }

const WRAPPERS = new Set(['sudo', 'env', 'command', 'nohup', 'time', 'rtk', 'exec', 'nice']);
const SECRET_ALLOW = /\.(example|sample|template|dist)$/i;
const SECRET_PATTERNS = [/^\.env(\..+)?$/i, /creds/i, /\.pem$/i, /^id_(rsa|ed25519|ecdsa)$/i];
const PROTECTED_RM_TARGETS = [/^\.flow(\/|$)/, /^docs(\/|$)/, /(^|\/)\.flow(\/|$)/, /(^|\/)docs(\/|$)/];
const BROAD_RM_TARGETS = new Set(['.', '..', '/', '~', '*', './*', '/*', '~/*', '.git']);
const READERS = new Set(['cat', 'less', 'more', 'head', 'tail', 'grep', 'rg', 'cp', 'mv', 'source', '.', 'bat', 'sed', 'awk', 'strings', 'xxd', 'od', 'base64']);

export function tokenize(segment) {
  const out = []; let cur = ''; let q = null; let has = false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (q) {
      if (c === q) q = null;
      else if (c === '\\' && q === '"' && i + 1 < segment.length) cur += segment[++i];
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") { q = c; has = true; continue; }
    if (c === '\\' && i + 1 < segment.length) { cur += segment[++i]; has = true; continue; }
    if (/\s/.test(c)) { if (has || cur) out.push(cur); cur = ''; has = false; continue; }
    cur += c; has = true;
  }
  if (has || cur) out.push(cur);
  return out;
}

// Split a command line into simple-command segments (on ; && || | & newline, and $( ) / backticks).
export function segments(command) {
  const segs = []; let cur = ''; let q = null;
  const flush = () => { if (cur.trim()) segs.push(cur); cur = ''; };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '\\' && i + 1 < command.length) { cur += c + command[++i]; continue; }
    if (c === ';' || c === '\n' || c === '|' || c === '&' || c === '`' || c === '(' || c === ')') { flush(); continue; }
    if (c === '$' && command[i + 1] === '(') { flush(); i++; continue; }
    cur += c;
  }
  flush();
  return segs;
}

function isSecretPath(p) {
  if (!p || p.startsWith('-')) return false;
  const base = p.split('/').pop();
  if (SECRET_ALLOW.test(base)) return false;
  return SECRET_PATTERNS.some((re) => re.test(base));
}

function checkGit(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    // global options that take a value
    i += ['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(args[i]) ? 2 : 1;
  }
  const sub = args[i]; const rest = args.slice(i + 1);
  if (!sub) return null;
  if (sub === 'push') {
    const forced = rest.some((t) => t === '--force' || t.startsWith('--force-with-lease') || t === '--force-if-includes' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(t) || (t.startsWith('+') && t.length > 1));
    if (forced) return 'force push is blocked';
    if (rest.includes('--delete') || rest.includes('-d')) return 'deleting remote refs is blocked';
  }
  if (sub === 'reset' && rest.includes('--hard')) return 'git reset --hard is blocked';
  if (sub === 'clean') {
    const dry = rest.some((t) => t === '-n' || t === '--dry-run' || /^-[a-zA-Z]*n[a-zA-Z]*$/.test(t));
    if (!dry) return 'git clean is blocked (use --dry-run to preview)';
  }
  if (sub === 'branch' && rest.some((t) => t === '-D' || (t === '--delete' && rest.includes('--force')))) return 'git branch -D is blocked';
  if ((sub === 'checkout' || sub === 'restore') && rest.some((t) => t === '.' || t === ':/' )) return `git ${sub} . discards all local changes and is blocked`;
  return null;
}

// Merging is the CI merge job's decision. A local session must never merge, even a pull request it thinks is safe.
function checkGh(args) {
  const words = args.filter((t) => !t.startsWith('-'));
  if (words.some((t, i) => t === 'pr' && words[i + 1] === 'merge')) return 'gh pr merge is blocked; the CI merge job decides merges';
  if (words[0] === 'api' && args.some((t) => /\/merges?(\/|$|\?)/.test(t))) return 'merging through gh api is blocked; the CI merge job decides merges';
  return null;
}

function checkRm(args) {
  const recursive = args.some((t) => t === '--recursive' || /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(t));
  if (!recursive) return null;
  for (const t of args) {
    if (t.startsWith('-')) continue;
    const norm = t.replace(/\/+$/, '') || '/';
    if (BROAD_RM_TARGETS.has(norm)) return `recursive delete of "${t}" is blocked`;
    if (PROTECTED_RM_TARGETS.some((re) => re.test(norm.replace(/^\.\//, '')))) return `recursive delete of "${t}" (.flow/ and docs/ are protected) is blocked`;
  }
  return null;
}

function checkSegment(segment, depth = 0) {
  let t = tokenize(segment);
  while (t.length && (WRAPPERS.has(t[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0]))) t = t.slice(1);
  if (!t.length) return null;
  const cmd = t[0].split('/').pop();
  const args = t.slice(1);
  if ((cmd === 'sh' || cmd === 'bash' || cmd === 'zsh') && depth < 3) {
    const ci = args.indexOf('-c');
    if (ci >= 0 && args[ci + 1]) return checkCommand(args[ci + 1], depth + 1);
  }
  if (cmd === 'xargs' && depth < 3) return checkSegment(args.join(' '), depth + 1);
  if (cmd === 'git') return checkGit(args);
  if (cmd === 'gh') return checkGh(args);
  if (cmd === 'rm') return checkRm(args);
  if (READERS.has(cmd) && args.some(isSecretPath)) return 'reading secret files (.env*, *creds*, *.pem) is blocked';
  if (/^[<>]/.test(segment.trim()) === false && args.some((a) => a.startsWith('<') && isSecretPath(a.slice(1)))) return 'reading secret files is blocked';
  return null;
}

export function checkCommand(command, depth = 0) {
  for (const seg of segments(command)) {
    const reason = checkSegment(seg, depth);
    if (reason) return reason;
  }
  return null;
}

export function evaluate(input) {
  const name = input?.tool_name ?? '';
  const ti = input?.tool_input ?? {};
  let reason = null;
  if (name === 'Bash' || name === 'bash') reason = checkCommand(String(ti.command ?? ''));
  else if (['Read', 'read', 'Edit', 'Write', 'edit', 'write'].includes(name)) {
    const p = ti.file_path ?? ti.filePath ?? ti.path;
    if (typeof p === 'string' && isSecretPath(p)) reason = `access to secret file "${p}" is blocked`;
  }
  return reason ? { deny: true, reason } : { deny: false };
}
