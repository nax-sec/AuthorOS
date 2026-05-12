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
  const { test: nodeTest } = await import('node:test');
  await withTempCwd(async (cwd) => {
    const seen: string[] = [];
    const replyBySection: Record<string, string> = {
      PRODUCT: '# 作品定位\n\n## 类型\n\n概念测试题材',
      AUTHOR: '# AI 作者人格\n\n## 作者定位\n\n概念测试作者',
      WORLD: '# 世界与规则\n\n## 基础规则\n\n概念测试规则',
      OUTLINE: '# 主线大纲\n\n## 节奏规则\n\n概念测试节奏',
      CHARACTERS: 'protagonist:\n  name: "概念测试主角"',
      REVIEW_RULES: '# 章节评审规则\n\n## 必查项\n\n概念测试评审',
    };
    const llm = {
      async generate(prompt: string) {
        const match = prompt.match(/SETUP_CONCEPT_([A-Z_]+)/);
        if (!match) throw new Error('expected SETUP_CONCEPT marker');
        const marker = match[1];
        seen.push(marker);
        return replyBySection[marker] ?? `# ${marker}\nfallback`;
      },
    };
    const { io } = silentIo();
    const exit = await run(
      ['init', 'demo', '--concept', '概念测试都市异能爽文,主角是数据分析师'],
      cwd, io,
      { env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm },
    );
    assert.equal(exit, 0);

    assert.deepEqual(new Set(seen), new Set(['PRODUCT', 'AUTHOR', 'WORLD', 'OUTLINE', 'CHARACTERS', 'REVIEW_RULES']));

    const product = await readFile(join(cwd, 'demo/product.md'), 'utf8');
    assert.match(product, /概念测试题材/);
    const author = await readFile(join(cwd, 'demo/author.md'), 'utf8');
    assert.match(author, /概念测试作者/);
    const characters = await readFile(join(cwd, 'demo/characters.yaml'), 'utf8');
    assert.match(characters, /概念测试主角/);
  });
});

test('init --guided calls book-setup-editor twice per section (question + generate)', async () => {
  await withTempCwd(async (cwd) => {
    const calls: { kind: string; marker: string }[] = [];
    const replies: Record<string, string> = {
      QUESTION_PRODUCT: '你想写什么类型?',
      QUESTION_AUTHOR: '作者偏好?',
      QUESTION_WORLD: '世界设定?',
      QUESTION_OUTLINE: '主线?',
      QUESTION_CHARACTERS: '主角?',
      QUESTION_REVIEW_RULES: '评审关注?',
      GENERATE_PRODUCT: '# 作品定位\n\n## 类型\n\n引导模式题材',
      GENERATE_AUTHOR: '# AI 作者人格\n\n## 作者定位\n\n引导模式作者',
      GENERATE_WORLD: '# 世界与规则',
      GENERATE_OUTLINE: '# 主线大纲',
      GENERATE_CHARACTERS: 'protagonist:\n  name: ""',
      GENERATE_REVIEW_RULES: '# 章节评审规则',
    };
    const llm = {
      async generate(prompt: string) {
        const qMatch = prompt.match(/SETUP_GUIDED_QUESTION_([A-Z_]+)/);
        const gMatch = prompt.match(/SETUP_GUIDED_GENERATE_([A-Z_]+)/);
        if (qMatch) {
          calls.push({ kind: 'question', marker: qMatch[1] });
          return replies[`QUESTION_${qMatch[1]}`] ?? '?';
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

    // 6 question + 5 generate (last section was 跳过 — no generate)
    assert.equal(calls.filter((c) => c.kind === 'question').length, 6);
    assert.equal(calls.filter((c) => c.kind === 'generate').length, 5);

    const product = await readFile(join(cwd, 'demo/product.md'), 'utf8');
    assert.match(product, /引导模式题材/);

    // review_rules section was 跳过, so file should match template default
    const reviewRules = await readFile(join(cwd, 'demo/review_rules.md'), 'utf8');
    assert.match(reviewRules, /章节评审规则/); // from template
  });
});

test('init --guided respects 你建议 (proposes content with no concrete input)', async () => {
  await withTempCwd(async (cwd) => {
    let suggestPromptSeen = false;
    const llm = {
      async generate(prompt: string) {
        if (prompt.includes('SETUP_GUIDED_QUESTION_')) return '问题。';
        if (prompt.includes('SETUP_GUIDED_GENERATE_')) {
          if (prompt.includes('asked you to propose')) suggestPromptSeen = true;
          return '# 章节内容';
        }
        return 'fallback';
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
