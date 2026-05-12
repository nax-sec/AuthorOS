import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { identitySetupSections } from '../core/bookSchema.ts';
import { readAgentProfile } from '../core/agentProfiles.ts';
import type { LlmClient } from '../core/llm.ts';
import { AuthorOsError } from '../core/schema.ts';
import { readTemplateFile } from '../core/templates.ts';

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
}): Promise<SetupResult> {
  const concept = opts.concept.trim();
  if (!concept) {
    throw new AuthorOsError('--concept value cannot be empty.');
  }

  const profile = await readAgentProfile(opts.projectDir, setupAgent);

  const results = await Promise.all(setupSections.map(async (section) => {
    const templateContent = await readTemplateFile(opts.template, section.file, { authorRoot: opts.authorDir ?? null });
    const prompt = buildConceptPrompt({
      projectName: opts.projectName,
      concept,
      section,
      templateContent,
      profile,
    });
    const reply = await invokeAgent(opts.llm, `setup ${section.title}`, prompt, {
      temperature: 0.5,
      maxTokens: 2000,
    });
    const content = sanitizeFileBody(reply);
    await writeFile(join(opts.projectDir, section.file), content, 'utf8');
    return {
      file: section.file,
      title: section.title,
      source: 'concept' as const,
      charCount: content.length,
    };
  }));

  return { mode: 'concept', files: results };
}

export async function setupGuided(opts: {
  projectDir: string;
  projectName: string;
  template: string;
  authorDir?: string | null;
  llm: LlmClient;
  ask: AskFn;
  io: { stdout: (m: string) => void };
}): Promise<SetupResult> {
  const profile = await readAgentProfile(opts.projectDir, setupAgent);
  const results: SetupFileResult[] = [];
  const priorSummaries: string[] = [];

  opts.io.stdout([
    '',
    `AuthorOS 建书编辑 Agent 已启动 (book-setup-editor)。`,
    '我会就六个核心文件各问一个问题。你可以直接回答,也可以输入:',
    '  你建议   —— 让我提议',
    '  跳过     —— 用模板默认',
    '  暂定     —— 用模板默认并标记 TBD',
    '',
  ].join('\n'));

  for (const section of setupSections) {
    const templateContent = await readTemplateFile(opts.template, section.file, { authorRoot: opts.authorDir ?? null });

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
      await writeFile(join(opts.projectDir, section.file), templateContent, 'utf8');
      results.push({ file: section.file, title: section.title, source: 'guided-skip', charCount: templateContent.length });
      priorSummaries.push(`${section.title}: 跳过(用模板默认)`);
      opts.io.stdout(`[${section.title}] 跳过,使用模板默认内容。\n`);
      continue;
    }

    if (intent === 'tbd') {
      const tbdContent = annotateAsTbd(templateContent, section);
      await writeFile(join(opts.projectDir, section.file), tbdContent, 'utf8');
      results.push({ file: section.file, title: section.title, source: 'guided-tbd', charCount: tbdContent.length });
      priorSummaries.push(`${section.title}: 暂定`);
      opts.io.stdout(`[${section.title}] 暂定,用模板默认并已标记 TBD。\n`);
      continue;
    }

    const reply = await invokeAgent(opts.llm, `${section.title} generation`, buildGuidedGeneratePrompt({
      projectName: opts.projectName,
      section,
      userAnswer: rawAnswer,
      askingForSuggestion: intent === 'suggest',
      priorSummaries,
      templateContent,
      profile,
    }), { temperature: 0.5, maxTokens: 2000 });

    const content = sanitizeFileBody(reply);
    await writeFile(join(opts.projectDir, section.file), content, 'utf8');
    results.push({ file: section.file, title: section.title, source: 'guided', charCount: content.length });
    priorSummaries.push(`${section.title}: ${summarize(content)}`);
    opts.io.stdout(`[${section.title}] 已写入 ${section.file} (${content.length} 字符)。\n`);
  }

  return { mode: 'guided', files: results };
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

function buildConceptPrompt(args: {
  projectName: string;
  concept: string;
  section: SetupSection;
  templateContent: string;
  profile: string;
}): string {
  return [
    `SETUP_CONCEPT_${args.section.marker}`,
    `project_name: ${args.projectName}`,
    `section: ${args.section.title} (${args.section.file})`,
    `section_purpose: ${args.section.purpose}`,
    '',
    'agent_profile:',
    args.profile.trim(),
    '',
    'template_reference (structure only; do NOT copy verbatim):',
    args.templateContent.trim(),
    '',
    'book_concept (the author\'s actual book idea):',
    args.concept,
    '',
    'task:',
    `Write the content of ${args.section.file} (${args.section.title}) for this book, tailored to the concept above.`,
    '- Keep the same section headings as the template_reference.',
    '- Replace template content with concrete content derived from the book_concept; do NOT copy template defaults if they conflict with the concept.',
    '- Be specific and concrete; avoid generic platitudes.',
    `- ${args.section.file.endsWith('.yaml') ? 'Output valid YAML only.' : 'Output Markdown only.'}`,
    '- No surrounding commentary or code fences.',
  ].join('\n');
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

function buildGuidedGeneratePrompt(args: {
  projectName: string;
  section: SetupSection;
  userAnswer: string;
  askingForSuggestion: boolean;
  priorSummaries: string[];
  templateContent: string;
  profile: string;
}): string {
  const userBlock = args.askingForSuggestion
    ? 'user_input: (the author asked you to propose. No concrete answer provided. Propose content based on project_name and prior_sections.)'
    : `user_input:\n${args.userAnswer}`;

  return [
    `SETUP_GUIDED_GENERATE_${args.section.marker}`,
    `project_name: ${args.projectName}`,
    `section: ${args.section.title} (${args.section.file})`,
    `section_purpose: ${args.section.purpose}`,
    '',
    'agent_profile:',
    args.profile.trim(),
    '',
    'prior_sections (already collected):',
    args.priorSummaries.length > 0 ? args.priorSummaries.join('\n') : '(none)',
    '',
    'template_reference (structure only; do NOT copy verbatim):',
    args.templateContent.trim(),
    '',
    userBlock,
    '',
    'task:',
    `Write the content of ${args.section.file} (${args.section.title}) based on the user_input.`,
    '- Match the template_reference section structure (same headings/keys).',
    '- Fill content with what the user said + reasonable expansion that does not contradict them.',
    `- If user_input is vague, expand it into structured content; do not echo it back verbatim.`,
    `- ${args.section.file.endsWith('.yaml') ? 'Output valid YAML only.' : 'Output Markdown only.'}`,
    '- No surrounding commentary or code fences.',
  ].join('\n');
}

function annotateAsTbd(templateContent: string, section: SetupSection): string {
  const head = section.file.endsWith('.yaml')
    ? `# TBD: ${section.title} 暂定,后续 author setup 或手动编辑后再确认。\n`
    : `> TBD: ${section.title} 暂定,后续 author setup 或手动编辑后再确认。\n\n`;
  return head + templateContent;
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

function summarize(content: string): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  return collapsed.length > 120 ? `${collapsed.slice(0, 120)}…` : collapsed;
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
