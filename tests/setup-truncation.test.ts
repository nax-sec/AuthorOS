import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';

async function withTempCwd(body: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'authoros-setup-truncation-'));
  try {
    await body(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
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

test('setup generation retries a truncated outline with doubled maxTokens', async () => {
  await withTempCwd(async (cwd) => {
    const calls: Array<{ section: string; maxTokens: number }> = [];
    let outlineCalls = 0;
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    try {
      const llm = {
        async generate(prompt: string, options: { maxTokens: number }) {
          if (prompt.includes('SETUP_STRATEGY')) {
            return JSON.stringify({
              base: 'none',
              borrow_from: [],
              invent: ['密码学职业线'],
              scope_hint: 'this-book-only',
              per_section_intent: {
                'product.md': '写定位。',
                'author.md': '写作者。',
                'outline.md': '写完整大纲。',
                'world.md': '写世界。',
                'characters.yaml': '写人物。',
                'review_rules.md': '写评审。',
              },
              rationale: '测试截断重试。',
            });
          }
          const section = sectionFromPrompt(prompt);
          calls.push({ section, maxTokens: options.maxTokens });
          if (prompt.includes('SETUP_GENERATE_OUTLINE')) {
            outlineCalls += 1;
            if (outlineCalls === 1) {
              return '# 主线大纲\n\n## 节奏规则\n\n每章推进一条密电线索\n\n## 主线阶段\n\n顾衡决定做私';
            }
            return '# 主线大纲\n\n## 节奏规则\n\n每章推进一条密电线索。\n\n## 主线阶段\n\n- 第一阶段: 顾衡破解租界密电。\n\n## 待规划章节\n\n- 第一章: 异常电文抵达。';
          }
          if (prompt.includes('SETUP_GENERATE_PRODUCT')) return '# 作品定位\n\n## 题材\n\n民国科幻惊悚。\n\n## 目标读者\n\n悬疑读者。\n\n## 核心卖点\n\n- 密码学破案\n\n## 禁区\n\n- 不空降真相\n';
          if (prompt.includes('SETUP_GENERATE_AUTHOR')) return '# 作者人格\n\n## 写作偏好\n\n克制。\n\n## 反馈态度\n\n看证据。\n\n## 决策原则\n\n公平悬疑优先。\n';
          if (prompt.includes('SETUP_GENERATE_WORLD')) return '# 世界与规则\n\n## 基础规则\n\n民国租界规则森严。\n\n## 风险提醒\n\n技术不能万能。\n';
          if (prompt.includes('SETUP_GENERATE_CHARACTERS')) return 'protagonist:\n  name: "顾衡"\n  desire: "破解密电"\nmajor: []\nantagonists: []\n';
          if (prompt.includes('SETUP_GENERATE_REVIEW_RULES')) return '# 章节评审规则\n\n## 必查项\n\n- 线索公平\n\n## 风险分级\n\n- 高: 技术空降\n';
          throw new Error(`unexpected prompt: ${prompt.slice(0, 80)}`);
        },
      };

      const io = silentIo();
      const exit = await run(
        ['init', 'truncation', '--concept', '民国背景的科幻惊悚,主角是上海租界的密码学家', '--no-distill'],
        cwd,
        io.io,
        { env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm },
      );
      assert.equal(exit, 0, io.err.join(''));

      assert.equal(outlineCalls, 2);
      assert.deepEqual(calls.filter((call) => call.section === 'outline.md').map((call) => call.maxTokens), [4000, 8000]);
      assert.equal(calls.find((call) => call.section === 'world.md')?.maxTokens, 3600);
      assert.match(warnings.join('\n'), /\[Setup\] warn: setup 主线大纲 looked truncated; retrying/);
      const outline = await readFile(join(cwd, 'truncation/outline.md'), 'utf8');
      assert.match(outline, /## 待规划章节/);
      assert.match(outline, /异常电文抵达/);
      assert.doesNotMatch(outline, /顾衡决定做私$/);
    } finally {
      console.warn = originalWarn;
    }
  });
});

function sectionFromPrompt(prompt: string): string {
  if (prompt.includes('SETUP_GENERATE_PRODUCT')) return 'product.md';
  if (prompt.includes('SETUP_GENERATE_AUTHOR')) return 'author.md';
  if (prompt.includes('SETUP_GENERATE_WORLD')) return 'world.md';
  if (prompt.includes('SETUP_GENERATE_OUTLINE')) return 'outline.md';
  if (prompt.includes('SETUP_GENERATE_CHARACTERS')) return 'characters.yaml';
  if (prompt.includes('SETUP_GENERATE_REVIEW_RULES')) return 'review_rules.md';
  return 'unknown';
}
