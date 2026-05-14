import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';
import type { LlmClient } from '../src/core/llm.ts';

async function withProjectWithPlan(body: (cwd: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-v2-write-test-'));
  try {
    const io = silentIo();
    assert.equal(await run(['init', 'demo', '--quick'], root, io.io, { env: {} }), 0, io.err.join(''));
    const cwd = join(root, 'demo');
    assert.equal(
      await run(['plan', '--chapter', '1', '--write'], cwd, silentIo().io, { env: {} }),
      0,
    );
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

function fakeLlm(reply: string, capture?: (prompt: string) => void): LlmClient {
  return {
    async generate(prompt) {
      capture?.(prompt);
      return reply;
    },
  };
}

test('write --chapter 1 scaffold preview without --write', async () => {
  await withProjectWithPlan(async (cwd) => {
    const io = silentIo();
    const exit = await run(['write', '--chapter', '1'], cwd, io.io, { env: {} });
    assert.equal(exit, 0);
    const output = io.out.join('');
    assert.match(output, /AuthorOS write: chapter 1/);
    assert.match(output, /source: scaffold/);
    assert.match(output, /\(preview, use --write to save\)/);
    await assert.rejects(() => stat(join(cwd, 'chapters/0001.md')));
  });
});

test('write --chapter 1 --write saves chapters/0001.md scaffold', async () => {
  await withProjectWithPlan(async (cwd) => {
    const io = silentIo();
    assert.equal(await run(['write', '--chapter', '1', '--write'], cwd, io.io, { env: {} }), 0);
    const stored = await readFile(join(cwd, 'chapters/0001.md'), 'utf8');
    assert.match(stored, /# 章节 1/);
    assert.match(stored, /agent: chief-writer/);
    assert.match(stored, /\(章节正文待写\)/);
  });
});

test('write --chapter 1 --model captures plan + identity in prompt', async () => {
  await withProjectWithPlan(async (cwd) => {
    let captured = '';
    const llm = fakeLlm('章节正文。\n\n钩子在结尾。', (p) => { captured = p; });
    const io = silentIo();
    assert.equal(
      await run(['write', '--chapter', '1', '--model', '--write'], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
      }),
      0,
      io.err.join(''),
    );
    assert.match(captured, /WRITE_CHAPTER/);
    assert.match(captured, /\[product\.md\]/);
    assert.match(captured, /\[author\.md\]/);
    assert.match(captured, /\[plans\/0001\.md\]/);
    assert.match(captured, /\[memory\/canon\.md\]/);
    const stored = await readFile(join(cwd, 'chapters/0001.md'), 'utf8');
    assert.match(stored, /source: model/);
    assert.match(stored, /章节正文/);
  });
});

test('write --next picks the first planned-but-undrafted chapter', async () => {
  await withProjectWithPlan(async (cwd) => {
    assert.equal(
      await run(['plan', '--chapter', '2', '--write'], cwd, silentIo().io, { env: {} }),
      0,
    );
    // Write chapter 1 first
    assert.equal(await run(['write', '--chapter', '1', '--write'], cwd, silentIo().io, { env: {} }), 0);

    const io = silentIo();
    assert.equal(await run(['write', '--next', '--write'], cwd, io.io, { env: {} }), 0);
    assert.match(io.out.join(''), /chapter 2/);
    await stat(join(cwd, 'chapters/0002.md'));
  });
});

test('write --next errors when no planned-but-undrafted chapter exists', async () => {
  await withProjectWithPlan(async (cwd) => {
    assert.equal(await run(['write', '--chapter', '1', '--write'], cwd, silentIo().io, { env: {} }), 0);
    const io = silentIo();
    const exit = await run(['write', '--next', '--write'], cwd, io.io, { env: {} });
    assert.equal(exit, 1);
    assert.match(io.err.join(''), /No chapter plan without a draft/);
  });
});

test('write errors when plans/NNNN.md is missing', async () => {
  await withProjectWithPlan(async (cwd) => {
    const io = silentIo();
    const exit = await run(['write', '--chapter', '5'], cwd, io.io, { env: {} });
    assert.equal(exit, 1);
    assert.match(io.err.join(''), /missing required context/);
    assert.match(io.err.join(''), /plans\/0005\.md/);
  });
});

test('write rejects --chapter and --next combined', async () => {
  await withProjectWithPlan(async (cwd) => {
    const io = silentIo();
    const exit = await run(['write', '--chapter', '1', '--next'], cwd, io.io, { env: {} });
    assert.equal(exit, 1);
    assert.match(io.err.join(''), /either --chapter or --next/);
  });
});

test('write injects chapter_word_count target and range into prompt', async () => {
  await withProjectWithPlan(async (cwd) => {
    let captured = '';
    const llm = fakeLlm('正文一段。'.repeat(50), (p) => { captured = p; });
    const io = silentIo();
    assert.equal(
      await run(['write', '--chapter', '1', '--model', '--write'], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
      }),
      0,
      io.err.join(''),
    );
    assert.match(captured, /target_chinese_chars: 3000/);
    assert.match(captured, /acceptable_range: 2100 - 4500 \(floor 70% \/ ceiling 150% of target\)/);
    assert.match(captured, /never stop mid-sentence/);
  });
});

test('write reports actual chinese char count and target range status', async () => {
  await withProjectWithPlan(async (cwd) => {
    // Short reply: 50 chinese chars
    const llm = fakeLlm('正文一段。'.repeat(10));
    const io = silentIo();
    assert.equal(
      await run(['write', '--chapter', '1', '--model'], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
      }),
      0,
    );
    const output = io.out.join('');
    assert.match(output, /length: target 3000 chars/);
    assert.match(output, /actual 40 chars/);
    assert.match(output, /OUT OF RANGE/);
  });
});

test('write reports within-range when actual matches target', async () => {
  await withProjectWithPlan(async (cwd) => {
    const llm = fakeLlm('字'.repeat(2800));
    const io = silentIo();
    assert.equal(
      await run(['write', '--chapter', '1', '--model'], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
      }),
      0,
    );
    assert.match(io.out.join(''), /within target range/);
  });
});

test('write respects custom chapter_word_count from config.yaml', async () => {
  await withProjectWithPlan(async (cwd) => {
    const configPath = join(cwd, '.authoros/config.yaml');
    const config = (await readFile(configPath, 'utf8')).replace(/^chapter_word_count: 3000$/m, 'chapter_word_count: 5000');
    await writeFile(configPath, config, 'utf8');

    let captured = '';
    const llm = fakeLlm('正文。', (p) => { captured = p; });
    const io = silentIo();
    assert.equal(
      await run(['write', '--chapter', '1', '--model'], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
      }),
      0,
    );
    assert.match(captured, /target_chinese_chars: 5000/);
    assert.match(captured, /acceptable_range: 3500 - 7500/);
  });
});

test('write respects custom floor/ceiling percent from config.yaml', async () => {
  await withProjectWithPlan(async (cwd) => {
    const configPath = join(cwd, '.authoros/config.yaml');
    let config = await readFile(configPath, 'utf8');
    config = config.replace(/chapter_word_count_floor_percent: 70/, 'chapter_word_count_floor_percent: 60');
    config = config.replace(/chapter_word_count_ceiling_percent: 150/, 'chapter_word_count_ceiling_percent: 200');
    await writeFile(configPath, config, 'utf8');

    let captured = '';
    const llm = fakeLlm('正文。', (p) => { captured = p; });
    const io = silentIo();
    assert.equal(
      await run(['write', '--chapter', '1', '--model'], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
      }),
      0,
    );
    // 3000 * 0.6 = 1800; 3000 * 2.0 = 6000
    assert.match(captured, /acceptable_range: 1800 - 6000 \(floor 60% \/ ceiling 200% of target\)/);
  });
});

test('write injects previous chapter when available', async () => {
  await withProjectWithPlan(async (cwd) => {
    await writeFile(join(cwd, 'chapters/0001.md'), 'previous chapter content', 'utf8');
    assert.equal(
      await run(['plan', '--chapter', '2', '--write'], cwd, silentIo().io, { env: {} }),
      0,
    );

    let captured = '';
    const llm = fakeLlm('章节 2 正文。', (p) => { captured = p; });
    const io = silentIo();
    assert.equal(
      await run(['write', '--chapter', '2', '--model'], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
      }),
      0,
    );
    assert.match(captured, /\[chapters\/0001\.md\]/);
    assert.match(captured, /previous chapter content/);
  });
});
