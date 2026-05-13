import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEditOps, parseEditsBlock } from '../src/core/editOps.ts';

async function withTempDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'authoros-scope-whitelist-'));
  try {
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('book scope rejects forbidden canonical memory writes before applying anything', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'review_rules.md'), '# 章节评审规则\n\n## 必查项\n\n- 原项\n', 'utf8');
    await writeFile(join(dir, 'memory-canon.md'), 'sentinel\n', 'utf8');

    await assert.rejects(
      () => applyEditOps({
        baseDir: dir,
        scope: 'book',
        edits: parseEditsBlock([
          '- file: review_rules.md',
          '  op: append-after-heading',
          '  anchor: "## 必查项"',
          '  content: "- 新项"',
          '- file: memory/canon.md',
          '  op: create-file',
          '  content: bad',
        ].join('\n')),
      }),
      /not allowed in book scope: memory\/canon\.md/,
    );

    assert.doesNotMatch(await readFile(join(dir, 'review_rules.md'), 'utf8'), /新项/);
  });
});

test('book scope allows console delta create-file but not chapter edits', async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(
      () => applyEditOps({
        baseDir: dir,
        scope: 'book',
        edits: parseEditsBlock('- file: chapters/0001.md\n  op: create-file\n  content: bad\n'),
      }),
      /not allowed in book scope: chapters\/0001\.md/,
    );

    const result = await applyEditOps({
      baseDir: dir,
      scope: 'book',
      now: new Date('2026-05-13T06:00:00Z'),
      edits: parseEditsBlock('- file: memory/console-*.delta.md\n  op: create-file\n  content: ok\n'),
    });
    assert.deepEqual(result.fileChanges.map((change) => change.file), ['memory/console-2026-05-13T060000.delta.md']);
  });
});

test('author scope allows author profile files and rejects changes internals', async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(
      () => applyEditOps({
        baseDir: dir,
        scope: 'author',
        edits: parseEditsBlock('- file: changes/manual.delta.md\n  op: create-file\n  content: bad\n'),
      }),
      /not allowed in author scope: changes\/manual\.delta\.md/,
    );

    await applyEditOps({
      baseDir: dir,
      scope: 'author',
      edits: parseEditsBlock('- file: author.md\n  op: create-file\n  content: "# 作者层"\n'),
    });
    assert.match(await readFile(join(dir, 'author.md'), 'utf8'), /作者层/);
  });
});
