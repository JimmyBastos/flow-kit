// Minimal YAML-subset parser. Zero dependencies so installed scripts need no npm install.
// Supported: nested block maps (2-space indent), block lists ("- item", "- key: v" maps),
// inline lists [a, b], inline maps { a: 1, b: x }, quoted/unquoted scalars, null/true/false/numbers,
// and "#" comments. Not supported: anchors, multi-line scalars, tags. Config files must stay in this subset.

function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function splitTop(s, sep = ',') {
  const out = []; let depth = 0, q = null, cur = '';
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') out.push(cur);
  return out;
}

function scalar(raw) {
  const s = raw.trim();
  if (s === '' || s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if (s.startsWith('[') && s.endsWith(']')) return splitTop(s.slice(1, -1)).map(scalar);
  if (s.startsWith('{') && s.endsWith('}')) {
    const o = {};
    for (const part of splitTop(s.slice(1, -1))) {
      const i = part.indexOf(':');
      if (i < 0) throw new Error(`bad inline map entry: ${part}`);
      o[part.slice(0, i).trim()] = scalar(part.slice(i + 1));
    }
    return o;
  }
  return s;
}

function keyValue(text) {
  // returns [key, rest] or null; key may be quoted
  const m = text.match(/^("[^"]*"|'[^']*'|[^\s:][^:]*?)\s*:(?:\s+(.*))?$/);
  if (!m) return null;
  return [m[1].replace(/^["']|["']$/g, ''), m[2] ?? ''];
}

export function parse(text) {
  const lines = [];
  text.split(/\r?\n/).forEach((l, n) => {
    const body = stripComment(l).replace(/\s+$/, '');
    if (body.trim() === '') return;
    const indent = body.match(/^ */)[0].length;
    if (/^\t/.test(body)) throw new Error(`line ${n + 1}: tabs are not allowed`);
    lines.push({ indent, text: body.trim(), n: n + 1 });
  });
  let pos = 0;

  function block(indent) {
    const first = lines[pos];
    if (!first || first.indent < indent) return null;
    return first.text.startsWith('- ') || first.text === '-' ? list(first.indent) : map(first.indent);
  }

  function map(indent) {
    const obj = {};
    while (pos < lines.length && lines[pos].indent === indent && !lines[pos].text.startsWith('- ')) {
      const { text, n } = lines[pos];
      const kv = keyValue(text);
      if (!kv) throw new Error(`line ${n}: expected "key: value", got "${text}"`);
      const [key, rest] = kv;
      pos++;
      if (rest !== '') obj[key] = scalar(rest);
      else if (pos < lines.length && lines[pos].indent > indent) obj[key] = block(lines[pos].indent);
      else if (pos < lines.length && lines[pos].indent === indent && lines[pos].text.startsWith('- ')) obj[key] = list(indent);
      else obj[key] = null;
    }
    if (pos < lines.length && lines[pos].indent > indent) {
      throw new Error(`line ${lines[pos].n}: unexpected indentation`);
    }
    return obj;
  }

  function list(indent) {
    const arr = [];
    while (pos < lines.length && lines[pos].indent === indent && lines[pos].text.startsWith('-')) {
      const { text, n } = lines[pos];
      const after = text === '-' ? '' : text.slice(2).trim();
      if (after === '') {
        pos++;
        arr.push(pos < lines.length && lines[pos].indent > indent ? block(lines[pos].indent) : null);
        continue;
      }
      const kv = keyValue(after);
      if (kv && !after.startsWith('[') && !after.startsWith('{')) {
        // "- key: value" starts a map whose further keys are indented by 2 more than the dash
        const childIndent = indent + 2;
        lines[pos] = { indent: childIndent, text: after, n };
        arr.push(map(childIndent));
      } else {
        pos++;
        arr.push(scalar(after));
      }
    }
    return arr;
  }

  if (lines.length === 0) return {};
  const result = block(lines[0].indent);
  if (pos < lines.length) throw new Error(`line ${lines[pos].n}: could not parse "${lines[pos].text}"`);
  return result;
}
