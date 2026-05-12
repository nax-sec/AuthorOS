import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';

async function withBook(body: (bookDir: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-console-rollback-'));
  try {
    const init = silentIo();
    assert.equal(await run(['init', 'demo', '--quick'], root, init.io), 0, init.err.join(''));
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

test('console log reports empty history clearly', async () => {
  await withBook(async (bookDir) => {
    const io = silentIo();
    const exit = await run(['console', 'log'], bookDir, io.io, { env: {} });

    assert.equal(exit, 0, io.err.join(''));
    assert.equal(io.out.join(''), 'Changes: none\n');
  });
});

test('console rollback requires a change id', async () => {
  await withBook(async (bookDir) => {
    const io = silentIo();
    const exit = await run(['console', '--rollback'], bookDir, io.io, { env: {} });

    assert.equal(exit, 1);
    assert.match(io.err.join(''), /--rollback requires a change id/);
  });
});

