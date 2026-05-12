import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bookSchema } from '../core/bookSchema.ts';
import { identitySetupSections } from '../core/bookSchema.ts';
import { readAgentProfile } from '../core/agentProfiles.ts';
import type { LlmClient } from '../core/llm.ts';
import { AuthorOsError } from '../core/schema.ts';
import {
  buildBannedVocabulary,
  buildGenerationPrompt,
  createSetupStrategy,
  loadTemplateMetas,
  type SetupStrategy,
  type TemplateMeta,
} from './setup-strategy.ts';
import { validateAndRepairBookFiles } from './setup-validate.ts';
import { runSetupDistill, type SetupDistillResult } from './setup-distill.ts';

export interface SetupSection {
  file: string;
  title: string;
  marker: string;
  purpose: string;
}

export const setupSections: readonly SetupSection[] = identitySetupSections();

export interface SetupFileResult {
  file: string;
  title: string;
  source: 'concept' | 'guided' | 'guided-skip' | 'guided-tbd';
  charCount: number;
}

export interface SetupResult {
  mode: 'concept' | 'guided';
  files: SetupFileResult[];
  distill?: SetupDistillResult;
}

export type AskFn = (prompt: string) => Promise<string>;

const setupAgent = 'book-setup-editor';

export async function setupFromConcept(opts: {
  projectDir: string;
  projectName: string;
  template: string;
  authorDir?: string | null;
  concept: string;
  llm: LlmClient;
  ask?: AskFn;
  io?: { stdout: (m: string) => void };
  strategyConfirm?: boolean;
  noDistill?: boolean;
}): Promise<SetupResult> {
  const concept = opts.concept.trim();
  if (!concept) {
    throw new AuthorOsError('--concept value cannot be empty.');
  }

  return await generateIdentityFiles({
    projectDir: opts.projectDir,
    projectName: opts.projectName,
    authorDir: opts.authorDir ?? null,
    concept,
    llm: opts.llm,
    mode: 'concept',
    source: 'concept',
    ask: opts.ask,
    io: opts.io,
    strategyConfirm: opts.strategyConfirm === true,
    noDistill: opts.noDistill === true,
  });
}

export async function setupGuided(opts: {
  projectDir: string;
  projectName: string;
  template: string;
  authorDir?: string | null;
  llm: LlmClient;
  ask: AskFn;
  io: { stdout: (m: string) => void };
  noDistill?: boolean;
}): Promise<SetupResult> {
  const profile = await readAgentProfile(opts.projectDir, setupAgent);
  const priorSummaries: string[] = [];

  opts.io.stdout([
    '',
    `AuthorOS 建书编辑 Agent 已启动 (book-setup-editor)。`,
    '我会就六个核心文件各问一个问题,再统一做 Strategy Pass 与生成。',
    '你可以直接回答,也可以输入:',
    '  你建议   —— 让我提议',
    '  跳过     —— 本段暂不提供额外方向',
    '  暂定     —— 本段只记为待定',
    '',
  ].join('\n'));

  for (const section of setupSections) {
    const question = await invokeAgent(opts.llm, `${section.title} question`, buildQuestionPrompt({
      projectName: opts.projectName,
      section,
      priorSummaries,
      profile,
    }), { temperature: 0.4, maxTokens: 400 });

    opts.io.stdout(`\n--- ${section.title} (${section.file}) ---\n${question.trim()}\n`);
    const rawAnswer = (await opts.ask('> ')).trim();
    const intent = classifyAnswer(rawAnswer);

    if (intent === 'skip') {
      priorSummaries.push(`${section.title}: 用户跳过,不增加额外方向。`);
      opts.io.stdout(`[${section.title}] 已记录为跳过。\n`);
      continue;
    }

    if (intent === 'tbd') {
      priorSummaries.push(`${section.title}: 用户暂定,后续生成需保守留白。`);
      opts.io.stdout(`[${section.title}] 已记录为暂定。\n`);
      continue;
    }

    if (intent === 'suggest') {
      priorSummaries.push(`${section.title}: 用户要求 book-setup-editor 根据项目名和前文建议。`);
      opts.io.stdout(`[${section.title}] 已记录为由 Agent 建议。\n`);
      continue;
    }

    priorSummaries.push(`${section.title}: ${rawAnswer}`);
    opts.io.stdout(`[${section.title}] 已记录回答。\n`);
  }

  const guidedConcept = [
    `project_name: ${opts.projectName}`,
    '',
    'guided_answers:',
    ...priorSummaries.map((summary) => `- ${summary}`),
  ].join('\n');

  return await generateIdentityFiles({
    projectDir: opts.projectDir,
    projectName: opts.projectName,
    authorDir: opts.authorDir ?? null,
    concept: guidedConcept,
    llm: opts.llm,
    mode: 'guided',
    source: 'guided',
    profile,
    noDistill: opts.noDistill === true,
  });
}

export function renderSetupResult(result: SetupResult): string {
  const lines = [
    `AuthorOS setup: ${result.mode} mode complete`,
    '',
    'Files written:',
  ];
  for (const file of result.files) {
    const tag = file.source === 'guided-skip'
      ? ' (skipped — template default)'
      : file.source === 'guided-tbd'
        ? ' (TBD — template default + marker)'
        : '';
    lines.push(`  ${file.file}  (${file.charCount} chars)${tag}`);
  }
  if (result.distill) {
    lines.push('');
    if (result.distill.shouldCreate) {
      lines.push(`Distill: proposed candidate template "${result.distill.key}". Promote with: author template promote ${result.distill.key}`);
    } else {
      lines.push(`Distill: no new template needed (${result.distill.reason})`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

type AnswerIntent = 'skip' | 'tbd' | 'suggest' | 'concrete';

function classifyAnswer(answer: string): AnswerIntent {
  const normalized = answer.trim().toLowerCase();
  if (!normalized) return 'skip';
  if (['跳过', 'skip', '后面再说', '以后再说', '先放着'].includes(normalized)) return 'skip';
  if (['暂定', 'tbd', '待定'].includes(normalized)) return 'tbd';
  if (['你建议', '建议', '给建议', 'suggest', '你先给'].includes(normalized)) return 'suggest';
  return 'concrete';
}

function buildQuestionPrompt(args: {
  projectName: string;
  section: SetupSection;
  priorSummaries: string[];
  profile: string;
}): string {
  return [
    `SETUP_GUIDED_QUESTION_${args.section.marker}`,
    `project_name: ${args.projectName}`,
    `section: ${args.section.title} (${args.section.file})`,
    `section_purpose: ${args.section.purpose}`,
    '',
    'agent_profile:',
    args.profile.trim(),
    '',
    'prior_sections (already collected, may be empty):',
    args.priorSummaries.length > 0 ? args.priorSummaries.join('\n') : '(none)',
    '',
    'task:',
    `Ask ONE focused Chinese question that helps the author describe their ${args.section.title} for this book.`,
    '- Keep it concrete and inviting, not abstract.',
    '- Reference prior_sections if they constrain this section.',
    '- One question only. Output the question text only — no preamble, no explanation.',
  ].join('\n');
}

function sanitizeFileBody(reply: string): string {
  let text = reply.trim();
  // Strip ```markdown / ```yaml / ``` fences if model wrapped output.
  const fenceMatch = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  return text + '\n';
}

async function invokeAgent(
  llm: LlmClient,
  label: string,
  prompt: string,
  options: { temperature: number; maxTokens: number },
): Promise<string> {
  let reply: string;
  try {
    reply = await llm.generate(prompt, options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AuthorOsError(`Setup ${label} model generation failed. ${detail}`);
  }
  const trimmed = reply.trim();
  if (!trimmed) {
    throw new AuthorOsError(`Setup ${label} model returned empty content.`);
  }
  return trimmed;
}

async function generateIdentityFiles(args: {
  projectDir: string;
  projectName: string;
  authorDir: string | null;
  concept: string;
  llm: LlmClient;
  mode: SetupResult['mode'];
  source: SetupFileResult['source'];
  profile?: string;
  ask?: AskFn;
  io?: { stdout: (m: string) => void };
  strategyConfirm?: boolean;
  noDistill?: boolean;
}): Promise<SetupResult> {
  const profile = args.profile ?? await readAgentProfile(args.projectDir, setupAgent);
  const metas = await loadTemplateMetas(args.authorDir);
  const strategy = await createSetupStrategy({
    projectName: args.projectName,
    concept: args.concept,
    metas,
    llm: args.llm,
  });

  if (args.strategyConfirm) {
    if (!args.ask || !args.io) {
      throw new AuthorOsError('--strategy-confirm requires interactive ask/io support.');
    }
    args.io.stdout(`\nSetup strategy:\n${JSON.stringify(strategy, null, 2)}\n`);
    const answer = (await args.ask('继续生成? (y/n) ')).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      throw new AuthorOsError('setup strategy cancelled by user.');
    }
  }

  await writeStrategyFile(args.projectDir, strategy);
  const bannedVocabulary = buildBannedVocabulary(args.concept, strategy, metas);
  const results = await Promise.all(bookSchema.identityFiles.map(async (section) => {
    const reply = await invokeAgent(args.llm, `setup ${section.title}`, buildGenerationPrompt({
      projectName: args.projectName,
      concept: args.concept,
      section,
      sectionIntent: strategy.per_section_intent[section.file] ?? '',
      agentProfile: profile,
      bannedVocabulary,
    }), {
      temperature: 0.5,
      maxTokens: 2200,
    });

    const content = sanitizeFileBody(reply);
    await writeFile(join(args.projectDir, section.file), content, 'utf8');
    return {
      file: section.file,
      title: section.title,
      source: args.source,
      charCount: content.length,
    };
  }));

  await validateAndRepairBookFiles({
    bookDir: args.projectDir,
    projectName: args.projectName,
    files: bookSchema.identityFiles.map((entry) => entry.file),
    llm: args.llm,
  });

  const distill = args.noDistill ? undefined : await runSetupDistill({
    bookDir: args.projectDir,
    authorDir: args.authorDir,
    projectName: args.projectName,
    concept: args.concept,
    llm: args.llm,
  });

  return { mode: args.mode, files: results, distill };
}

async function writeStrategyFile(projectDir: string, strategy: SetupStrategy): Promise<void> {
  const authorosDir = join(projectDir, '.authoros');
  await mkdir(authorosDir, { recursive: true });
  await writeFile(join(authorosDir, 'strategy.json'), `${JSON.stringify(strategy, null, 2)}\n`, 'utf8');
}
