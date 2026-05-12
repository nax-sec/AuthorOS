import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  assembleAgentContext,
  assertNoRequiredMissing,
  renderContextBlock,
  type ContextDoc,
} from '../core/contextAssembly.ts';
import { readAgentProfile } from '../core/agentProfiles.ts';
import type { LlmClient } from '../core/llm.ts';
import { formatChapterNumber } from '../core/paths.ts';
import { AuthorOsError } from '../core/schema.ts';

export interface DecideOptions {
  chapter: number;
  llm?: LlmClient;
  now?: Date;
  write?: boolean;
}

export interface DecideResult {
  chapter: number;
  chapterId: string;
  path: string;
  source: 'model' | 'scaffold';
  generatedAt: string;
  content: string;
  body: string;
  written: boolean;
  contextInputs: string[];
  contextMissing: string[];
  feedbackAvailable: boolean;
}

const deciderAgent = 'decider';
const decisionsDirectory = 'decisions';

export async function createChapterDecision(projectDir: string, options: DecideOptions): Promise<DecideResult> {
  const chapter = validateChapter(options.chapter);
  const chapterId = formatChapterNumber(chapter);
  const now = (options.now ?? new Date()).toISOString();

  const docs = await assembleAgentContext(projectDir, deciderAgent, { chapter });
  assertNoRequiredMissing(deciderAgent, docs);

  const feedbackAvailable = docs.some(
    (doc) => doc.status === 'present' && doc.resolvedPath === `feedback/${chapterId}.analysis.md`,
  );

  const profile = await readAgentProfile(projectDir, deciderAgent);
  const body = options.llm
    ? await generateDecisionWithModel(options.llm, chapter, profile, docs, feedbackAvailable)
    : renderDecisionScaffold(feedbackAvailable);

  const source: 'model' | 'scaffold' = options.llm ? 'model' : 'scaffold';
  const content = wrapDecisionContent(chapter, body, source, now, feedbackAvailable);
  const path = `${decisionsDirectory}/${chapterId}.md`;

  let written = false;
  if (options.write) {
    await mkdir(join(projectDir, decisionsDirectory), { recursive: true });
    await writeFile(join(projectDir, path), content, 'utf8');
    written = true;
  }

  return {
    chapter,
    chapterId,
    path,
    source,
    generatedAt: now,
    content,
    body,
    written,
    contextInputs: docs.filter((doc) => doc.status === 'present').map((doc) => doc.resolvedPath ?? doc.declaredPath),
    contextMissing: docs.filter((doc) => doc.status === 'optional-missing').map((doc) => doc.resolvedPath ?? doc.declaredPath),
    feedbackAvailable,
  };
}

export function renderDecideResult(result: DecideResult): string {
  const lines = [
    `AuthorOS decide: chapter ${result.chapter}`,
    `path: ${result.path}${result.written ? '' : ' (preview, use --write to save)'}`,
    `source: ${result.source}`,
    `generated: ${result.generatedAt}`,
    `feedback: ${result.feedbackAvailable ? 'present (20% weight active)' : 'absent (20% weight skipped, not redistributed)'}`,
    'inputs:',
    ...result.contextInputs.map((path) => `  - ${path}`),
  ];
  if (result.contextMissing.length > 0) {
    lines.push('optional inputs missing:');
    for (const path of result.contextMissing) {
      lines.push(`  - ${path}`);
    }
  }
  lines.push('');
  lines.push(result.content.trimEnd());
  lines.push('');
  return lines.join('\n');
}

async function generateDecisionWithModel(
  llm: LlmClient,
  chapter: number,
  profile: string,
  docs: readonly ContextDoc[],
  feedbackAvailable: boolean,
): Promise<string> {
  const feedbackRule = feedbackAvailable
    ? 'Real reader feedback is present at feedback/<chapter>.analysis.md. Apply its configured weight.'
    : 'Real reader feedback is ABSENT. Mark its line as "未参与。本章暂无真实反馈,不进行模拟补权。" Do NOT redistribute its weight. Do NOT normalize the remaining weights to 100%.';

  const prompt = [
    'DECIDE',
    `chapter: ${chapter}`,
    `feedback_available: ${feedbackAvailable ? 'yes' : 'no'}`,
    '',
    'agent_profile:',
    profile.trim(),
    '',
    'agent_context:',
    renderContextBlock(docs),
    '',
    'rules:',
    '- Use the weights configured in .authoros/weights.yaml. Default: author_long_term_plan 40 / internal_review 30 / simulated_readers 10 / reader_feedback 20.',
    `- ${feedbackRule}`,
    '- Each "决策依据" sub-section must briefly cite what it took from that source.',
    '- Be terse and specific; avoid generic phrasing.',
    '',
    'task:',
    'Produce the chapter creative decision. Output Markdown with EXACTLY these sections in order:',
    '## 决策摘要',
    '## 决策依据',
    '### 作者长期规划',
    '### 内部评审',
    '### 模拟读者',
    '### 真实读者反馈',
    '## 采纳的反馈',
    '## 不采纳及原因',
    '## 下一章策略',
    '## 需要更新的记忆',
    '## 风险提醒',
  ].join('\n');

  let reply: string;
  try {
    reply = await llm.generate(prompt, { temperature: 0.35, maxTokens: 2400 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AuthorOsError(`Decide model generation failed. ${detail}`);
  }
  const trimmed = reply.trim();
  if (!trimmed) {
    throw new AuthorOsError('Decide model returned empty content.');
  }
  return trimmed;
}

function renderDecisionScaffold(feedbackAvailable: boolean): string {
  const feedbackBody = feedbackAvailable
    ? '(待 decider 综合真实反馈分析,权重默认 20%)'
    : '未参与。本章暂无真实反馈,不进行模拟补权。';

  return [
    '## 决策摘要',
    '(待 decider 输出本章总体走向判断)',
    '',
    '## 决策依据',
    '',
    '### 作者长期规划',
    '(待 decider 引用 author.md / outline.md 当前阶段目标,权重默认 40%)',
    '',
    '### 内部评审',
    '(待 decider 综合 4 顾问 + editor 决议,权重默认 30%)',
    '',
    '### 模拟读者',
    '(待 decider 综合 5 类读者反应,权重默认 10%)',
    '',
    '### 真实读者反馈',
    feedbackBody,
    '',
    '## 采纳的反馈',
    '- (待 decider 列出本章后采纳的修改方向)',
    '',
    '## 不采纳及原因',
    '- (待 decider 列出不采纳的反馈及理由)',
    '',
    '## 下一章策略',
    '- (待 decider 给出下章写作要点)',
    '',
    '## 需要更新的记忆',
    '- canon:',
    '- foreshadowing:',
    '- plot_threads:',
    '- character_state:',
    '- style:',
    '',
    '## 风险提醒',
    '- (待 decider 标记后续章节需要警惕的风险)',
  ].join('\n');
}

function wrapDecisionContent(
  chapter: number,
  body: string,
  source: 'model' | 'scaffold',
  now: string,
  feedbackAvailable: boolean,
): string {
  return [
    `# 第 ${chapter} 章后创作决策`,
    '',
    `> generated: ${now}`,
    '> agent: decider',
    `> source: ${source}`,
    `> feedback_available: ${feedbackAvailable ? 'yes' : 'no'}`,
    '',
    body.trim(),
    '',
  ].join('\n');
}

function validateChapter(chapter: number): number {
  if (!Number.isInteger(chapter) || chapter < 1) {
    throw new AuthorOsError('--chapter must be a positive integer.');
  }
  return chapter;
}
