import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';
import { validateBookFiles } from '../src/core/bookSchema.ts';

async function withInitedProject(body: (cwd: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-v03-schema-test-'));
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

test('validateBookFiles accepts a freshly initialized template book', async () => {
  await withInitedProject(async (cwd) => {
    assert.deepEqual(await validateBookFiles(cwd), []);
  });
});

test('validateBookFiles reports a missing required markdown heading', async () => {
  await withInitedProject(async (cwd) => {
    await writeFile(join(cwd, 'outline.md'), '# 主线大纲\n\n## 主线阶段\n\n内容\n\n## 待规划章节\n\n内容\n', 'utf8');

    const violations = await validateBookFiles(cwd);

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.file, 'outline.md');
    assert.equal(violations[0]?.kind, 'missing-heading');
    assert.match(violations[0]?.detail ?? '', /## 节奏规则/);
  });
});

test('validateBookFiles reports a missing required yaml key', async () => {
  await withInitedProject(async (cwd) => {
    await writeFile(join(cwd, 'characters.yaml'), [
      'protagonist:',
      '  desire: 想要破案',
      'major: []',
      'antagonists: []',
      '',
    ].join('\n'), 'utf8');

    const violations = await validateBookFiles(cwd);

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.file, 'characters.yaml');
    assert.equal(violations[0]?.kind, 'missing-key');
    assert.match(violations[0]?.detail ?? '', /protagonist\.name/);
  });
});
