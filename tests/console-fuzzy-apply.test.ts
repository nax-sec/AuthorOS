import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';

async function withBook(body: (bookDir: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-console-fuzzy-'));
  try {
    const init = silentIo();
    const exit = await run(['init', 'demo', '--quick'], root, init.io, { env: {} });
    assert.equal(exit, 0, init.err.join(''));
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

function fakeLlm(reply: string) {
  return {
    async generate() {
      return reply;
    },
  };
}

test('console --write applies fuzzy context when only trailing whitespace differs', async () => {
  await withBook(async (bookDir) => {
    await writeFile(join(bookDir, 'outline.md'), '# 主线大纲\n\n第一段   \n旧内容\n结束\n', 'utf8');
    const io = silentIo();

    const exit = await run(['console', '--write', '替换旧内容'], bookDir, io.io, {
      llm: fakeLlm(consoleReply([
        '--- outline.md',
        '@@ -3,3 +3,3 @@',
        ' 第一段',
        '-旧内容',
        '+新内容',
        ' 结束',
      ].join('\n'))),
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
    });

    assert.equal(exit, 0, io.err.join(''));
    assert.match(await readFile(join(bookDir, 'outline.md'), 'utf8'), /第一段\s+\n新内容\n结束/);
  });
});

test('console --write fuzzy fallback refuses missing delete blocks', async () => {
  await withBook(async (bookDir) => {
    await writeFile(join(bookDir, 'outline.md'), '# 主线大纲\n\n真实内容\n', 'utf8');
    const io = silentIo();

    const exit = await run(['console', '--write', '替换不存在内容'], bookDir, io.io, {
      llm: fakeLlm(consoleReply([
        '--- outline.md',
        '@@ -1,1 +1,1 @@',
        '-不存在内容',
        '+新内容',
      ].join('\n'))),
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
    });

    assert.equal(exit, 1);
    assert.match(io.err.join(''), /console diff does not apply cleanly to outline\.md/);
    assert.match(await readFile(join(bookDir, 'outline.md'), 'utf8'), /真实内容/);
  });
});

test('console --write fuzzy fallback uses hunk line number to avoid greedy replacement', async () => {
  await withBook(async (bookDir) => {
    await writeFile(join(bookDir, 'outline.md'), [
      '# 主线大纲',
      '',
      'repeat   ',
      'keep first',
      'middle',
      'repeat   ',
      'keep second',
      '',
    ].join('\n'), 'utf8');
    const io = silentIo();

    const exit = await run(['console', '--write', '替换第二处 repeat'], bookDir, io.io, {
      llm: fakeLlm(consoleReply([
        '--- outline.md',
        '@@ -6,1 +6,1 @@',
        '-repeat',
        '+replacement',
      ].join('\n'))),
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
    });

    assert.equal(exit, 0, io.err.join(''));
    assert.match(await readFile(join(bookDir, 'outline.md'), 'utf8'), /repeat\s+\nkeep first\nmiddle\nreplacement\nkeep second/);
  });
});

function consoleReply(diff: string): string {
  return [
    '[scope] book',
    '[impact]',
    '  medium: outline.md - apply fuzzy patch',
    '[diff]',
    diff,
    '[next]',
    '  author brief',
  ].join('\n');
}
