import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildDistillPrompt,
  parseDistillResult,
  runSetupDistill,
} from '../src/commands/setup-distill.ts';

async function withTempDirs(body: (bookDir: string, authorDir: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-v03-distill-'));
  try {
    const bookDir = join(root, 'book');
    const authorDir = join(root, 'author');
    await body(bookDir, authorDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeGeneratedBook(bookDir: string): Promise<void> {
  await mkdir(join(bookDir, '.authoros'), { recursive: true });
  await writeFile(join(bookDir, '.authoros/strategy.json'), JSON.stringify({
    base: 'none',
    borrow_from: ['mystery_thriller'],
    invent: ['义体侦探职业结构'],
    scope_hint: 'may-elevate-to-author',
    per_section_intent: {},
    rationale: '新组合结构。',
  }, null, 2), 'utf8');
  await writeFile(join(bookDir, 'product.md'), '# 作品定位\n\n## 题材\n\n赛博朋克义体侦探\n\n## 目标读者\n\n读者\n\n## 核心卖点\n\n- 义体取证\n\n## 禁区\n\n- 不复制模板\n', 'utf8');
  await writeFile(join(bookDir, 'author.md'), '# 作者人格\n\n## 写作偏好\n\n冷硬。\n\n## 反馈态度\n\n看证据。\n\n## 决策原则\n\n长期结构优先。\n', 'utf8');
  await writeFile(join(bookDir, 'outline.md'), '# 主线大纲\n\n## 节奏规则\n\n调查推进。\n\n## 主线阶段\n\n陈锐追查义体黑市。\n\n## 待规划章节\n\n第一章。\n', 'utf8');
  await writeFile(join(bookDir, 'world.md'), '# 世界与规则\n\n## 基础规则\n\n义体城市。\n\n## 风险提醒\n\n技术不能万能。\n', 'utf8');
  await writeFile(join(bookDir, 'characters.yaml'), 'protagonist:\n  name: "陈锐"\n  desire: "查清义体黑市"\nmajor:\n  - name: "林白"\n    role: "线人"\nantagonists:\n  - name: "周骁"\n    role: "公司安全主管"\n', 'utf8');
  await writeFile(join(bookDir, 'review_rules.md'), '# 章节评审规则\n\n## 必查项\n\n技术一致性。\n\n## 风险分级\n\n高: 线索空降。\n', 'utf8');
}

test('parseDistillResult accepts should_create false JSON', () => {
  const result = parseDistillResult(JSON.stringify({
    should_create: false,
    reason: 'urban_power_anomaly already covers this concept.',
  }));

  assert.equal(result.should_create, false);
  assert.match(result.reason, /already covers/);
});

test('buildDistillPrompt includes generated files and existing metas', () => {
  const prompt = buildDistillPrompt({
    projectName: 'demo',
    concept: '赛博朋克义体侦探',
    strategyJson: '{"base":"none"}',
    generatedBookFiles: { 'product.md': '# 作品定位\n' },
    existingTemplateMetas: [{ key: 'sci_fi', raw: 'key: sci_fi\nname: 科幻\n' }],
    retryLeakTerms: [],
  });

  assert.match(prompt, /SETUP_DISTILL/);
  assert.match(prompt, /赛博朋克义体侦探/);
  assert.match(prompt, /generated_book_files \(full text\):/);
  assert.match(prompt, /existing_template_metas:/);
  assert.match(prompt, /key: sci_fi/);
});

test('runSetupDistill returns false without writing candidate when concept is already covered', async () => {
  await withTempDirs(async (bookDir, authorDir) => {
    await writeGeneratedBook(bookDir);
    const llm = {
      async generate(prompt: string) {
        assert.match(prompt, /普通都市异能/);
        return JSON.stringify({ should_create: false, reason: 'urban_power_anomaly 已覆盖普通都市异能。' });
      },
    };

    const result = await runSetupDistill({
      bookDir,
      authorDir,
      projectName: 'demo',
      concept: '普通都市异能',
      llm,
      now: new Date('2026-05-12T00:00:00Z'),
    });

    assert.equal(result.shouldCreate, false);
    await assert.rejects(() => stat(join(authorDir, 'templates')));
  });
});

test('runSetupDistill retries leaked concrete names and writes a candidate template', async () => {
  await withTempDirs(async (bookDir, authorDir) => {
    await writeGeneratedBook(bookDir);
    let calls = 0;
    const llm = {
      async generate(prompt: string) {
        calls += 1;
        assert.match(prompt, /赛博朋克义体侦探/);
        if (calls === 1) {
          return JSON.stringify(distillTrue({
            'product.md': '# 作品定位\n\n## 题材\n\n陈锐式义体侦探\n\n## 目标读者\n\n读者\n\n## 核心卖点\n\n- 技术调查\n\n## 禁区\n\n- 人名泄漏\n',
          }));
        }
        assert.match(prompt, /Previous attempt leaked specific names: 陈锐/);
        return JSON.stringify(distillTrue({
          'product.md': '# 作品定位\n\n## 题材\n\n<主角姓名>式义体侦探\n\n## 目标读者\n\n读者\n\n## 核心卖点\n\n- 技术调查\n\n## 禁区\n\n- 不写具体人名\n',
        }));
      },
    };

    const result = await runSetupDistill({
      bookDir,
      authorDir,
      projectName: 'demo',
      concept: '赛博朋克义体侦探',
      llm,
      now: new Date('2026-05-12T00:00:00Z'),
    });

    assert.equal(result.shouldCreate, true);
    assert.equal(result.key, 'cyberpunk_body_detective');
    assert.equal(calls, 2);

    const meta = await readFile(join(authorDir, 'templates/cyberpunk_body_detective/meta.yaml'), 'utf8');
    assert.match(meta, /status: candidate/);
    assert.match(meta, /book_name: "demo"/);
    const product = await readFile(join(authorDir, 'templates/cyberpunk_body_detective/product.md'), 'utf8');
    assert.doesNotMatch(product, /陈锐/);
    assert.match(product, /<主角姓名>/);
    const provenance = await readFile(join(authorDir, 'templates/cyberpunk_body_detective/provenance.md'), 'utf8');
    assert.match(provenance, /distill prompt hash/);
  });
});

test('runSetupDistill warns and refuses candidate when place names still leak after retry', async () => {
  await withTempDirs(async (bookDir, authorDir) => {
    await writeGeneratedBook(bookDir);
    await writeFile(join(bookDir, 'world.md'), '# 世界与规则\n\n## 基础规则\n\n新港镇是义体黑市的核心据点。\n\n## 风险提醒\n\n技术不能万能。\n', 'utf8');

    let calls = 0;
    const llm = {
      async generate(prompt: string) {
        calls += 1;
        if (calls === 2) {
          assert.match(prompt, /Previous attempt leaked specific names: 新港镇/);
        }
        return JSON.stringify(distillTrue({
          'world.md': '# 世界与规则\n\n## 基础规则\n\n新港镇式义体黑市城市。\n\n## 风险提醒\n\n不能万能。\n',
        }));
      },
    };

    const result = await runSetupDistill({
      bookDir,
      authorDir,
      projectName: 'demo',
      concept: '赛博朋克义体侦探',
      llm,
      now: new Date('2026-05-12T00:00:00Z'),
    });

    assert.equal(calls, 2);
    assert.equal(result.shouldCreate, false);
    assert.match(result.reason, /warning/i);
    assert.ok(result.leakedTerms?.includes('新港镇'));
    await assert.rejects(() => stat(join(authorDir, 'templates')));
  });
});

function distillTrue(overrides: Record<string, string>) {
  return {
    should_create: true,
    reason: '赛博朋克义体侦探不被现有模板完整覆盖。',
    proposed_key: 'cyberpunk_body_detective',
    meta: {
      name: '赛博义体侦探',
      tone_keywords: ['科幻', '侦探', '都市'],
      one_line_pitch: '义体技术与侦探调查结合的长篇结构。',
      applicable_when: '用户概念涉及义体、侦探、公司城市。',
      not_applicable_when: '普通都市异能或传统悬疑。',
      diff_from: { sci_fi: '更重调查结构。' },
    },
    skeleton_files: {
      'product.md': overrides['product.md'] ?? '# 作品定位\n\n## 题材\n\n义体侦探\n\n## 目标读者\n\n读者\n\n## 核心卖点\n\n- 调查\n\n## 禁区\n\n- 具体人名\n',
      'outline.md': '# 主线大纲\n\n## 节奏规则\n\n调查推进。\n\n## 主线阶段\n\n- 阶段\n\n## 待规划章节\n\n- 待定\n',
      'world.md': overrides['world.md'] ?? '# 世界与规则\n\n## 基础规则\n\n技术城市。\n\n## 风险提醒\n\n不能万能。\n',
      'characters.yaml': 'protagonist:\n  name: "<主角姓名>"\n  desire: ""\nmajor: []\nantagonists: []\n',
      'review_rules.md': '# 章节评审规则\n\n## 必查项\n\n技术一致。\n\n## 风险分级\n\n高: 空降。\n',
      'memory/canon.md': '# 正史设定\n\n## 变更记录\n\n- 待定。\n',
      'memory/foreshadowing.yaml': 'hooks: []\n',
      'memory/plot_threads.yaml': 'threads: []\n',
      'memory/character_state.yaml': 'protagonist: {}\n',
      'memory/style.md': '# 风格规则\n\n## 变更记录\n\n- 待定。\n',
    },
  };
}
