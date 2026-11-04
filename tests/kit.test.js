import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillsDir = fileURLToPath(new URL('../skills', import.meta.url));
const skills = readdirSync(skillsDir).sort();
const read = skill => readFileSync(join(skillsDir, skill, 'SKILL.md'), 'utf8');
const frontmatterField = (text, field) => text.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))?.[1].trim();

describe('the kit', () => {
  it('ships exactly the seven flow skills', () => {
    expect(skills).toEqual(['flow-init', 'flow-orchestrate', 'flow-plan', 'flow-review', 'flow-spec', 'flow-sync', 'flow-task']);
  });

  describe.each(skills)('%s', skill => {
    it('has a name matching its folder and a real description', () => {
      expect(frontmatterField(read(skill), 'name')).toBe(skill);
      expect(frontmatterField(read(skill), 'description').length).toBeGreaterThan(60);
    });

    it('has frontmatter that strict YAML parsers accept, or skill installers skip it', () => {
      const description = frontmatterField(read(skill), 'description');

      expect(description).not.toMatch(/: /);
      expect(description).not.toMatch(/^['"&*!|>%@`#]/);
    });

    it('stays short enough to read in full', () => {
      expect(read(skill).split('\n').length).toBeLessThanOrEqual(60);
    });

    it('references only kit files that exist', () => {
      const references = [...read(skill).matchAll(/`((?:templates|\.\.\/flow-orchestrate)\/[\w./-]+)`/g)].map(m => m[1]);

      for (const ref of references) expect(existsSync(join(skillsDir, skill, ref)), ref).toBe(true);
    });
  });
});
