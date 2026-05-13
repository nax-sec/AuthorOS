import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEditOps, parseEditsBlock } from '../src/core/editOps.ts';

async function withTempDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'authoros-rename-text-'));
  try {
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('rename-text is a noop when from is already absent', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'outline.md'), '# 主线大纲\n\n鼎新重工已登场。\n', 'utf8');

    const result = await applyEditOps({
      baseDir: dir,
      scope: 'book',
      edits: parseEditsBlock('- file: outline.md\n  op: rename-text\n  from: "新港重工"\n  to: "鼎新重工"\n'),
    });

    assert.deepEqual(result.fileChanges, []);
    assert.deepEqual(result.noops, ['noop: rename-text on outline.md: "新港重工" already absent (likely already renamed)']);
    assert.equal(await readFile(join(dir, 'outline.md'), 'utf8'), '# 主线大纲\n\n鼎新重工已登场。\n');
  });
});

test('duplicate rename-text ops succeed with the second op recorded as noop', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'outline.md'), '# 主线大纲\n\n新港重工掌握线索。新港重工再次出现。\n', 'utf8');

    const result = await applyEditOps({
      baseDir: dir,
      scope: 'book',
      edits: parseEditsBlock([
        '- file: outline.md',
        '  op: rename-text',
        '  from: "新港重工"',
        '  to: "鼎新重工"',
        '- file: outline.md',
        '  op: rename-text',
        '  from: "新港重工"',
        '  to: "鼎新重工"',
      ].join('\n')),
    });

    assert.deepEqual(result.fileChanges.map((change) => change.file), ['outline.md']);
    assert.deepEqual(result.noops, ['noop: rename-text on outline.md: "新港重工" already absent (likely already renamed)']);
    const text = await readFile(join(dir, 'outline.md'), 'utf8');
    assert.equal((text.match(/鼎新重工/g) ?? []).length, 2);
    assert.doesNotMatch(text, /新港重工/);
  });
});

test('rename-text noop can share a transaction with a normal replace-text edit', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'world.md'), '# 世界设定\n\n鼎新重工已存在。\n雨夜线索很弱。\n', 'utf8');

    const result = await applyEditOps({
      baseDir: dir,
      scope: 'book',
      edits: parseEditsBlock([
        '- file: world.md',
        '  op: rename-text',
        '  from: "新港重工"',
        '  to: "鼎新重工"',
        '- file: world.md',
        '  op: replace-text',
        '  find: "雨夜线索很弱。"',
        '  replace: "雨夜线索更强。"',
      ].join('\n')),
    });

    assert.deepEqual(result.fileChanges.map((change) => change.file), ['world.md']);
    assert.deepEqual(result.noops, ['noop: rename-text on world.md: "新港重工" already absent (likely already renamed)']);
    assert.match(await readFile(join(dir, 'world.md'), 'utf8'), /雨夜线索更强。/);
  });
});
