import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';

async function withTempCwd(body: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'authoros-distill-failure-'));
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

test('init skips distill with warning when distill JSON is incomplete', async () => {
  await withTempCwd(async (cwd) => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    try {
      const llm = {
        async generate(prompt: string) {
          if (prompt.includes('SETUP_STRATEGY')) {
            return JSON.stringify({
              base: 'mystery_thriller',
              borrow_from: [],
              invent: ['民国科幻惊悚', '密码学职业线'],
              scope_hint: 'this-book-only',
              per_section_intent: {
                'product.md': '写民国科幻惊悚定位。',
                'author.md': '写克制惊悚作者偏好。',
                'outline.md': '写密码学家调查主线。',
                'world.md': '写租界现实规则与科幻阴影。',
                'characters.yaml': '写密码学家和租界相关人物。',
                'review_rules.md': '写悬疑和科幻一致性检查。',
              },
              rationale: '测试 Distill 失败降级。',
            });
          }
          if (prompt.includes('SETUP_DISTILL')) {
            return '{"should_create": true, "reason": "truncated"';
          }
          if (prompt.includes('SETUP_GENERATE_PRODUCT')) return '# 作品定位\n\n## 题材\n\n民国科幻惊悚。\n\n## 目标读者\n\n喜欢悬疑和科幻惊悚的读者。\n\n## 核心卖点\n\n- 密码学家破解租界谜案\n\n## 禁区\n\n- 不空降真相\n';
          if (prompt.includes('SETUP_GENERATE_AUTHOR')) return '# 作者人格\n\n## 写作偏好\n\n克制、压迫、重证据。\n\n## 反馈态度\n\n接受逻辑漏洞反馈。\n\n## 决策原则\n\n悬疑公平优先。\n';
          if (prompt.includes('SETUP_GENERATE_WORLD')) return '# 世界与规则\n\n## 基础规则\n\n民国租界,科幻元素隐藏在现实秩序下。\n\n## 风险提醒\n\n技术不能万能。\n';
          if (prompt.includes('SETUP_GENERATE_OUTLINE')) return '# 主线大纲\n\n## 节奏规则\n\n每章推进一个密码或现场发现。\n\n## 主线阶段\n\n- 第一阶段: 租界密电牵出实验痕迹\n\n## 待规划章节\n\n- 第一章: 密码学家收到异常电文\n';
          if (prompt.includes('SETUP_GENERATE_CHARACTERS')) return 'protagonist:\n  name: "顾衡"\n  desire: "破解租界密电"\nmajor:\n  - name: "陆曼"\n    role: "报馆记者"\nantagonists: []\n';
          if (prompt.includes('SETUP_GENERATE_REVIEW_RULES')) return '# 章节评审规则\n\n## 必查项\n\n- 密码线索是否公平\n\n## 风险分级\n\n- 高: 关键技术无铺垫\n';
          throw new Error(`unexpected prompt: ${prompt.slice(0, 80)}`);
        },
      };

      const io = silentIo();
      const exit = await run(
        ['init', 'bleed-test', '--concept', '民国背景的科幻惊悚,主角是上海租界的密码学家'],
        cwd,
        io.io,
        { env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm },
      );

      assert.equal(exit, 0, io.err.join(''));
      assert.match(warnings.join('\n'), /\[Distill\] warn:/);
      assert.match(warnings.join('\n'), /distill skipped:/);
      assert.doesNotMatch(io.err.join(''), /AuthorOS error/);
      const bookDir = join(cwd, 'bleed-test');
      assert.ok((await stat(join(bookDir, 'outline.md'))).isFile());
      assert.ok((await stat(join(bookDir, 'world.md'))).isFile());
      assert.ok((await stat(join(bookDir, 'characters.yaml'))).isFile());
      assert.ok((await readdir(bookDir)).includes('.authoros'));
    } finally {
      console.warn = originalWarn;
    }
  });
});
