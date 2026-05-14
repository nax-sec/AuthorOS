import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';

function silentIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (message: string) => out.push(message),
      stderr: (message: string) => err.push(message),
    },
    out,
    err,
  };
}

test('plan, write, and review operate on --dir from outside the book directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'authoros-cli-dir-test-'));
  try {
    const bookDir = join(root, 'demo');
    const outsideDir = join(root, 'outside');
    await mkdir(outsideDir);

    const initIo = silentIo();
    assert.equal(await run(['init', 'demo', '--quick'], root, initIo.io, { env: {} }), 0, initIo.err.join(''));

    const planIo = silentIo();
    assert.equal(
      await run(['plan', '--chapter', '1', '--write', '--dir', bookDir], outsideDir, planIo.io, { env: {} }),
      0,
      planIo.err.join(''),
    );
    await stat(join(bookDir, 'plans/0001.md'));

    const writeIo = silentIo();
    assert.equal(
      await run(['write', '--chapter', '1', '--write', '--dir', bookDir], outsideDir, writeIo.io, { env: {} }),
      0,
      writeIo.err.join(''),
    );
    await stat(join(bookDir, 'chapters/0001.md'));

    await writeFile(join(bookDir, 'chapters/0001.md'), '# 章节 1\n\n正文。', 'utf8');

    const reviewIo = silentIo();
    assert.equal(
      await run(['review', '--chapter', '1', '--mode', 'internal', '--write', '--dir', bookDir], outsideDir, reviewIo.io, { env: {} }),
      0,
      reviewIo.err.join(''),
    );
    const review = await readFile(join(bookDir, 'reviews/0001.internal.md'), 'utf8');
    assert.match(review, /# 章节 1 内部评审/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
