import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';
import { validateBookFiles } from '../src/core/bookSchema.ts';

async function withTempCwd(body: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'authoros-memory-neutralize-'));
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

test('init neutralizes memory files when strategy base is none', async () => {
  await withTempCwd(async (cwd) => {
    const bookDir = await initConceptBook(cwd, 'none');

    await assertNeutralizedMemory(bookDir);
    const canon = await readFile(join(bookDir, 'memory/canon.md'), 'utf8');
    assert.match(canon, /题材:由概念定义,不依赖既有模板/);
    assert.match(canon, /自定义元素:民国科幻惊悚/);
  });
});

test('init neutralizes memory files while recording selected base template', async () => {
  await withTempCwd(async (cwd) => {
    const bookDir = await initConceptBook(cwd, 'sci_fi');

    await assertNeutralizedMemory(bookDir);
    const canon = await readFile(join(bookDir, 'memory/canon.md'), 'utf8');
    assert.match(canon, /基础题材参考:sci_fi/);
  });
});

async function initConceptBook(cwd: string, base: 'none' | 'sci_fi'): Promise<string> {
  const io = silentIo();
  const exit = await run(
    ['init', `book-${base}`, '--concept', '民国背景的科幻惊悚,主角是上海租界的密码学家', '--no-distill'],
    cwd,
    io.io,
    {
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
      llm: setupLlm(base),
    },
  );
  assert.equal(exit, 0, io.err.join(''));
  return join(cwd, `book-${base}`);
}

function setupLlm(base: 'none' | 'sci_fi') {
  return {
    async generate(prompt: string) {
      if (prompt.includes('SETUP_STRATEGY')) {
        return JSON.stringify({
          base,
          borrow_from: base === 'sci_fi' ? ['mystery_thriller'] : [],
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
          rationale: '测试 memory 中性化。',
        });
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
}

async function assertNeutralizedMemory(bookDir: string): Promise<void> {
  const styleBefore = await readFile(join(process.cwd(), 'src/seed-templates/urban_power_anomaly/memory/style.md'), 'utf8');
  const banned = /都市异能|能力代价|异能|异常体系/;
  for (const file of [
    'memory/canon.md',
    'memory/foreshadowing.yaml',
    'memory/plot_threads.yaml',
    'memory/character_state.yaml',
  ]) {
    assert.doesNotMatch(await readFile(join(bookDir, file), 'utf8'), banned, file);
  }
  assert.equal(await readFile(join(bookDir, 'memory/foreshadowing.yaml'), 'utf8'), 'hooks: []\n');
  assert.equal(await readFile(join(bookDir, 'memory/plot_threads.yaml'), 'utf8'), 'threads: []\n');
  assert.equal(await readFile(join(bookDir, 'memory/character_state.yaml'), 'utf8'), 'protagonist:\n  name: "待补充"\n  desire: "待补充"\n');
  assert.equal(await readFile(join(bookDir, 'memory/style.md'), 'utf8'), styleBefore);
  assert.deepEqual(await validateBookFiles(bookDir), []);
}
