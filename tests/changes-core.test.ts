import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listChanges, recordChange, rollback } from '../src/core/changes.ts';

async function withTempDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'authoros-changes-'));
  try {
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('recordChange writes before/after snapshots and listChanges returns newest metadata', async () => {
  await withTempDir(async (baseDir) => {
    await writeFile(join(baseDir, 'outline.md'), 'old outline\n', 'utf8');

    const record = await recordChange({
      baseDir,
      scope: 'book',
      agent: 'author-console',
      userPrompt: 'rename outline',
      agentOutput: '[scope] book\n',
      fileChanges: [
        { file: 'outline.md', before: 'old outline\n', after: 'new outline\n' },
        { file: 'notes/new.md', before: null, after: 'created\n' },
      ],
      now: new Date('2026-05-12T14:00:00Z'),
    });

    assert.match(record.id, /^CHG-[A-Z0-9]{4,}$/);
    assert.equal(record.scope, 'book');
    assert.deepEqual(record.files, ['outline.md', 'notes/new.md']);
    assert.equal(record.userPrompt, 'rename outline');

    const dirs = await readdir(join(baseDir, 'changes'));
    assert.equal(dirs.length, 1);
    const changeDir = join(baseDir, 'changes', dirs[0]!);
    assert.equal(await readFile(join(changeDir, 'user_prompt.txt'), 'utf8'), 'rename outline\n');
    assert.equal(await readFile(join(changeDir, 'agent_output.md'), 'utf8'), '[scope] book\n');
    assert.match(await readFile(join(changeDir, 'meta.json'), 'utf8'), /"change_id": "CHG-/);
    assert.equal(await readFile(join(changeDir, 'before/outline.md'), 'utf8'), 'old outline\n');
    assert.equal(await readFile(join(changeDir, 'after/outline.md'), 'utf8'), 'new outline\n');
    assert.equal(await readFile(join(changeDir, 'after/notes/new.md'), 'utf8'), 'created\n');

    const listed = await listChanges(baseDir);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.id, record.id);
    assert.deepEqual(listed[0]!.files, ['outline.md', 'notes/new.md']);
  });
});

test('recordChange avoids directory collisions for concurrent same-second writes', async () => {
  await withTempDir(async (baseDir) => {
    const now = new Date('2026-05-12T14:00:00Z');
    const [first, second] = await Promise.all([
      recordChange({
        baseDir,
        scope: 'book',
        agent: 'test',
        userPrompt: 'first',
        agentOutput: 'first',
        fileChanges: [{ file: 'a.md', before: null, after: 'a\n' }],
        now,
      }),
      recordChange({
        baseDir,
        scope: 'book',
        agent: 'test',
        userPrompt: 'second',
        agentOutput: 'second',
        fileChanges: [{ file: 'b.md', before: null, after: 'b\n' }],
        now,
      }),
    ]);

    assert.notEqual(first.id, second.id);
    const dirs = await readdir(join(baseDir, 'changes'));
    assert.equal(dirs.length, 2);
  });
});

test('rollback restores before snapshots and writes a rollback record', async () => {
  await withTempDir(async (baseDir) => {
    await writeFile(join(baseDir, 'outline.md'), 'old outline\n', 'utf8');
    const record = await recordChange({
      baseDir,
      scope: 'book',
      agent: 'author-console',
      userPrompt: 'rename outline',
      agentOutput: '[scope] book\n',
      fileChanges: [{ file: 'outline.md', before: 'old outline\n', after: 'new outline\n' }],
      now: new Date('2026-05-12T14:00:00Z'),
    });
    await writeFile(join(baseDir, 'outline.md'), 'new outline\n', 'utf8');

    const rollbackRecord = await rollback(baseDir, record.id, {
      now: new Date('2026-05-12T14:00:05Z'),
    });

    assert.equal(await readFile(join(baseDir, 'outline.md'), 'utf8'), 'old outline\n');
    assert.equal(rollbackRecord.rollbackOf, record.id);
    assert.deepEqual(rollbackRecord.files, ['outline.md']);

    const listed = await listChanges(baseDir);
    assert.equal(listed.length, 2);
    assert.equal(listed[0]!.rollbackOf, record.id);
    assert.equal(listed[1]!.id, record.id);
  });
});

test('rollback deletes files that did not exist before the original change', async () => {
  await withTempDir(async (baseDir) => {
    const record = await recordChange({
      baseDir,
      scope: 'book',
      agent: 'author-console',
      userPrompt: 'create note',
      agentOutput: '[scope] book\n',
      fileChanges: [{ file: 'notes/new.md', before: null, after: 'created\n' }],
      now: new Date('2026-05-12T14:00:00Z'),
    });
    await mkdir(join(baseDir, 'notes'), { recursive: true });
    await writeFile(join(baseDir, 'notes/new.md'), 'created\n', 'utf8');

    await rollback(baseDir, record.id, { now: new Date('2026-05-12T14:00:05Z') });

    await assert.rejects(() => readFile(join(baseDir, 'notes/new.md'), 'utf8'));
  });
});
