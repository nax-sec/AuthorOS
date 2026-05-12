import { mkdir, readdir, writeFile } from 'node:fs/promises';
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

export interface PlanOptions {
  chapter?: number;
  next?: boolean;
  llm?: LlmClient;
  now?: Date;
  write?: boolean;
}

export interface PlanResult {
  chapter: number;
  chapterId: string;
  path: string;
  source: 'model' | 'scaffold';
  generatedAt: string;
  body: string;
  content: string;
  written: boolean;
  contextInputs: string[];
  contextMissing: string[];
}

export interface PlanStatusEntry {
  chapter: number;
  chapterId: string;
  path: string;
}

export interface PlanStatusResult {
  plans: PlanStatusEntry[];
  nextChapter: number;
}

const plannerAgent = 'planner';
const plansDirectory = 'plans';

export async function createChapterPlan(projectDir: string, options: PlanOptions): Promise<PlanResult> {
  const chapter = await resolveChapterNumber(projectDir, options);
  const chapterId = formatChapterNumber(chapter);
  const now = (options.now ?? new Date()).toISOString();

  const docs = await assembleAgentContext(projectDir, plannerAgent, { chapter });
  assertNoRequiredMissing(plannerAgent, docs);

  const profile = await readAgentProfile(projectDir, plannerAgent);
  const body = options.llm
    ? await generatePlanWithModel(options.llm, chapter, profile, docs)
    : renderPlanScaffold(chapter);

  const source: 'model' | 'scaffold' = options.llm ? 'model' : 'scaffold';
  const content = wrapPlanContent(chapter, body, source, now);
  const path = join(plansDirectory, `${chapterId}.md`);

  let written = false;
  if (options.write) {
    await mkdir(join(projectDir, plansDirectory), { recursive: true });
    await writeFile(join(projectDir, path), content, 'utf8');
    written = true;
  }

  return {
    chapter,
    chapterId,
    path,
    source,
    generatedAt: now,
    body,
    content,
    written,
    contextInputs: docs.filter((doc) => doc.status === 'present').map((doc) => doc.resolvedPath ?? doc.declaredPath),
    contextMissing: docs.filter((doc) => doc.status === 'optional-missing').map((doc) => doc.resolvedPath ?? doc.declaredPath),
  };
}

export async function getPlanStatus(projectDir: string): Promise<PlanStatusResult> {
  const entries = await listExistingPlans(projectDir);
  const maxChapter = entries.reduce((acc, entry) => Math.max(acc, entry.chapter), 0);
  return {
    plans: entries,
    nextChapter: maxChapter + 1,
  };
}

export function renderPlanResult(result: PlanResult): string {
  const lines = [
    `AuthorOS plan: chapter ${result.chapter}`,
    `path: ${result.path}${result.written ? '' : ' (preview, use --write to save)'}`,
    `source: ${result.source}`,
    `generated: ${result.generatedAt}`,
    'inputs:',
    ...(result.contextInputs.length > 0
      ? result.contextInputs.map((path) => `  - ${path}`)
      : ['  - (none)']),
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

export function renderPlanStatus(result: PlanStatusResult): string {
  const lines = ['AuthorOS plan status'];
  if (result.plans.length === 0) {
    lines.push('no chapter plans yet');
  } else {
    for (const entry of result.plans) {
      lines.push(`  ${entry.path}  (chapter ${entry.chapter})`);
    }
  }
  lines.push(`next: ${result.nextChapter}`);
  lines.push('');
  return lines.join('\n');
}

async function resolveChapterNumber(projectDir: string, options: PlanOptions): Promise<number> {
  if (options.chapter !== undefined) {
    if (!Number.isInteger(options.chapter) || options.chapter < 1) {
      throw new AuthorOsError('--chapter must be a positive integer.');
    }
    return options.chapter;
  }

  if (options.next === true) {
    const status = await getPlanStatus(projectDir);
    return status.nextChapter;
  }

  throw new AuthorOsError('author plan requires --chapter <N> or --next.');
}

async function listExistingPlans(projectDir: string): Promise<PlanStatusEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(join(projectDir, plansDirectory));
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }

  const planEntries: PlanStatusEntry[] = [];
  for (const entry of entries) {
    const match = entry.match(/^(\d{4})\.md$/);
    if (!match) continue;
    const chapter = Number.parseInt(match[1], 10);
    planEntries.push({
      chapter,
      chapterId: match[1],
      path: `${plansDirectory}/${entry}`,
    });
  }

  planEntries.sort((a, b) => a.chapter - b.chapter);
  return planEntries;
}

async function generatePlanWithModel(
  llm: LlmClient,
  chapter: number,
  profile: string,
  docs: readonly ContextDoc[],
): Promise<string> {
  const prompt = [
    'PLAN_CHAPTER',
    `chapter: ${chapter}`,
    '',
    'agent_profile:',
    profile.trim(),
    '',
    'agent_context:',
    renderContextBlock(docs),
    '',
    'task:',
    `Plan chapter ${chapter}. Output Markdown only with these exact section headings, in order:`,
    '## 章节目标',
    '## 主要冲突',
    '## 爽点',
    '## 章尾钩子',
    '## 信息释放',
    '## 人物变化',
    '## 伏笔触点',
    '## 与作者长期规划的对照',
    '',
    'Constraints:',
    '- Each section should be terse and specific to this chapter, not generic.',
    '- 伏笔触点 must use sub-bullets labeled "新增 / 推进 / 回收".',
    '- Do not add other headings or commentary before/after these sections.',
    '- Respect canon and the precedence: canon > author profile > product positioning > the outline.',
  ].join('\n');

  let reply: string;
  try {
    reply = await llm.generate(prompt, { temperature: 0.5, maxTokens: 4000 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AuthorOsError(`Plan model generation failed. ${detail}`);
  }

  const trimmed = reply.trim();
  if (!trimmed) {
    throw new AuthorOsError('Plan model returned empty content.');
  }
  return trimmed;
}

function renderPlanScaffold(chapter: number): string {
  return [
    '## 章节目标',
    '',
    '(待填写:本章要推进的主线/日常线目标)',
    '',
    '## 主要冲突',
    '',
    '(待填写:本章主要矛盾,主角面临的压迫)',
    '',
    '## 爽点',
    '',
    '(待填写:能力新用法 / 反制 / 阶段胜利)',
    '',
    '## 章尾钩子',
    '',
    '(待填写:情绪、信息或局势钩子)',
    '',
    '## 信息释放',
    '',
    '(待填写:本章透露的设定 / 真相)',
    '',
    '## 人物变化',
    '',
    '(待填写:主角和关键配角的状态变化)',
    '',
    '## 伏笔触点',
    '',
    '- 新增:',
    '- 推进:',
    '- 回收:',
    '',
    '## 与作者长期规划的对照',
    '',
    `(待填写:章节 ${chapter} 如何服务主线大纲下一阶段)`,
  ].join('\n');
}

function wrapPlanContent(chapter: number, body: string, source: 'model' | 'scaffold', generatedAt: string): string {
  return [
    `# 章节 ${chapter} 计划`,
    '',
    `> generated: ${generatedAt}`,
    '> agent: planner',
    `> source: ${source}`,
    '',
    body.trim(),
    '',
  ].join('\n');
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
