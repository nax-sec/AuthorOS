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

test('rename-text replaces every literal occurrence in a file', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'outline.md'), '新港重工\n新港重工 A\nB 新港重工 C\n新港重工，新港重工\n', 'utf8');
    await applyEditOps({
      baseDir: dir,
      scope: 'book',
      edits: parseEditsBlock('- file: outline.md\n  op: rename-text\n  from: 新港重工\n  to: 鼎新重工\n'),
    });

    const text = await readFile(join(dir, 'outline.md'), 'utf8');
    assert.equal((text.match(/新港重工/g) ?? []).length, 0);
    assert.equal((text.match(/鼎新重工/g) ?? []).length, 5);
  });
});

test('rename-text rejects missing source text', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'outline.md'), '真实内容\n', 'utf8');
    await assert.rejects(
      () => applyEditOps({
        baseDir: dir,
        scope: 'book',
        edits: parseEditsBlock('- file: outline.md\n  op: rename-text\n  from: 新港重工\n  to: 鼎新重工\n'),
      }),
      /rename-text: "新港重工" not found/,
    );
  });
});

test('rename-text rejects empty from value', async () => {
  assert.throws(
    () => parseEditsBlock('- file: outline.md\n  op: rename-text\n  from: ""\n  to: 鼎新重工\n'),
    /from/,
  );
});

test('rename-text applies independently across multiple files', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'outline.md'), '新港重工\n', 'utf8');
    await writeFile(join(dir, 'world.md'), '新港重工\n', 'utf8');
    await applyEditOps({
      baseDir: dir,
      scope: 'book',
      edits: parseEditsBlock([
        '- file: outline.md',
        '  op: rename-text',
        '  from: 新港重工',
        '  to: 鼎新重工',
        '- file: world.md',
        '  op: rename-text',
        '  from: 新港重工',
        '  to: 港岛重工',
      ].join('\n')),
    });

    assert.equal(await readFile(join(dir, 'outline.md'), 'utf8'), '鼎新重工\n');
    assert.equal(await readFile(join(dir, 'world.md'), 'utf8'), '港岛重工\n');
  });
});
