import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';

async function withTempDir(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-v03-author-test-'));
  try {
    await body(root);
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

test('author author init creates a valid author directory', async () => {
  await withTempDir(async (root) => {
    const authorDir = join(root, 'author-home');
    const io = silentIo();

    const exit = await run(['author', 'init', '--dir', authorDir], root, io.io, { env: {} });

    assert.equal(exit, 0, io.err.join(''));
    for (const file of [
      'author.md',
      'style.md',
      'preferences/weights.yaml',
      'preferences/readers.yaml',
      'agents/planner.md',
      'agents/book-setup-editor.md',
      'templates/urban_power_anomaly/product.md',
    ]) {
      const info = await stat(join(authorDir, file));
      assert.ok(info.isFile(), `expected author file: ${file}`);
    }

    const readers = await readFile(join(authorDir, 'preferences/readers.yaml'), 'utf8');
    assert.match(readers, /节奏型/);
    assert.match(readers, /角色型/);
    assert.doesNotMatch(readers, /爽点读者/);

    const doctor = silentIo();
    const doctorExit = await run(['author', 'doctor', '--dir', authorDir], root, doctor.io, { env: {} });
    assert.equal(doctorExit, 0, doctor.err.join(''));
    assert.match(doctor.out.join(''), /violations: 0/);
  });
});

test('author author init refuses an existing non-empty directory', async () => {
  await withTempDir(async (root) => {
    const authorDir = join(root, 'author-home');
    assert.equal(await run(['author', 'init', '--dir', authorDir], root, silentIo().io, { env: {} }), 0);

    const io = silentIo();
    const exit = await run(['author', 'init', '--dir', authorDir], root, io.io, { env: {} });

    assert.equal(exit, 1);
    assert.match(io.err.join(''), /author dir already initialized/);
  });
});

test('author author doctor reports missing author.md', async () => {
  await withTempDir(async (root) => {
    const authorDir = join(root, 'author-home');
    assert.equal(await run(['author', 'init', '--dir', authorDir], root, silentIo().io, { env: {} }), 0);
    await unlink(join(authorDir, 'author.md'));

    const io = silentIo();
    const exit = await run(['author', 'doctor', '--dir', authorDir], root, io.io, { env: {} });

    assert.equal(exit, 0);
    const output = io.out.join('');
    assert.match(output, /violations: 1/);
    assert.match(output, /missing-required-file/);
    assert.match(output, /author\.md/);
  });
});
