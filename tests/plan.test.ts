import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';
import type { LlmClient } from '../src/core/llm.ts';

async function withInitedProject(body: (cwd: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-v2-plan-test-'));
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

function fakeLlm(reply: string, capture?: (prompt: string) => void): LlmClient {
  return {
    async generate(prompt) {
      capture?.(prompt);
      return reply;
    },
  };
}

test('plan --chapter 1 prints a scaffold preview without --write', async () => {
  await withInitedProject(async (cwd) => {
    const io = silentIo();
    const exit = await run(['plan', '--chapter', '1'], cwd, io.io, { env: {} });
    assert.equal(exit, 0, io.err.join(''));

    const output = io.out.join('');
    assert.match(output, /AuthorOS plan: chapter 1/);
    assert.match(output, /source: scaffold/);
    assert.match(output, /\(preview, use --write to save\)/);
    assert.match(output, /## 章节目标/);
    assert.match(output, /## 伏笔触点/);

    await assert.rejects(() => stat(join(cwd, 'plans/0001.md')));
  });
});

test('plan --chapter 1 --write saves plans/0001.md', async () => {
  await withInitedProject(async (cwd) => {
    const io = silentIo();
    const exit = await run(['plan', '--chapter', '1', '--write'], cwd, io.io, { env: {} });
    assert.equal(exit, 0, io.err.join(''));

    const stored = await readFile(join(cwd, 'plans/0001.md'), 'utf8');
    assert.match(stored, /^# 章节 1 计划/);
    assert.match(stored, /agent: planner/);
    assert.match(stored, /source: scaffold/);
    assert.match(stored, /## 主要冲突/);
  });
});

test('plan --chapter 2 --model --write uses model and injects required context', async () => {
  await withInitedProject(async (cwd) => {
    let capturedPrompt = '';
    const llm = fakeLlm(
      [
        '## 章节目标',
        '主角第二次主动出击。',
        '',
        '## 主要冲突',
        '上一章遗留的代价开始反噬。',
        '',
        '## 爽点',
        '将代价反向利用。',
        '',
        '## 章尾钩子',
        '反派初次现身。',
        '',
        '## 信息释放',
        '透露能力规则的第一条。',
        '',
        '## 人物变化',
        '主角对配角态度变化。',
        '',
        '## 伏笔触点',
        '- 新增: 反派身份',
        '- 推进: 能力来源',
        '- 回收: 无',
        '',
        '## 与作者长期规划的对照',
        '服务第一阶段第一次反制。',
      ].join('\n'),
      (prompt) => { capturedPrompt = prompt; },
    );

    const io = silentIo();
    const exit = await run(
      ['plan', '--chapter', '2', '--model', '--write'],
      cwd,
      io.io,
      { env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'gpt-test' }, llm },
    );
    assert.equal(exit, 0, io.err.join(''));

    assert.match(capturedPrompt, /PLAN_CHAPTER/);
    assert.match(capturedPrompt, /chapter: 2/);
    assert.match(capturedPrompt, /agent_profile:/);
    assert.match(capturedPrompt, /# planner/);
    assert.match(capturedPrompt, /\[product\.md\]/);
    assert.match(capturedPrompt, /\[author\.md\]/);
    assert.match(capturedPrompt, /\[outline\.md\]/);
    assert.match(capturedPrompt, /\[memory\/canon\.md\]/);
    assert.match(capturedPrompt, /\[memory\/foreshadowing\.yaml\]/);

    const stored = await readFile(join(cwd, 'plans/0002.md'), 'utf8');
    assert.match(stored, /source: model/);
    assert.match(stored, /主角第二次主动出击/);
    assert.match(stored, /反派初次现身/);
  });
});

test('plan --chapter 2 --model includes previous decision when available', async () => {
  await withInitedProject(async (cwd) => {
    await writeFile(
      join(cwd, 'decisions/0001.md'),
      '# Decision 1\n采纳:加强配角变化。\n',
      'utf8',
    );

    let capturedPrompt = '';
    const llm = fakeLlm('## 章节目标\n承接 1 章决策。', (prompt) => { capturedPrompt = prompt; });

    const io = silentIo();
    const exit = await run(
      ['plan', '--chapter', '2', '--model'],
      cwd,
      io.io,
      { env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'gpt-test' }, llm },
    );
    assert.equal(exit, 0, io.err.join(''));
    assert.match(capturedPrompt, /\[decisions\/0001\.md\]/);
    assert.match(capturedPrompt, /加强配角变化/);
  });
});

test('plan --chapter 1 --model skips decisions/<previous> (no chapter 0)', async () => {
  await withInitedProject(async (cwd) => {
    let capturedPrompt = '';
    const llm = fakeLlm('## 章节目标\n开端。', (prompt) => { capturedPrompt = prompt; });

    const io = silentIo();
    const exit = await run(
      ['plan', '--chapter', '1', '--model'],
      cwd,
      io.io,
      { env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'gpt-test' }, llm },
    );
    assert.equal(exit, 0);
    assert.doesNotMatch(capturedPrompt, /decisions\/0000/);
  });
});

test('plan --next finds smallest unplanned chapter', async () => {
  await withInitedProject(async (cwd) => {
    const initialIo = silentIo();
    await run(['plan', '--chapter', '1', '--write'], cwd, initialIo.io, { env: {} });
    await run(['plan', '--chapter', '2', '--write'], cwd, initialIo.io, { env: {} });

    const io = silentIo();
    const exit = await run(['plan', '--next', '--write'], cwd, io.io, { env: {} });
    assert.equal(exit, 0, io.err.join(''));
    assert.match(io.out.join(''), /chapter 3/);
    await stat(join(cwd, 'plans/0003.md'));
  });
});

test('plan status lists existing plans and the next chapter', async () => {
  await withInitedProject(async (cwd) => {
    const initialIo = silentIo();
    await run(['plan', '--chapter', '1', '--write'], cwd, initialIo.io, { env: {} });
    await run(['plan', '--chapter', '2', '--write'], cwd, initialIo.io, { env: {} });

    const io = silentIo();
    const exit = await run(['plan', 'status'], cwd, io.io, { env: {} });
    assert.equal(exit, 0);

    const output = io.out.join('');
    assert.match(output, /plans\/0001\.md/);
    assert.match(output, /plans\/0002\.md/);
    assert.match(output, /next: 3/);
  });
});

test('plan rejects --chapter and --next combined', async () => {
  await withInitedProject(async (cwd) => {
    const io = silentIo();
    const exit = await run(['plan', '--chapter', '1', '--next'], cwd, io.io, { env: {} });
    assert.equal(exit, 1);
    assert.match(io.err.join(''), /either --chapter or --next/);
  });
});

test('plan rejects missing required context', async () => {
  await withInitedProject(async (cwd) => {
    await unlink(join(cwd, 'outline.md'));

    const io = silentIo();
    const exit = await run(['plan', '--chapter', '1'], cwd, io.io, { env: {} });
    assert.equal(exit, 1);
    assert.match(io.err.join(''), /missing required context/);
    assert.match(io.err.join(''), /outline\.md/);
  });
});

test('plan surfaces model errors as AuthorOS errors', async () => {
  await withInitedProject(async (cwd) => {
    const llm: LlmClient = {
      async generate() {
        throw new Error('timeout');
      },
    };

    const io = silentIo();
    const exit = await run(
      ['plan', '--chapter', '1', '--model'],
      cwd,
      io.io,
      { env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'gpt-test' }, llm },
    );
    assert.equal(exit, 1);
    assert.match(io.err.join(''), /Plan model generation failed.*timeout/);
  });
});

test('plan output uses the provided now date in the header', async () => {
  await withInitedProject(async (cwd) => {
    const io = silentIo();
    const now = new Date('2026-05-11T12:00:00Z');
    const exit = await run(
      ['plan', '--chapter', '1', '--write'],
      cwd,
      io.io,
      { env: {}, now },
    );
    assert.equal(exit, 0);
    const stored = await readFile(join(cwd, 'plans/0001.md'), 'utf8');
    assert.match(stored, /generated: 2026-05-11T12:00:00\.000Z/);
  });
});
