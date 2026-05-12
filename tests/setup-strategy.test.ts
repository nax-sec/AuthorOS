import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBannedVocabulary,
  buildGenerationPrompt,
  buildStrategyPrompt,
  parseSetupStrategy,
} from '../src/commands/setup-strategy.ts';
import { bookSchema } from '../src/core/bookSchema.ts';

const metas = [
  {
    key: 'urban_power_anomaly',
    name: '都市异能',
    status: 'active',
    tone_keywords: ['现代', '爽文', '都市', '反制'],
    one_line_pitch: '都市背景下主角拥有特殊机制。',
    applicable_when: '现代都市。',
    not_applicable_when: '无超常元素。',
  },
  {
    key: 'mystery_thriller',
    name: '悬疑推理',
    status: 'active',
    tone_keywords: ['悬疑', '推理', '犯罪', '调查'],
    one_line_pitch: '以案件调查推进。',
    applicable_when: '案件调查。',
    not_applicable_when: '纯升级爽文。',
  },
];

test('parseSetupStrategy accepts raw model JSON', () => {
  const strategy = parseSetupStrategy(JSON.stringify({
    base: 'mystery_thriller',
    borrow_from: [],
    invent: ['法医职业细节'],
    scope_hint: 'this-book-only',
    per_section_intent: {
      'product.md': '写法医小镇案件定位。',
      'author.md': '写冷静克制的作者偏好。',
      'outline.md': '写连环案件阶段。',
      'world.md': '写小镇现实规则。',
      'characters.yaml': '写法医和嫌疑人。',
      'review_rules.md': '写公平推理检查。',
    },
    rationale: '概念更接近悬疑推理。',
  }));

  assert.equal(strategy.base, 'mystery_thriller');
  assert.equal(strategy.per_section_intent['world.md'], '写小镇现实规则。');
});

test('buildBannedVocabulary removes concept words and selected template tone words', () => {
  const banned = buildBannedVocabulary(
    '侦探小说,主角是法医,在小镇调查连环谋杀',
    { base: 'mystery_thriller', borrow_from: [], invent: [], scope_hint: 'this-book-only', per_section_intent: {}, rationale: '' },
    metas,
  );

  assert.ok(banned.includes('能力'));
  assert.ok(banned.includes('异能'));
  assert.ok(!banned.includes('调查'));
  assert.ok(banned.includes('嫌疑人'));
});

test('strategy and generation prompts do not include template body text', () => {
  const strategyPrompt = buildStrategyPrompt({
    projectName: 'demo',
    concept: '侦探小说,主角是法医',
    metas,
    schema: bookSchema,
  });
  assert.match(strategyPrompt, /available_templates \(metas only, NO content\)/);
  assert.doesNotMatch(strategyPrompt, /主角能力持续带来新问题/);
  assert.doesNotMatch(strategyPrompt, /template_reference/);

  const generationPrompt = buildGenerationPrompt({
    projectName: 'demo',
    concept: '侦探小说,主角是法医',
    section: bookSchema.identityFiles[0]!,
    sectionIntent: '写法医悬疑定位。',
    agentProfile: '# book-setup-editor',
    bannedVocabulary: ['能力', '代价', '异能'],
  });
  assert.match(generationPrompt, /SETUP_GENERATE_PRODUCT/);
  assert.doesNotMatch(generationPrompt, /template_reference/);
  assert.doesNotMatch(generationPrompt, /主角能力持续带来新问题/);
  assert.match(generationPrompt, /能力/);
});
