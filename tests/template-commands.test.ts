import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';

async function withAuthorDir(body: (cwd: string, authorDir: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-v03-template-'));
  try {
    const authorDir = join(root, 'author');
    await mkdir(join(authorDir, 'templates/mystery_legalmedical'), { recursive: true });
    await writeFile(join(authorDir, 'templates/mystery_legalmedical/meta.yaml'), [
      'key: mystery_legalmedical',
      'name: 法医推理',
      'status: candidate',
      'tone_keywords: [悬疑, 推理, 医疗]',
      'one_line_pitch: 法医职业细节驱动的推理结构。',
      'applicable_when: 用户概念涉及法医、尸检、案件调查。',
      'not_applicable_when: 普通都市异能。',
      'diff_from:',
      '  mystery_thriller: 更强调法医职业流程。',
      'created_from:',
      '  book_name: "测试书"',
      '  distill_run_id: "run-1"',
      '',
    ].join('\n'), 'utf8');
    await writeFile(join(authorDir, 'templates/mystery_legalmedical/product.md'), '# 作品定位\n', 'utf8');
    await body(root, authorDir);
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

test('template list shows seed and author candidate templates', async () => {
  await withAuthorDir(async (_cwd, authorDir) => {
    const { io, out } = silentIo();
    const exit = await run(['template', 'list'], process.cwd(), io, {
      env: { AUTHOROS_AUTHOR_DIR: authorDir },
    });

    assert.equal(exit, 0);
    const text = out.join('');
    assert.match(text, /Templates:/);
    assert.match(text, /seed\s+active\s+urban_power_anomaly/);
    assert.match(text, /author\s+candidate\s+mystery_legalmedical\s+法医推理/);
  });
});

test('template show prints meta and file structure', async () => {
  await withAuthorDir(async (_cwd, authorDir) => {
    const { io, out } = silentIo();
    const exit = await run(['template', 'show', 'mystery_legalmedical'], process.cwd(), io, {
      env: { AUTHOROS_AUTHOR_DIR: authorDir },
    });

    assert.equal(exit, 0);
    const text = out.join('');
    assert.match(text, /meta.yaml/);
    assert.match(text, /status: candidate/);
    assert.match(text, /product.md/);
  });
});

test('template promote changes author candidate to active and keeps book provenance', async () => {
  await withAuthorDir(async (_cwd, authorDir) => {
    const { io, out } = silentIo();
    const exit = await run(['template', 'promote', 'mystery_legalmedical'], process.cwd(), io, {
      env: { AUTHOROS_AUTHOR_DIR: authorDir },
    });

    assert.equal(exit, 0);
    assert.match(out.join(''), /promoted mystery_legalmedical to active/);
    const meta = await readFile(join(authorDir, 'templates/mystery_legalmedical/meta.yaml'), 'utf8');
    assert.match(meta, /status: active/);
    assert.match(meta, /book_name: "测试书"/);
    assert.doesNotMatch(meta, /distill_run_id/);
  });
});

test('template forget rejects seed templates and deletes author-only templates', async () => {
  await withAuthorDir(async (_cwd, authorDir) => {
    const seed = silentIo();
    const seedExit = await run(['template', 'forget', 'urban_power_anomaly'], process.cwd(), seed.io, {
      env: { AUTHOROS_AUTHOR_DIR: authorDir },
    });
    assert.equal(seedExit, 1);
    assert.match(seed.err.join(''), /seed templates cannot be forgotten/);

    const authorOnly = silentIo();
    const authorExit = await run(['template', 'forget', 'mystery_legalmedical'], process.cwd(), authorOnly.io, {
      env: { AUTHOROS_AUTHOR_DIR: authorDir },
    });
    assert.equal(authorExit, 0);
    assert.match(authorOnly.out.join(''), /forgot mystery_legalmedical/);
    await assert.rejects(() => stat(join(authorDir, 'templates/mystery_legalmedical')));
  });
});

test('template export writes a zip archive', async () => {
  await withAuthorDir(async (cwd, authorDir) => {
    const archive = join(cwd, 'mystery_legalmedical.zip');
    const { io, out } = silentIo();
    const exit = await run(['template', 'export', 'mystery_legalmedical', archive], process.cwd(), io, {
      env: { AUTHOROS_AUTHOR_DIR: authorDir },
    });

    assert.equal(exit, 0);
    assert.match(out.join(''), /exported mystery_legalmedical/);
    const bytes = await readFile(archive);
    assert.equal(bytes.subarray(0, 2).toString('utf8'), 'PK');
  });
});
