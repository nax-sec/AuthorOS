import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';

async function withInitedProject(body: (cwd: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-v2-state-test-'));
  try {
    const io = silentIo();
    const exit = await run(['init', 'demo', '--quick'], root, io.io, { env: {} });
    assert.equal(exit, 0, io.err.join(''));
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

test('state on a fresh project reports no artifacts and next pointers at 1', async () => {
  await withInitedProject(async (cwd) => {
    const io = silentIo();
    const exit = await run(['state'], cwd, io.io, { env: {} });
    assert.equal(exit, 0, io.err.join(''));

    const output = io.out.join('');
    assert.match(output, /no chapter artifacts yet/);
    assert.match(output, /next plan:\s+1/);
    assert.match(output, /next draft:\s+1/);
    assert.match(output, /next decision:\s+1/);
  });
});

test('state lists per-chapter flags and advances next pointers', async () => {
  await withInitedProject(async (cwd) => {
    await writeFile(join(cwd, 'plans/0001.md'), 'plan 1', 'utf8');
    await writeFile(join(cwd, 'chapters/0001.md'), 'draft 1', 'utf8');
    await writeFile(join(cwd, 'reviews/0001.internal.md'), 'review 1', 'utf8');
    await writeFile(join(cwd, 'plans/0002.md'), 'plan 2', 'utf8');

    const io = silentIo();
    const exit = await run(['state'], cwd, io.io, { env: {} });
    assert.equal(exit, 0);

    const output = io.out.join('');
    assert.match(output, /chapter 1: plan OK \| draft OK \| internal OK \| reader-sim --/);
    assert.match(output, /chapter 2: plan OK \| draft -- \| internal --/);
    assert.match(output, /next plan:\s+3/);
    assert.match(output, /next draft:\s+2/);
    assert.match(output, /next decision:\s+1/);
  });
});

test('state next pointers stop at the first gap', async () => {
  await withInitedProject(async (cwd) => {
    await writeFile(join(cwd, 'plans/0001.md'), 'plan 1', 'utf8');
    await writeFile(join(cwd, 'plans/0003.md'), 'plan 3', 'utf8');

    const io = silentIo();
    await run(['state'], cwd, io.io, { env: {} });
    const output = io.out.join('');
    assert.match(output, /next plan:\s+2/);
  });
});

test('brief prints product.md', async () => {
  await withInitedProject(async (cwd) => {
    const io = silentIo();
    const exit = await run(['brief'], cwd, io.io, { env: {} });
    assert.equal(exit, 0);
    const output = io.out.join('');
    assert.match(output, /# 作品定位/);
    assert.match(output, /都市异能脑洞爽文/);
  });
});

test('profile prints author.md', async () => {
  await withInitedProject(async (cwd) => {
    const io = silentIo();
    const exit = await run(['profile'], cwd, io.io, { env: {} });
    assert.equal(exit, 0);
    const output = io.out.join('');
    assert.match(output, /# 作者人格/);
    assert.match(output, /商业连载型都市异能作者/);
  });
});

test('brief reports a clear error if product.md is missing', async () => {
  await withInitedProject(async (cwd) => {
    await unlink(join(cwd, 'product.md'));
    const io = silentIo();
    const exit = await run(['brief'], cwd, io.io, { env: {} });
    assert.equal(exit, 1);
    assert.match(io.err.join(''), /product\.md \(作品定位\) not found/);
  });
});

test('profile reports a clear error if author.md is missing', async () => {
  await withInitedProject(async (cwd) => {
    await unlink(join(cwd, 'author.md'));
    const io = silentIo();
    const exit = await run(['profile'], cwd, io.io, { env: {} });
    assert.equal(exit, 1);
    assert.match(io.err.join(''), /author\.md \(作者人格\) not found/);
  });
});
