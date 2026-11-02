// Keeps the kit self-consistent: skills reference only scripts, templates and adapters that exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../scripts/lib/miniyaml.js';
import { normalize, validate, warnings } from '../scripts/lib/config.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const skills = readdirSync(join(root, 'skills'));
const EXPECTED = ['flow-init', 'flow-research', 'flow-spec', 'flow-plan', 'flow-tasks', 'flow-analyze', 'flow-implement', 'flow-resume', 'flow-run', 'flow-review', 'flow-audit', 'flow-drift', 'flow-sync'];

test('all 13 skills exist, each with matching name and a real description', () => {
  assert.deepEqual([...skills].sort(), [...EXPECTED].sort());
  for (const s of skills) {
    const text = readFileSync(join(root, 'skills', s, 'SKILL.md'), 'utf8');
    const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(fm, `${s}: frontmatter`);
    assert.equal(fm[1].match(/^name:\s*(.+)$/m)?.[1].trim(), s, `${s}: name matches folder`);
    assert.ok((fm[1].match(/^description:\s*(.+)$/m)?.[1] ?? '').length > 60, `${s}: description is substantive`);
    assert.ok(!/^model:/m.test(fm[1]), `${s}: no hard-coded model (models come from flow.config.yaml)`);
    assert.ok(text.split('\n').length < 120, `${s}: stays short enough to be read in full`);
  }
});

test('every script, template and adapter named in a skill exists', () => {
  const missing = [];
  for (const s of skills) {
    const text = readFileSync(join(root, 'skills', s, 'SKILL.md'), 'utf8');
    for (const m of text.matchAll(/scripts\/flow\/([\w-]+\.js)/g)) if (!existsSync(join(root, 'scripts', m[1]))) missing.push(`${s}: scripts/${m[1]}`);
    for (const m of text.matchAll(/<kit>\/scripts\/([\w-]+\.js)/g)) if (!existsSync(join(root, 'scripts', m[1]))) missing.push(`${s}: scripts/${m[1]}`);
    for (const m of text.matchAll(/`templates\/([\w./-]+)`/g)) if (!existsSync(join(root, 'templates', m[1]))) missing.push(`${s}: templates/${m[1]}`);
    for (const m of text.matchAll(/`schemas\/([\w./-]+)`/g)) if (!existsSync(join(root, 'schemas', m[1]))) missing.push(`${s}: schemas/${m[1]}`);
    for (const m of text.matchAll(/adapters\/<tracker>/g)) for (const a of ['linear', 'github-issues', 'none']) if (!existsSync(join(root, 'adapters', `${a}.md`))) missing.push(`adapter ${a}`);
    for (const m of text.matchAll(/adapters\/<workspace>/g)) for (const a of ['git-worktree', 'orca']) if (!existsSync(join(root, 'adapters', `${a}.md`))) missing.push(`adapter ${a}`);
  }
  assert.deepEqual(missing, []);
});

test('flow-state subcommands used by skills are real', () => {
  const src = readFileSync(join(root, 'scripts/flow-state.js'), 'utf8');
  for (const s of skills) for (const m of readFileSync(join(root, 'skills', s, 'SKILL.md'), 'utf8').matchAll(/flow-state\.js (\w+)/g)) {
    assert.ok(src.includes(`cmd === '${m[1]}'`), `${s}: flow-state.js ${m[1]}`);
  }
  const gates = readFileSync(join(root, 'scripts/gates.js'), 'utf8');
  for (const s of skills) for (const m of readFileSync(join(root, 'skills', s, 'SKILL.md'), 'utf8').matchAll(/gates\.js (run|size|diff|testfirst)/g)) assert.ok(gates.includes(`cmd === '${m[1]}'`));
});

test('config template parses; unfilled it fails validation exactly where init must ask', () => {
  const cfg = normalize(parse(readFileSync(join(root, 'templates/flow.config.yaml'), 'utf8')));
  const errs = validate(cfg).join('\n');
  assert.match(errs, /placeholder gate commands/);
  assert.equal(cfg.capabilities.planning.candidates[0].harness, 'auto');
  assert.equal(cfg.capabilities.implementation.retry_candidates[0].model, 'default');
  assert.equal(cfg.capabilities.repository_exploration.candidates[0].model, 'default');
  assert.doesNotMatch(errs, /topology|tracker|limits/);
  assert.doesNotMatch(warnings(cfg).join('\n'), /no longer used/, 'the template uses no removed keys');
});

test('verdict schema is valid JSON and agrees with the validator on required fields', () => {
  const schema = JSON.parse(readFileSync(join(root, 'schemas/verdict.schema.json'), 'utf8'));
  assert.deepEqual(schema.required, ['verdict', 'reviewed_commit', 'violations']);
});
