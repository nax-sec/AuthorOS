import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { supportedTemplateKeys } from '../src/core/templates.ts';

const seedRoot = join(process.cwd(), 'src/seed-templates');

test('supportedTemplateKeys matches seed template directories', async () => {
  const dirs = (await readdir(seedRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual([...supportedTemplateKeys].sort(), dirs);
});

test('all seed template meta files pass check-template-meta', async () => {
  for (const key of supportedTemplateKeys) {
    const result = spawnSync(process.execPath, ['scripts/check-template-meta.mjs', key], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${key}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(`ok: ${key}`));
  }
});

test('seed template meta files are active and keep reusable provenance fields', async () => {
  for (const key of supportedTemplateKeys) {
    const meta = await readFile(join(seedRoot, key, 'meta.yaml'), 'utf8');
    assert.match(meta, /^status:\s*active/m, `${key} must be active`);
    assert.match(meta, /^one_line_pitch:/m, `${key} missing pitch`);
    assert.match(meta, /^applicable_when:/m, `${key} missing applicable_when`);
    assert.match(meta, /^not_applicable_when:/m, `${key} missing not_applicable_when`);
    assert.match(meta, /^diff_from:/m, `${key} missing diff_from`);
  }
});

