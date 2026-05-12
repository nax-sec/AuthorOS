import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';
import { validateBookFiles } from '../src/core/bookSchema.ts';
import { supportedTemplateKeys } from '../src/core/templates.ts';

const requiredTemplateFiles = [
  'meta.yaml',
  'product.md',
  'author.md',
  'world.md',
  'outline.md',
  'characters.yaml',
  'review_rules.md',
  'weights.yaml',
  'readers.yaml',
  'memory/canon.md',
  'memory/foreshadowing.yaml',
  'memory/plot_threads.yaml',
  'memory/character_state.yaml',
  'memory/style.md',
] as const;

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

test('there are twelve seed templates', () => {
  assert.equal(supportedTemplateKeys.length, 12);
});

test('each seed template contains the required file set', async () => {
  for (const key of supportedTemplateKeys) {
    for (const file of requiredTemplateFiles) {
      const info = await stat(join(process.cwd(), 'src/seed-templates', key, file));
      assert.ok(info.isFile(), `${key}/${file}`);
    }
  }
});

test('each seed template can initialize a schema-valid quick book', async () => {
  const root = await mkdtemp(join(tmpdir(), 'authoros-seed-coverage-'));
  try {
    for (const key of supportedTemplateKeys) {
      const io = silentIo();
      const exit = await run(['init', `smoke-${key}`, '--quick', '--template', key], root, io.io, { env: {} });
      assert.equal(exit, 0, `${key}: ${io.err.join('')}`);
      const violations = await validateBookFiles(join(root, `smoke-${key}`));
      assert.deepEqual(violations, [], key);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('author init copies all seed templates into the author library', async () => {
  const root = await mkdtemp(join(tmpdir(), 'authoros-author-template-coverage-'));
  try {
    const authorDir = join(root, 'author');
    const io = silentIo();
    const exit = await run(['author', 'init', '--dir', authorDir], root, io.io, { env: {} });
    assert.equal(exit, 0, io.err.join(''));

    const copied = (await readdir(join(authorDir, 'templates'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(copied, [...supportedTemplateKeys].sort());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

