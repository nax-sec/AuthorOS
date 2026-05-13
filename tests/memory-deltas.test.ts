import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';

async function withBook(body: (bookDir: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-memory-deltas-'));
  try {
    const init = silentIo();
    assert.equal(await run(['init', 'demo', '--quick'], root, init.io, { env: {} }), 0, init.err.join(''));
    await body(join(root, 'demo'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

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

test('memory deltas lists console deltas and unmerged chapter deltas', async () => {
  await withBook(async (bookDir) => {
    await mkdir(join(bookDir, 'memory'), { recursive: true });
    await writeFile(join(bookDir, 'memory/console-2026-05-13T151819.delta.md'), '# Console Delta\n\ncanon proposal\n', 'utf8');
    await writeFile(join(bookDir, 'memory/chapter-0001.delta.md'), '# Chapter 1 Delta\n', 'utf8');
    await writeFile(join(bookDir, 'memory/chapter-0002.delta.md'), '# Chapter 2 Delta\n', 'utf8');
    await writeFile(join(bookDir, 'memory/canon.md'), '# 正史设定\n\n## 变更记录\n\n- merged: chapter-0001.delta.md\n', 'utf8');

    const io = silentIo();
    const exit = await run(['memory', 'deltas'], bookDir, io.io, { env: {} });

    assert.equal(exit, 0, io.err.join(''));
    const output = io.out.join('');
    assert.match(output, /Pending memory deltas:/);
    assert.match(output, /console-2026-05-13T151819\.delta\.md\s+\(created from console session, scope: book\)/);
    assert.doesNotMatch(output, /chapter-0001\.delta\.md/);
    assert.match(output, /chapter-0002\.delta\.md\s+\(chapter 2 memory delta, not yet merged\)/);
    assert.match(output, /Merge instructions:/);
    assert.match(output, /author memory deltas show <name>/);
  });
});

test('memory deltas show prints the requested delta file', async () => {
  await withBook(async (bookDir) => {
    await mkdir(join(bookDir, 'memory'), { recursive: true });
    await writeFile(join(bookDir, 'memory/console-2026-05-13T151819.delta.md'), '# Console Delta\n\ncanon proposal\n', 'utf8');

    const io = silentIo();
    const exit = await run(['memory', 'deltas', 'show', 'console-2026-05-13T151819.delta.md'], bookDir, io.io, { env: {} });

    assert.equal(exit, 0, io.err.join(''));
    assert.match(io.out.join(''), /# Console Delta[\s\S]*canon proposal/);
  });
});

test('memory deltas show reports missing delta names clearly', async () => {
  await withBook(async (bookDir) => {
    const io = silentIo();
    const exit = await run(['memory', 'deltas', 'show', 'console-missing.delta.md'], bookDir, io.io, { env: {} });

    assert.equal(exit, 1);
    assert.match(io.err.join(''), /memory delta not found: console-missing\.delta\.md/);
  });
});
