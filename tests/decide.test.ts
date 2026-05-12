import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';
import type { LlmClient } from '../src/core/llm.ts';

async function withReviewedChapter(body: (cwd: string) => Promise<void>, withFeedback = false): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-v2-decide-test-'));
  try {
    const io = silentIo();
    assert.equal(await run(['init', 'demo', '--quick'], root, io.io, { env: {} }), 0);
    const cwd = join(root, 'demo');
    await writeFile(join(cwd, 'chapters/0001.md'), '# 章节 1\n\n正文。', 'utf8');
    await writeFile(join(cwd, 'reviews/0001.internal.md'), '# 内部评审\n\n## 编辑决议\n- 风格小改', 'utf8');
    await writeFile(join(cwd, 'reviews/0001.reader-sim.md'), '# 模拟读者\n\n## 爽点读者\n爽。', 'utf8');
    if (withFeedback) {
      await writeFile(join(cwd, 'feedback/0001.analysis.md'), '# 反馈分析\n\n## 有效反馈\n- 节奏可调', 'utf8');
    }
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

test('decide errors when internal review is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'authoros-v2-decide-error-'));
  try {
    const io = silentIo();
    assert.equal(await run(['init', 'demo', '--quick'], root, io.io, { env: {} }), 0);
    const cwd = join(root, 'demo');
    await writeFile(join(cwd, 'chapters/0001.md'), 'draft', 'utf8');

    const errIo = silentIo();
    const exit = await run(['decide', '--chapter', '1'], cwd, errIo.io, { env: {} });
    assert.equal(exit, 1);
    assert.match(errIo.err.join(''), /missing required context/);
    assert.match(errIo.err.join(''), /reviews\/0001\.internal\.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('decide scaffold marks feedback absent and never redistributes weight', async () => {
  await withReviewedChapter(async (cwd) => {
    const io = silentIo();
    assert.equal(await run(['decide', '--chapter', '1', '--write'], cwd, io.io, { env: {} }), 0);
    const stored = await readFile(join(cwd, 'decisions/0001.md'), 'utf8');
    assert.match(stored, /## 决策摘要/);
    assert.match(stored, /### 作者长期规划/);
    assert.match(stored, /### 内部评审/);
    assert.match(stored, /### 模拟读者/);
    assert.match(stored, /### 真实读者反馈/);
    assert.match(stored, /未参与。本章暂无真实反馈,不进行模拟补权。/);
    assert.match(stored, /feedback_available: no/);
  });
});

test('decide scaffold treats feedback as present when analysis file exists', async () => {
  await withReviewedChapter(async (cwd) => {
    const io = silentIo();
    assert.equal(await run(['decide', '--chapter', '1', '--write'], cwd, io.io, { env: {} }), 0);
    const stored = await readFile(join(cwd, 'decisions/0001.md'), 'utf8');
    assert.match(stored, /feedback_available: yes/);
    assert.match(stored, /权重默认 20%/);
    assert.doesNotMatch(stored, /未参与。本章暂无真实反馈/);
  }, true);
});

test('decide --model communicates feedback_available to the agent', async () => {
  await withReviewedChapter(async (cwd) => {
    let captured = '';
    const llm: LlmClient = {
      async generate(prompt) {
        captured = prompt;
        return [
          '## 决策摘要',
          '稳。',
          '## 决策依据',
          '### 作者长期规划',
          '继续推进第一阶段。',
          '### 内部评审',
          '采纳风格小改。',
          '### 模拟读者',
          '反应正面。',
          '### 真实读者反馈',
          '未参与。本章暂无真实反馈,不进行模拟补权。',
          '## 采纳的反馈',
          '- 风格小改',
          '## 不采纳及原因',
          '- 无',
          '## 下一章策略',
          '- 强化代价。',
          '## 需要更新的记忆',
          '- canon: 待补',
          '## 风险提醒',
          '- 慎重处理代价积累',
        ].join('\n');
      },
    };

    const io = silentIo();
    assert.equal(
      await run(['decide', '--chapter', '1', '--model', '--write'], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
      }),
      0,
      io.err.join(''),
    );
    assert.match(captured, /DECIDE/);
    assert.match(captured, /feedback_available: no/);
    assert.match(captured, /\.authoros\/weights\.yaml/);
    assert.match(captured, /\[reviews\/0001\.internal\.md\]/);
    assert.match(captured, /\[reviews\/0001\.reader-sim\.md\]/);

    const stored = await readFile(join(cwd, 'decisions/0001.md'), 'utf8');
    assert.match(stored, /source: model/);
    assert.match(stored, /慎重处理代价积累/);
  });
});
