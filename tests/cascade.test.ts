import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCascadedMarkdown, loadCascadedYaml } from '../src/core/cascade.ts';

async function withRoots(body: (roots: { builtin: string; author: string; book: string }) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-v03-cascade-test-'));
  try {
    const roots = {
      builtin: join(root, 'builtin'),
      author: join(root, 'author'),
      book: join(root, 'book'),
    };
    await mkdir(roots.builtin, { recursive: true });
    await mkdir(roots.author, { recursive: true });
    await mkdir(roots.book, { recursive: true });
    await body(roots);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('loadCascadedMarkdown lets later layers replace whole files', async () => {
  await withRoots(async ({ builtin, author, book }) => {
    await writeFile(join(builtin, 'agents.md'), 'builtin', 'utf8');
    await writeFile(join(author, 'agents.md'), 'author', 'utf8');
    await writeFile(join(book, 'agents.md'), 'book', 'utf8');

    const value = await loadCascadedMarkdown({ builtinRoot: builtin, authorRoot: author, bookRoot: book }, 'agents.md');

    assert.equal(value, 'book');
  });
});

test('loadCascadedYaml deep merges objects across all layers', async () => {
  await withRoots(async ({ builtin, author, book }) => {
    await writeFile(join(builtin, 'preferences.yaml'), [
      'settings:',
      '  model: base',
      '  timeout: 10',
      '',
    ].join('\n'), 'utf8');
    await writeFile(join(author, 'preferences.yaml'), [
      'settings:',
      '  timeout: 20',
      '  language: zh',
      '',
    ].join('\n'), 'utf8');
    await writeFile(join(book, 'preferences.yaml'), [
      'settings:',
      '  language: en',
      '',
    ].join('\n'), 'utf8');

    const value = await loadCascadedYaml<{ settings: Record<string, unknown> }>({
      builtinRoot: builtin,
      authorRoot: author,
      bookRoot: book,
    }, 'preferences.yaml');

    assert.deepEqual(value.settings, { model: 'base', timeout: 20, language: 'en' });
  });
});

test('loadCascadedYaml tolerates missing middle and outer layers', async () => {
  await withRoots(async ({ builtin }) => {
    await writeFile(join(builtin, 'preferences.yaml'), 'settings:\n  model: base\n', 'utf8');

    const value = await loadCascadedYaml<{ settings: { model: string } }>({
      builtinRoot: builtin,
      authorRoot: null,
      bookRoot: null,
    }, 'preferences.yaml');

    assert.equal(value.settings.model, 'base');
  });
});

test('loadCascadedYaml merges arrays by id', async () => {
  await withRoots(async ({ builtin, author, book }) => {
    const relative = 'readers.yaml';
    await writeFile(join(builtin, relative), [
      'simulated_readers:',
      '  - id: R1',
      '    name: 节奏型',
      '    cares:',
      '      - 节奏',
      '  - id: R2',
      '    name: 角色型',
      '    cares:',
      '      - 人物',
      '',
    ].join('\n'), 'utf8');
    await writeFile(join(author, relative), [
      'simulated_readers:',
      '  - id: R1',
      '    cares:',
      '      - 新节奏',
      '',
    ].join('\n'), 'utf8');
    await writeFile(join(book, relative), [
      'simulated_readers:',
      '  - id: R3',
      '    name: 题材型',
      '    cares:',
      '      - 题材',
      '',
    ].join('\n'), 'utf8');

    const value = await loadCascadedYaml<{ simulated_readers: Array<{ id: string; name?: string; cares: string[] }> }>({
      builtinRoot: builtin,
      authorRoot: author,
      bookRoot: book,
    }, relative);

    assert.deepEqual(value.simulated_readers, [
      { id: 'R1', name: '节奏型', cares: ['新节奏'] },
      { id: 'R2', name: '角色型', cares: ['人物'] },
      { id: 'R3', name: '题材型', cares: ['题材'] },
    ]);
  });
});
