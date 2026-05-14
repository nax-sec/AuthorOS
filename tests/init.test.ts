import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';

async function withTempCwd(body: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'authoros-v2-test-'));
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

test('init creates the full v2 project layout', async () => {
  await withTempCwd(async (cwd) => {
    const { io, err } = silentIo();
    const exit = await run(['init', 'demo', '--template', 'urban_power_anomaly', '--quick'], cwd, io);
    assert.equal(exit, 0, err.join(''));

    const projectDir = join(cwd, 'demo');

    const expectedFiles = [
      'product.md',
      'author.md',
      'outline.md',
      'world.md',
      'characters.yaml',
      'review_rules.md',
      'README.md',
      'memory/canon.md',
      'memory/foreshadowing.yaml',
      'memory/plot_threads.yaml',
      'memory/character_state.yaml',
      'memory/style.md',
      '.authoros/config.yaml',
      '.authoros/state.json',
      '.authoros/weights.yaml',
      '.authoros/readers.yaml',
      '.authoros/agents/planner.md',
      '.authoros/agents/chief-writer.md',
      '.authoros/agents/world-advisor.md',
      '.authoros/agents/character-advisor.md',
      '.authoros/agents/plot-advisor.md',
      '.authoros/agents/style-advisor.md',
      '.authoros/agents/editor.md',
      '.authoros/agents/reader-sim.md',
      '.authoros/agents/feedback-analyzer.md',
      '.authoros/agents/decider.md',
      '.authoros/agents/memory-curator.md',
      '.authoros/agents/author-console.md',
      '.authoros/templates/urban_power_anomaly/product.md',
    ];

    for (const file of expectedFiles) {
      const info = await stat(join(projectDir, file));
      assert.ok(info.isFile(), `expected file: ${file}`);
    }

    const expectedDirs = [
      'plans',
      'chapters',
      'reviews',
      'feedback',
      'decisions',
      '.authoros/runs',
    ];

    for (const dir of expectedDirs) {
      const info = await stat(join(projectDir, dir));
      assert.ok(info.isDirectory(), `expected directory: ${dir}`);
    }
  });
});

test('init writes a config.yaml that references project name and template', async () => {
  await withTempCwd(async (cwd) => {
    const { io } = silentIo();
    await run(['init', '我的小说', '--template', 'urban_power_anomaly', '--quick'], cwd, io);

    const config = await readFile(join(cwd, '我的小说', '.authoros/config.yaml'), 'utf8');
    assert.match(config, /project_name: "我的小说"/);
    assert.match(config, /template: urban_power_anomaly/);
    assert.match(config, /language: zh-CN/);
    assert.match(config, /chapter_word_count: 3000/);
    assert.match(config, /chapter_word_count_floor_percent: 70/);
    assert.match(config, /chapter_word_count_ceiling_percent: 150/);
  });
});

test('init --quick prefers author template over built-in seed template', async () => {
  await withTempCwd(async (cwd) => {
    const authorDir = join(cwd, 'author-home');
    assert.equal(await run(['author', 'init', '--dir', authorDir], cwd, silentIo().io, { env: {} }), 0);
    await writeFile(
      join(authorDir, 'templates/urban_power_anomaly/product.md'),
      '# 作品定位\n\n## 题材\n\nAUTHOR TEMPLATE PRODUCT\n\n## 目标读者\n\nA\n\n## 核心卖点\n\n- B\n\n## 禁区\n\n- C\n',
      'utf8',
    );

    const { io } = silentIo();
    const exit = await run(['init', 'demo', '--template', 'urban_power_anomaly', '--quick'], cwd, io, {
      env: { AUTHOROS_AUTHOR_DIR: authorDir },
    });
    assert.equal(exit, 0);

    const product = await readFile(join(cwd, 'demo', 'product.md'), 'utf8');
    assert.match(product, /AUTHOR TEMPLATE PRODUCT/);
  });
});

test('init writes empty chapters state and default weights/readers', async () => {
  await withTempCwd(async (cwd) => {
    const { io } = silentIo();
    await run(['init', 'demo', '--template', 'urban_power_anomaly', '--quick'], cwd, io);

    const state = JSON.parse(await readFile(join(cwd, 'demo', '.authoros/state.json'), 'utf8'));
    assert.deepEqual(state, { chapters: {} });

    const weights = await readFile(join(cwd, 'demo', '.authoros/weights.yaml'), 'utf8');
    assert.match(weights, /author_long_term_plan:[\s\S]*?weight: 40/);
    assert.match(weights, /internal_review:[\s\S]*?weight: 30/);
    assert.match(weights, /simulated_readers:[\s\S]*?weight: 10/);
    assert.match(weights, /reader_feedback:[\s\S]*?weight: 20/);
    assert.match(weights, /redistribute_when_absent: false/);

    const readers = await readFile(join(cwd, 'demo', '.authoros/readers.yaml'), 'utf8');
    assert.match(readers, /爽点读者/);
    assert.match(readers, /节奏读者/);
    assert.match(readers, /脑洞读者/);
    assert.match(readers, /逻辑读者/);
    assert.match(readers, /人设读者/);
  });
});

test('init refuses a non-empty target without --force', async () => {
  await withTempCwd(async (cwd) => {
    const { io } = silentIo();
    const first = await run(['init', 'demo', '--quick'], cwd, io);
    assert.equal(first, 0);

    const { io: io2, err } = silentIo();
    const second = await run(['init', 'demo', '--quick'], cwd, io2);
    assert.equal(second, 1);
    assert.match(err.join(''), /Target directory is not empty/);
  });
});

test('init allows non-empty target with --force', async () => {
  await withTempCwd(async (cwd) => {
    const { io } = silentIo();
    await run(['init', 'demo', '--quick'], cwd, io);

    const { io: io2 } = silentIo();
    const second = await run(['init', 'demo', '--force', '--quick'], cwd, io2);
    assert.equal(second, 0);
  });
});

test('init rejects unsupported templates', async () => {
  await withTempCwd(async (cwd) => {
    const { io, err } = silentIo();
    const exit = await run(['init', 'demo', '--template', 'fantasy_epic', '--quick'], cwd, io);
    assert.equal(exit, 1);
    assert.match(err.join(''), /Unsupported template/);
  });
});

test('init requires a project name', async () => {
  await withTempCwd(async (cwd) => {
    const { io, err } = silentIo();
    const exit = await run(['init'], cwd, io);
    assert.equal(exit, 1);
    assert.match(err.join(''), /Project name is required/);
  });
});

test('init without a mode flag errors with usage guidance', async () => {
  await withTempCwd(async (cwd) => {
    const { io, err } = silentIo();
    const exit = await run(['init', 'demo'], cwd, io);
    assert.equal(exit, 1);
    const errOut = err.join('');
    assert.match(errOut, /requires one of/);
    assert.match(errOut, /--quick/);
    assert.match(errOut, /--concept/);
    assert.match(errOut, /--guided/);
  });
});

test('init rejects multiple mode flags', async () => {
  await withTempCwd(async (cwd) => {
    const { io, err } = silentIo();
    const exit = await run(['init', 'demo', '--quick', '--concept', 'hi'], cwd, io);
    assert.equal(exit, 1);
    assert.match(err.join(''), /Use only one of/);
  });
});

test('init --concept calls book-setup-editor once per identity file and writes content', async () => {
  await withTempCwd(async (cwd) => {
    const seen: string[] = [];
    const replyBySection: Record<string, string> = {
      PRODUCT: '# 作品定位\n\n## 题材\n\n概念测试题材\n\n## 目标读者\n\n测试读者\n\n## 核心卖点\n\n- 测试卖点\n\n## 禁区\n\n- 测试禁区',
      AUTHOR: '# 作者人格\n\n## 写作偏好\n\n概念测试作者\n\n## 反馈态度\n\n接受有效反馈\n\n## 决策原则\n\n按长期规划推进',
      WORLD: '# 世界与规则\n\n## 基础规则\n\n概念测试规则\n\n## 风险提醒\n\n避免跑偏',
      OUTLINE: '# 主线大纲\n\n## 节奏规则\n\n概念测试节奏\n\n## 主线阶段\n\n- 阶段一\n\n## 待规划章节\n\n- 第一章',
      CHARACTERS: 'protagonist:\n  name: "概念测试主角"\n  desire: "完成目标"\nmajor: []\nantagonists: []',
      REVIEW_RULES: '# 章节评审规则\n\n## 必查项\n\n概念测试评审\n\n## 风险分级\n\n- 高: 偏离概念',
    };
    const llm = {
      async generate(prompt: string) {
        if (prompt.includes('SETUP_STRATEGY')) {
          seen.push('STRATEGY');
          return JSON.stringify({
            base: 'urban_power_anomaly',
            borrow_from: [],
            invent: [],
            scope_hint: 'this-book-only',
            per_section_intent: {
              'product.md': '写概念测试定位。',
              'author.md': '写概念测试作者。',
              'outline.md': '写概念测试大纲。',
              'world.md': '写概念测试规则。',
              'characters.yaml': '写概念测试人物。',
              'review_rules.md': '写概念测试评审。',
            },
            rationale: '概念测试。',
          });
        }
        if (prompt.includes('SETUP_DISTILL')) {
          return JSON.stringify({ should_create: false, reason: '测试模板已覆盖。' });
        }
        const match = prompt.match(/SETUP_GENERATE_([A-Z_]+)/);
        if (!match) throw new Error('expected SETUP_GENERATE marker');
        const marker = match[1];
        seen.push(marker);
        return replyBySection[marker] ?? `# ${marker}\nfallback`;
      },
    };
    const { io, out } = silentIo();
    const exit = await run(
      ['init', 'demo', '--concept', '概念测试都市异能爽文,主角是数据分析师'],
      cwd, io,
      { env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm },
    );
    assert.equal(exit, 0);

    assert.deepEqual(new Set(seen), new Set(['STRATEGY', 'PRODUCT', 'AUTHOR', 'WORLD', 'OUTLINE', 'CHARACTERS', 'REVIEW_RULES']));
    assert.ok(seen.includes('STRATEGY'));
    const output = out.join('');
    assert.match(output, /\[Setup\] strategy: selecting template strategy/);
    assert.match(output, /\[Setup\] product\.md: generating 作品定位/);
    assert.match(output, /\[Setup\] validate: checking generated book files/);
    assert.match(output, /\[Setup\] distill: checking reusable template candidate/);

    const product = await readFile(join(cwd, 'demo/product.md'), 'utf8');
    assert.match(product, /概念测试题材/);
    const author = await readFile(join(cwd, 'demo/author.md'), 'utf8');
    assert.match(author, /概念测试作者/);
    const characters = await readFile(join(cwd, 'demo/characters.yaml'), 'utf8');
    assert.match(characters, /概念测试主角/);
  });
});

test('init --guided asks per section, then strategy-generates all identity files', async () => {
  await withTempCwd(async (cwd) => {
    const calls: { kind: string; marker: string }[] = [];
    const replies: Record<string, string> = {
      QUESTION_PRODUCT: '你想写什么类型?',
      QUESTION_AUTHOR: '作者偏好?',
      QUESTION_WORLD: '世界设定?',
      QUESTION_OUTLINE: '主线?',
      QUESTION_CHARACTERS: '主角?',
      QUESTION_REVIEW_RULES: '评审关注?',
      GENERATE_PRODUCT: '# 作品定位\n\n## 题材\n\n引导模式题材\n\n## 目标读者\n\n读者\n\n## 核心卖点\n\n- 卖点\n\n## 禁区\n\n- 禁区',
      GENERATE_AUTHOR: '# 作者人格\n\n## 写作偏好\n\n引导模式作者\n\n## 反馈态度\n\n重视反馈\n\n## 决策原则\n\n按规划推进',
      GENERATE_WORLD: '# 世界与规则\n\n## 基础规则\n\n规则\n\n## 风险提醒\n\n风险',
      GENERATE_OUTLINE: '# 主线大纲\n\n## 节奏规则\n\n节奏\n\n## 主线阶段\n\n- 阶段\n\n## 待规划章节\n\n- 章节',
      GENERATE_CHARACTERS: 'protagonist:\n  name: "林某"\n  desire: "目标"\nmajor: []\nantagonists: []',
      GENERATE_REVIEW_RULES: '# 章节评审规则\n\n## 必查项\n\n检查\n\n## 风险分级\n\n- 高: 偏离',
    };
    const llm = {
      async generate(prompt: string) {
        const qMatch = prompt.match(/SETUP_GUIDED_QUESTION_([A-Z_]+)/);
        const gMatch = prompt.match(/SETUP_GENERATE_([A-Z_]+)/);
        if (qMatch) {
          calls.push({ kind: 'question', marker: qMatch[1] });
          return replies[`QUESTION_${qMatch[1]}`] ?? '?';
        }
        if (prompt.includes('SETUP_STRATEGY')) {
          calls.push({ kind: 'strategy', marker: 'STRATEGY' });
          return JSON.stringify({
            base: 'urban_power_anomaly',
            borrow_from: [],
            invent: [],
            scope_hint: 'this-book-only',
            per_section_intent: {
              'product.md': '写引导定位。',
              'author.md': '写引导作者。',
              'outline.md': '写引导主线。',
              'world.md': '写引导世界。',
              'characters.yaml': '写引导人物。',
              'review_rules.md': '写引导评审。',
            },
            rationale: '引导模式。',
          });
        }
        if (prompt.includes('SETUP_DISTILL')) {
          return JSON.stringify({ should_create: false, reason: '测试模板已覆盖。' });
        }
        if (gMatch) {
          calls.push({ kind: 'generate', marker: gMatch[1] });
          return replies[`GENERATE_${gMatch[1]}`] ?? `# ${gMatch[1]}`;
        }
        throw new Error(`unexpected prompt: ${prompt.slice(0, 80)}`);
      },
    };
    const userAnswers = ['都市异能', '商业作者', '能力有代价', '主线缺口', '主角林某', '跳过'];
    let index = 0;
    const ask = async () => userAnswers[index++];

    const { io } = silentIo();
    const exit = await run(
      ['init', 'demo', '--guided'],
      cwd, io,
      { env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm, ask },
    );
    assert.equal(exit, 0);

    // 6 questions, then one strategy pass and 6 schema-based generation calls.
    assert.equal(calls.filter((c) => c.kind === 'question').length, 6);
    assert.equal(calls.filter((c) => c.kind === 'strategy').length, 1);
    assert.equal(calls.filter((c) => c.kind === 'generate').length, 6);

    const product = await readFile(join(cwd, 'demo/product.md'), 'utf8');
    assert.match(product, /引导模式题材/);
    const reviewRules = await readFile(join(cwd, 'demo/review_rules.md'), 'utf8');
    assert.match(reviewRules, /风险分级/);
  });
});

test('init --guided records 你建议 before strategy generation', async () => {
  await withTempCwd(async (cwd) => {
    let suggestPromptSeen = false;
    const llm = {
      async generate(prompt: string) {
        if (prompt.includes('SETUP_GUIDED_QUESTION_')) return '问题。';
        if (prompt.includes('SETUP_STRATEGY')) {
          if (prompt.includes('用户要求 book-setup-editor')) suggestPromptSeen = true;
          return JSON.stringify({
            base: 'none',
            borrow_from: [],
            invent: [],
            scope_hint: 'this-book-only',
            per_section_intent: {
              'product.md': '建议定位。',
              'author.md': '建议作者。',
              'outline.md': '建议大纲。',
              'world.md': '建议世界。',
              'characters.yaml': '建议人物。',
              'review_rules.md': '建议评审。',
            },
            rationale: '建议。',
          });
        }
        if (prompt.includes('SETUP_DISTILL')) {
          return JSON.stringify({ should_create: false, reason: '测试模板已覆盖。' });
        }
        if (prompt.includes('SETUP_GENERATE_PRODUCT')) return '# 作品定位\n\n## 题材\n\n建议\n\n## 目标读者\n\n读者\n\n## 核心卖点\n\n- 卖点\n\n## 禁区\n\n- 禁区';
        if (prompt.includes('SETUP_GENERATE_AUTHOR')) return '# 作者人格\n\n## 写作偏好\n\n建议\n\n## 反馈态度\n\n反馈\n\n## 决策原则\n\n原则';
        if (prompt.includes('SETUP_GENERATE_WORLD')) return '# 世界与规则\n\n## 基础规则\n\n规则\n\n## 风险提醒\n\n风险';
        if (prompt.includes('SETUP_GENERATE_OUTLINE')) return '# 主线大纲\n\n## 节奏规则\n\n节奏\n\n## 主线阶段\n\n阶段\n\n## 待规划章节\n\n章节';
        if (prompt.includes('SETUP_GENERATE_CHARACTERS')) return 'protagonist:\n  name: ""\n  desire: ""\nmajor: []\nantagonists: []';
        if (prompt.includes('SETUP_GENERATE_REVIEW_RULES')) return '# 章节评审规则\n\n## 必查项\n\n检查\n\n## 风险分级\n\n分级';
        throw new Error(`unexpected prompt: ${prompt.slice(0, 80)}`);
      },
    };
    const ask = async () => '你建议';

    const { io } = silentIo();
    const exit = await run(
      ['init', 'demo', '--guided'],
      cwd, io,
      { env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm, ask },
    );
    assert.equal(exit, 0);
    assert.equal(suggestPromptSeen, true);
  });
});

test('init --concept detective concept does not bleed urban power template vocabulary', async () => {
  await withTempCwd(async (cwd) => {
    const generationPrompts: string[] = [];
    const llm = {
      async generate(prompt: string) {
        if (prompt.includes('SETUP_STRATEGY')) {
          assert.doesNotMatch(prompt, /template_reference/);
          assert.doesNotMatch(prompt, /主角能力持续带来新问题/);
          return JSON.stringify({
            base: 'mystery_thriller',
            borrow_from: [],
            invent: ['法医职业细节', '小镇关系网'],
            scope_hint: 'this-book-only',
            per_section_intent: {
              'product.md': '写法医小镇案件定位。',
              'author.md': '写冷静克制的作者偏好。',
              'outline.md': '写连环案件阶段。',
              'world.md': '写小镇现实规则。',
              'characters.yaml': '写法医和镇民关系。',
              'review_rules.md': '写公平推理检查。',
            },
            rationale: '概念更接近悬疑推理。',
          });
        }
        if (prompt.includes('SETUP_DISTILL')) {
          return JSON.stringify({ should_create: false, reason: 'mystery_thriller 已覆盖。' });
        }
        generationPrompts.push(prompt);
        assert.doesNotMatch(prompt, /template_reference/);
        assert.doesNotMatch(prompt, /主角能力持续带来新问题/);
        if (prompt.includes('SETUP_GENERATE_PRODUCT')) return '# 作品定位\n\n## 题材\n\n法医小镇悬疑。\n\n## 目标读者\n\n喜欢案件调查和人物动机的读者。\n\n## 核心卖点\n\n- 法医视角拆解小镇关系网\n\n## 禁区\n\n- 不空降破案信息';
        if (prompt.includes('SETUP_GENERATE_AUTHOR')) return '# 作者人格\n\n## 写作偏好\n\n冷静、克制、重证据。\n\n## 反馈态度\n\n重视读者指出的不合理证据链。\n\n## 决策原则\n\n案件公平性优先。';
        if (prompt.includes('SETUP_GENERATE_WORLD')) return '# 世界与规则\n\n## 基础规则\n\n现实小镇,所有案件推进都来自证据、访谈和人物动机。\n\n## 风险提醒\n\n避免后台真相空降,避免故弄玄虚。';
        if (prompt.includes('SETUP_GENERATE_OUTLINE')) return '# 主线大纲\n\n## 节奏规则\n\n每章推进一个可验证发现。\n\n## 主线阶段\n\n- 第一阶段: 第一名死者牵出小镇旧案\n\n## 待规划章节\n\n- 第一章: 法医抵达现场';
        if (prompt.includes('SETUP_GENERATE_CHARACTERS')) return 'protagonist:\n  name: "沈岚"\n  desire: "查清小镇连环谋杀"\nmajor:\n  - name: "周巡"\n    role: "刑警"\nantagonists: []';
        if (prompt.includes('SETUP_GENERATE_REVIEW_RULES')) return '# 章节评审规则\n\n## 必查项\n\n- 证据链是否公平\n\n## 风险分级\n\n- 高: 关键发现无前文铺垫';
        throw new Error(`unexpected prompt: ${prompt.slice(0, 80)}`);
      },
    };

    const { io } = silentIo();
    const exit = await run(
      ['init', 'detective', '--concept', '侦探小说,主角是法医,在小镇调查连环谋杀'],
      cwd, io,
      { env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm },
    );
    assert.equal(exit, 0);
    assert.equal(generationPrompts.length, 6);

    const outline = await readFile(join(cwd, 'detective/outline.md'), 'utf8');
    const world = await readFile(join(cwd, 'detective/world.md'), 'utf8');
    const characters = await readFile(join(cwd, 'detective/characters.yaml'), 'utf8');
    assert.doesNotMatch(outline, /能力|代价|异常体系|异能/);
    assert.doesNotMatch(world, /异常/);
    assert.doesNotMatch(characters, /ability|ability_cost/);
  });
});

test('init --concept runs distill by default and --no-distill skips it', async () => {
  await withTempCwd(async (cwd) => {
    async function runCase(args: string[]): Promise<number> {
      let distillCalls = 0;
      const llm = {
        async generate(prompt: string) {
          if (prompt.includes('SETUP_STRATEGY')) {
            return JSON.stringify({
              base: 'urban_power_anomaly',
              borrow_from: [],
              invent: [],
              scope_hint: 'this-book-only',
              per_section_intent: {
                'product.md': '写定位。',
                'author.md': '写作者。',
                'outline.md': '写大纲。',
                'world.md': '写世界。',
                'characters.yaml': '写人物。',
                'review_rules.md': '写评审。',
              },
              rationale: '测试。',
            });
          }
          if (prompt.includes('SETUP_DISTILL')) {
            distillCalls += 1;
            return JSON.stringify({ should_create: false, reason: '已有模板覆盖。' });
          }
          if (prompt.includes('SETUP_GENERATE_PRODUCT')) return '# 作品定位\n\n## 题材\n\n都市异能\n\n## 目标读者\n\n读者\n\n## 核心卖点\n\n- 卖点\n\n## 禁区\n\n- 禁区';
          if (prompt.includes('SETUP_GENERATE_AUTHOR')) return '# 作者人格\n\n## 写作偏好\n\n偏好\n\n## 反馈态度\n\n反馈\n\n## 决策原则\n\n原则';
          if (prompt.includes('SETUP_GENERATE_WORLD')) return '# 世界与规则\n\n## 基础规则\n\n规则\n\n## 风险提醒\n\n风险';
          if (prompt.includes('SETUP_GENERATE_OUTLINE')) return '# 主线大纲\n\n## 节奏规则\n\n节奏\n\n## 主线阶段\n\n阶段\n\n## 待规划章节\n\n章节';
          if (prompt.includes('SETUP_GENERATE_CHARACTERS')) return 'protagonist:\n  name: ""\n  desire: ""\nmajor: []\nantagonists: []';
          if (prompt.includes('SETUP_GENERATE_REVIEW_RULES')) return '# 章节评审规则\n\n## 必查项\n\n检查\n\n## 风险分级\n\n分级';
          throw new Error(`unexpected prompt: ${prompt.slice(0, 80)}`);
        },
      };
      const { io } = silentIo();
      const exit = await run(args, cwd, io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm', AUTHOROS_AUTHOR_DIR: join(cwd, 'author-home') },
        llm,
      });
      return exit === 0 ? distillCalls : -1;
    }

    const defaultDistillCalls = await runCase(['init', 'distill-on', '--concept', '普通都市异能']);
    assert.equal(defaultDistillCalls, 1);
    const skippedDistillCalls = await runCase(['init', 'distill-off', '--concept', '普通都市异能', '--no-distill']);
    assert.equal(skippedDistillCalls, 0);
  });
});

test('agent profiles include Required Context block', async () => {
  await withTempCwd(async (cwd) => {
    const { io } = silentIo();
    await run(['init', 'demo', '--quick'], cwd, io);

    const chiefWriter = await readFile(
      join(cwd, 'demo', '.authoros/agents/chief-writer.md'),
      'utf8',
    );
    assert.match(chiefWriter, /Required Context/);
    assert.match(chiefWriter, /plans\/<chapter>\.md/);
    assert.match(chiefWriter, /memory\/canon\.md/);

    const decider = await readFile(
      join(cwd, 'demo', '.authoros/agents/decider.md'),
      'utf8',
    );
    assert.match(decider, /\.authoros\/weights\.yaml/);
    assert.match(decider, /author plan 40 \/ internal review 30 \/ simulated readers 10 \/ real feedback 20/);
  });
});
