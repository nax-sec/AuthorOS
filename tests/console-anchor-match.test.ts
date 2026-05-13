import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEditOps, parseEditsBlock } from '../src/core/editOps.ts';

async function withTempDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'authoros-anchor-match-'));
  try {
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('heading ops reject missing anchors', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'outline.md'), '# 主线大纲\n\n## 主线阶段\n\n旧\n', 'utf8');
    await assert.rejects(
      () => applyEditOps({
        baseDir: dir,
        scope: 'book',
        edits: parseEditsBlock('- file: outline.md\n  op: append-after-heading\n  anchor: "## 不存在"\n  content: |\n    x\n'),
      }),
      /anchor not found/,
    );
  });
});

test('heading ops reject duplicate anchors', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'outline.md'), '# 主线大纲\n\n## 主线阶段\n\nA\n\n## 主线阶段\n\nB\n', 'utf8');
    await assert.rejects(
      () => applyEditOps({
        baseDir: dir,
        scope: 'book',
        edits: parseEditsBlock('- file: outline.md\n  op: replace-section\n  anchor: "## 主线阶段"\n  content: |\n    x\n'),
      }),
      /anchor matched multiple times/,
    );
  });
});

test('replace-text rejects ambiguous normalized matches', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'outline.md'), '# 主线大纲\n\n新港   重工\n\n新港 重工\n', 'utf8');
    await assert.rejects(
      () => applyEditOps({
        baseDir: dir,
        scope: 'book',
        edits: parseEditsBlock('- file: outline.md\n  op: replace-text\n  find: "新港 重工"\n  replace: "鼎新重工"\n'),
      }),
      /text block matched multiple times/,
    );
  });
});

test('replace-text rejects missing normalized text', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'outline.md'), '# 主线大纲\n\n真实内容\n', 'utf8');
    await assert.rejects(
      () => applyEditOps({
        baseDir: dir,
        scope: 'book',
        edits: parseEditsBlock('- file: outline.md\n  op: replace-text\n  find: "不存在"\n  replace: "新内容"\n'),
      }),
      /text block not found/,
    );
  });
});
