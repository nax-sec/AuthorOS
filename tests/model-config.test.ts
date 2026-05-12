import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';

async function withInitedProject(body: (cwd: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-v2-model-test-'));
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

test('model config show prints defaults when nothing is configured', async () => {
  await withInitedProject(async (cwd) => {
    const io = silentIo();
    const exit = await run(['model', 'config'], cwd, io.io, { env: {} });
    assert.equal(exit, 0);
    const output = io.out.join('');
    assert.match(output, /configured: no/);
    assert.match(output, /api key env: OPENAI_API_KEY \(missing\)/);
    assert.match(output, /baseUrl: https:\/\/api\.openai\.com\/v1/);
    assert.match(output, /model: \(missing\)/);
  });
});

test('model config set writes .authoros/model.json without storing the key value', async () => {
  await withInitedProject(async (cwd) => {
    const io = silentIo();
    const exit = await run(
      [
        'model', 'config', 'set',
        '--api-key-env', 'AUTHOROS_API_KEY',
        '--base-url', 'https://example.com/v1',
        '--model', 'gpt-test',
      ],
      cwd,
      io.io,
      { env: {} },
    );
    assert.equal(exit, 0, io.err.join(''));

    const stored = JSON.parse(await readFile(join(cwd, '.authoros/model.json'), 'utf8'));
    assert.equal(stored.provider, 'openai_compatible');
    assert.equal(stored.apiKeyEnv, 'AUTHOROS_API_KEY');
    assert.equal(stored.baseUrl, 'https://example.com/v1');
    assert.equal(stored.model, 'gpt-test');
    assert.equal(stored.apiKey, undefined);
  });
});

test('model config set rejects invalid api-key-env', async () => {
  await withInitedProject(async (cwd) => {
    const io = silentIo();
    const exit = await run(
      ['model', 'config', 'set', '--api-key-env', 'has space'],
      cwd,
      io.io,
      { env: {} },
    );
    assert.equal(exit, 1);
    assert.match(io.err.join(''), /must be an environment variable name/);
  });
});

test('model config set rejects invalid base url', async () => {
  await withInitedProject(async (cwd) => {
    const io = silentIo();
    const exit = await run(
      ['model', 'config', 'set', '--base-url', 'not a url'],
      cwd,
      io.io,
      { env: {} },
    );
    assert.equal(exit, 1);
    assert.match(io.err.join(''), /valid URL/);
  });
});

test('model config reset removes .authoros/model.json', async () => {
  await withInitedProject(async (cwd) => {
    const setIo = silentIo();
    await run(['model', 'config', 'set', '--model', 'gpt-test'], cwd, setIo.io, { env: {} });
    await stat(join(cwd, '.authoros/model.json'));

    const resetIo = silentIo();
    const exit = await run(['model', 'config', 'reset'], cwd, resetIo.io, { env: {} });
    assert.equal(exit, 0);
    await assert.rejects(() => stat(join(cwd, '.authoros/model.json')));
  });
});

test('model config resolves env fallbacks when project config is empty', async () => {
  await withInitedProject(async (cwd) => {
    const env = {
      OPENAI_API_KEY: 'live-key',
      OPENAI_BASE_URL: 'https://example.com/v1',
      AUTHOROS_MODEL: 'env-model',
    };
    const io = silentIo();
    const exit = await run(['model', 'config'], cwd, io.io, { env });
    assert.equal(exit, 0);
    const output = io.out.join('');
    assert.match(output, /api key env: OPENAI_API_KEY \(set\)/);
    assert.match(output, /baseUrl: https:\/\/example\.com\/v1/);
    assert.match(output, /model: env-model/);
  });
});
