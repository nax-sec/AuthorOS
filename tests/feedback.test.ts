import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';
import type { LlmClient } from '../src/core/llm.ts';

async function withDraftedChapter(body: (cwd: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-v2-feedback-test-'));
  try {
    const io = silentIo();
    assert.equal(await run(['init', 'demo', '--quick'], root, io.io, { env: {} }), 0);
    const cwd = join(root, 'demo');
    await writeFile(join(cwd, 'chapters/0001.md'), '# 章节 1\n\n正文。', 'utf8');
    await body(cwd);
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

test('feedback import converts non-empty lines to JSONL', async () => {
  await withDraftedChapter(async (cwd) => {
    const inputPath = join(cwd, 'fb.txt');
    await writeFile(inputPath, '太爽了\n\n节奏有点慢\n   \n配角不错\n', 'utf8');

    const io = silentIo();
    assert.equal(
      await run(['feedback', 'import', '--chapter', '1', inputPath], cwd, io.io, {
        env: {}, now: new Date('2026-05-11T00:00:00Z'),
      }),
      0,
      io.err.join(''),
    );

    const raw = await readFile(join(cwd, 'feedback/0001.raw.jsonl'), 'utf8');
    const lines = raw.split('\n').filter((line) => line.length > 0);
    assert.equal(lines.length, 3);
    assert.deepEqual(JSON.parse(lines[0]), { chapter: 1, text: '太爽了', received: '2026-05-11T00:00:00.000Z' });
    assert.deepEqual(JSON.parse(lines[2]), { chapter: 1, text: '配角不错', received: '2026-05-11T00:00:00.000Z' });

    assert.match(io.out.join(''), /imported: 3/);
    assert.match(io.out.join(''), /total after: 3/);
  });
});

test('feedback import appends rather than overwrites', async () => {
  await withDraftedChapter(async (cwd) => {
    const inputPath = join(cwd, 'fb.txt');
    await writeFile(inputPath, 'one\n', 'utf8');
    assert.equal(
      await run(['feedback', 'import', '--chapter', '1', inputPath], cwd, silentIo().io, { env: {} }),
      0,
    );
    await writeFile(inputPath, 'two\nthree\n', 'utf8');
    const io = silentIo();
    assert.equal(
      await run(['feedback', 'import', '--chapter', '1', inputPath], cwd, io.io, { env: {} }),
      0,
    );
    assert.match(io.out.join(''), /imported: 2/);
    assert.match(io.out.join(''), /total after: 3/);
  });
});

test('feedback import errors on missing input file', async () => {
  await withDraftedChapter(async (cwd) => {
    const io = silentIo();
    const exit = await run(['feedback', 'import', '--chapter', '1', 'nope.txt'], cwd, io.io, { env: {} });
    assert.equal(exit, 1);
    assert.match(io.err.join(''), /Feedback input file not found/);
  });
});

test('feedback import errors on empty input file', async () => {
  await withDraftedChapter(async (cwd) => {
    const inputPath = join(cwd, 'empty.txt');
    await writeFile(inputPath, '\n\n\n', 'utf8');
    const io = silentIo();
    const exit = await run(['feedback', 'import', '--chapter', '1', inputPath], cwd, io.io, { env: {} });
    assert.equal(exit, 1);
    assert.match(io.err.join(''), /no non-empty lines/);
  });
});

test('feedback analyze errors when no imported feedback', async () => {
  await withDraftedChapter(async (cwd) => {
    const io = silentIo();
    const exit = await run(['feedback', 'analyze', '--chapter', '1'], cwd, io.io, { env: {} });
    assert.equal(exit, 1);
    assert.match(io.err.join(''), /No imported feedback/);
  });
});

test('feedback analyze scaffold lists all classification sections', async () => {
  await withDraftedChapter(async (cwd) => {
    const inputPath = join(cwd, 'fb.txt');
    await writeFile(inputPath, '太爽了\n节奏慢\n', 'utf8');
    assert.equal(
      await run(['feedback', 'import', '--chapter', '1', inputPath], cwd, silentIo().io, { env: {} }),
      0,
    );

    const io = silentIo();
    assert.equal(
      await run(['feedback', 'analyze', '--chapter', '1', '--write'], cwd, io.io, { env: {} }),
      0,
    );
    const stored = await readFile(join(cwd, 'feedback/0001.analysis.md'), 'utf8');
    assert.match(stored, /## 高频共性反馈/);
    assert.match(stored, /## 情绪倾向/);
    assert.match(stored, /## 有效反馈/);
    assert.match(stored, /## 噪声反馈/);
    assert.match(stored, /## 可能误读/);
    assert.match(stored, /## 需要验证的假设/);
    assert.match(stored, /## 不应迎合的反馈/);
    assert.match(stored, /source: scaffold/);
    assert.match(stored, /feedback_count: 2/);
  });
});

test('feedback analyze --model captures jsonl content in prompt', async () => {
  await withDraftedChapter(async (cwd) => {
    const inputPath = join(cwd, 'fb.txt');
    await writeFile(inputPath, '太爽了\n节奏慢\n', 'utf8');
    assert.equal(
      await run(['feedback', 'import', '--chapter', '1', inputPath], cwd, silentIo().io, { env: {} }),
      0,
    );

    let captured = '';
    const llm: LlmClient = {
      async generate(prompt) {
        captured = prompt;
        return [
          '## 高频共性反馈',
          '- 节奏问题被多次提到',
          '## 情绪倾向',
          '- 总体偏正面',
          '## 有效反馈',
          '- 节奏可以稍微调整',
          '## 噪声反馈',
          '- 无',
          '## 可能误读',
          '- 无',
          '## 需要验证的假设',
          '- 后两章重新评估节奏',
          '## 不应迎合的反馈',
          '- 无',
        ].join('\n');
      },
    };

    const io = silentIo();
    assert.equal(
      await run(['feedback', 'analyze', '--chapter', '1', '--model', '--write'], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
      }),
      0,
      io.err.join(''),
    );

    assert.match(captured, /FEEDBACK_ANALYZE/);
    assert.match(captured, /\[feedback\/0001\.raw\.jsonl\]/);
    assert.match(captured, /太爽了/);
    assert.match(captured, /节奏慢/);

    const stored = await readFile(join(cwd, 'feedback/0001.analysis.md'), 'utf8');
    assert.match(stored, /节奏问题被多次提到/);
    assert.match(stored, /source: model/);
  });
});
