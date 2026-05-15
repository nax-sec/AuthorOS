import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildChaptersZip, readChapterDownload } from '../src/web/downloads.ts';

async function withBook(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'authoros-web-downloads-'));
  try {
    await mkdir(join(dir, 'chapters'), { recursive: true });
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('readChapterDownload returns markdown content and safe filename', async () => {
  await withBook(async (dir) => {
    await writeFile(join(dir, 'chapters/0001.md'), '# 第一章\n正文\n', 'utf8');

    const result = await readChapterDownload(dir, 1);

    assert.equal(result.filename, 'chapter-0001.md');
    assert.equal(result.contentType, 'text/markdown; charset=utf-8');
    assert.equal(result.body.toString('utf8'), '# 第一章\n正文\n');
  });
});

test('buildChaptersZip includes drafted chapter markdown files only', async () => {
  await withBook(async (dir) => {
    await writeFile(join(dir, 'chapters/0001.md'), '# 1\n', 'utf8');
    await writeFile(join(dir, 'chapters/0001.draft.md'), '# draft\n', 'utf8');
    await writeFile(join(dir, 'chapters/0002.md'), '# 2\n', 'utf8');

    const result = await buildChaptersZip(dir);

    assert.equal(result.filename, 'chapters.zip');
    assert.equal(result.contentType, 'application/zip');
    const zip = result.body.toString('latin1');
    assert.match(zip, /chapters\/0001\.md/);
    assert.match(zip, /chapters\/0002\.md/);
    assert.doesNotMatch(zip, /0001\.draft\.md/);
  });
});

