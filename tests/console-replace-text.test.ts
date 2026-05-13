import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEditOps, parseEditsBlock } from '../src/core/editOps.ts';

async function withTempDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'authoros-replace-text-'));
  try {
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('replace-text replaces a unique single-line substring', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'outline.md'), '# 主线大纲\n\n    - 委托升级：新港重工内部一名主管失踪。\n', 'utf8');
    await applyEditOps({
      baseDir: dir,
      scope: 'book',
      edits: parseEditsBlock([
        '- file: outline.md',
        '  op: replace-text',
        '  find: 新港重工内部一名主管失踪。',
        '  replace: 鼎新重工内部一名主管失踪。',
      ].join('\n')),
    });

    const text = await readFile(join(dir, 'outline.md'), 'utf8');
    assert.match(text, /委托升级：鼎新重工内部一名主管失踪。/);
  });
});

test('replace-text replaces a unique multi-line substring', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'outline.md'), '# 主线大纲\n\nA: 调查进入新港重工\nB: 线索指向码头\nC: 保持不变\n', 'utf8');
    await applyEditOps({
      baseDir: dir,
      scope: 'book',
      edits: parseEditsBlock([
        '- file: outline.md',
        '  op: replace-text',
        '  find: |',
        '    调查进入新港重工',
        '    B: 线索指向码头',
        '  replace: |',
        '    调查进入鼎新重工',
        '    B: 线索指向旧仓库',
      ].join('\n')),
    });

    const text = await readFile(join(dir, 'outline.md'), 'utf8');
    assert.match(text, /A: 调查进入鼎新重工\nB: 线索指向旧仓库/);
    assert.match(text, /C: 保持不变/);
  });
});

test('replace-text rejects non-unique substring matches and points to rename-text', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'outline.md'), '# 主线大纲\n\n新港重工出现一次\n新港重工出现两次\n', 'utf8');
    await assert.rejects(
      () => applyEditOps({
        baseDir: dir,
        scope: 'book',
        edits: parseEditsBlock('- file: outline.md\n  op: replace-text\n  find: 新港重工\n  replace: 鼎新重工\n'),
      }),
      /use rename-text/,
    );
  });
});

test('replace-text rejects missing substring', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'outline.md'), '# 主线大纲\n\n真实内容\n', 'utf8');
    await assert.rejects(
      () => applyEditOps({
        baseDir: dir,
        scope: 'book',
        edits: parseEditsBlock('- file: outline.md\n  op: replace-text\n  find: 不存在\n  replace: 新内容\n'),
      }),
      /replace-text: find block not found/,
    );
  });
});
