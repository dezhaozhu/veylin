import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, after } from 'node:test';
import {
  deleteVeylinSkill,
  loadVeylinSkills,
  writeVeylinSkill,
  importSkillDirToVeylin,
  veylinSkillsDir,
} from './discover-standard-skills.js';

describe('veylin skills dir', () => {
  const dirs: string[] = [];

  after(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it('loads only ~/.veylin/skills and ignores ~/.agents', async () => {
    const home = await mkdtemp(join(tmpdir(), 'veylin-skills-home-'));
    dirs.push(home);

    await mkdir(join(home, '.veylin', 'skills', 'hello'), { recursive: true });
    await writeFile(
      join(home, '.veylin', 'skills', 'hello', 'SKILL.md'),
      '---\nname: hello\ndescription: veylin hello\n---\n# Hello\nveylin body\n',
    );

    await mkdir(join(home, '.agents', 'skills', 'ignored'), { recursive: true });
    await writeFile(
      join(home, '.agents', 'skills', 'ignored', 'SKILL.md'),
      '---\nname: ignored\ndescription: should not load\n---\n# Ignored\n',
    );

    const skills = await loadVeylinSkills(home);
    assert.equal(skills.length, 1);
    assert.equal(skills[0]?.name, 'hello');
    assert.match(skills[0]?.content ?? '', /veylin body/);
  });

  it('writes and deletes under ~/.veylin/skills', async () => {
    const home = await mkdtemp(join(tmpdir(), 'veylin-skills-crud-'));
    dirs.push(home);

    const skill = await writeVeylinSkill({
      name: 'demo-skill',
      description: 'demo',
      content: '## When to use\nAlways.\n',
      homeDir: home,
    });
    assert.equal(skill.name, 'demo-skill');
    const raw = await readFile(join(veylinSkillsDir(home), 'demo-skill', 'SKILL.md'), 'utf8');
    assert.match(raw, /demo-skill/);

    const ok = await deleteVeylinSkill('demo-skill', home);
    assert.equal(ok, true);
    assert.equal((await loadVeylinSkills(home)).length, 0);
  });

  it('imports an external skill folder into ~/.veylin/skills', async () => {
    const home = await mkdtemp(join(tmpdir(), 'veylin-skills-import-home-'));
    const external = await mkdtemp(join(tmpdir(), 'veylin-skills-import-src-'));
    dirs.push(home, external);

    const src = join(external, 'copied-skill');
    await mkdir(src, { recursive: true });
    await writeFile(
      join(src, 'SKILL.md'),
      '---\nname: copied-skill\ndescription: from elsewhere\n---\n# Copied\n',
    );

    const skill = await importSkillDirToVeylin(src, home);
    assert.equal(skill.name, 'copied-skill');
    const loaded = await loadVeylinSkills(home);
    assert.ok(loaded.some((s) => s.name === 'copied-skill'));
  });
});
