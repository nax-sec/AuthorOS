import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
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
import { computeChapterLengthSpec, readProjectConfig, type ChapterLengthSpec as BaseChapterLengthSpec } from '../core/projectConfig.ts';
import { AuthorOsError } from '../core/schema.ts';

export interface ReviseOptions {
  chapter: number;
  llm?: LlmClient;
  now?: Date;
  write?: boolean;
  instruction?: string;
}

export interface ReviseResult {
  chapter: number;
  chapterId: string;
  chapterPath: string;
  draftBackupPath: string | null;
  changed: boolean;
  source: 'model' | 'scaffold';
  generatedAt: string;
  rationale: string;
  originalCharCount: number;
  revisedCharCount: number | null;
  previewContent: string | null;
  written: boolean;
  contextInputs: string[];
}

const chiefWriterAgent = 'chief-writer';
const chaptersDirectory = 'chapters';

export async function reviseChapter(projectDir: string, options: ReviseOptions): Promise<ReviseResult> {
  const chapter = validateChapter(options.chapter);
  const chapterId = formatChapterNumber(chapter);
  const now = (options.now ?? new Date()).toISOString();

  const chapterPath = `${chaptersDirectory}/${chapterId}.md`;
  const draftBackupPath = `${chaptersDirectory}/${chapterId}.draft.md`;

  const originalContent = await readChapterFile(projectDir, chapterPath);
  const originalBody = stripHeader(originalContent);
  const internalReview = await readReviewFile(projectDir, `reviews/${chapterId}.internal.md`, true);
  const readerSimReview = await readReviewFile(projectDir, `reviews/${chapterId}.reader-sim.md`, false);

  const docs = await assembleAgentContext(projectDir, chiefWriterAgent, { chapter });
  assertNoRequiredMissing(chiefWriterAgent, docs);

  const profile = await readAgentProfile(projectDir, chiefWriterAgent);
  const config = await readProjectConfig(projectDir);
  const lengthSpec = buildLengthSpec(config, originalBody);
  const maxTokens = lengthSpec.maxTokens;

  const decision = options.llm
    ? await invokeReviseModel(options.llm, {
        chapter, profile, docs,
        originalBody,
        internalReview: internalReview!,
        readerSimReview,
        lengthSpec,
        maxTokens,
        instruction: normalizedInstruction(options.instruction),
      })
    : { changed: false, rationale: '(scaffold mode: no revision performed)', newBody: null };

  const source: 'model' | 'scaffold' = options.llm ? 'model' : 'scaffold';

  let written = false;
  let revisedCharCount: number | null = null;
  let previewContent: string | null = null;
  let actualBackupPath: string | null = null;

  if (decision.changed && decision.newBody) {
    revisedCharCount = countChineseChars(decision.newBody);
    const newContent = wrapRevisedContent(chapter, decision.newBody, source, now, decision.rationale);
    previewContent = newContent;
    if (options.write) {
      const backupExists = await fileExists(join(projectDir, draftBackupPath));
      if (!backupExists) {
        await mkdir(join(projectDir, chaptersDirectory), { recursive: true });
        await copyFile(join(projectDir, chapterPath), join(projectDir, draftBackupPath));
      }
      actualBackupPath = draftBackupPath;
      await writeFile(join(projectDir, chapterPath), newContent, 'utf8');
      written = true;
    } else {
      const backupExists = await fileExists(join(projectDir, draftBackupPath));
      actualBackupPath = backupExists ? draftBackupPath : null;
    }
  } else {
    const backupExists = await fileExists(join(projectDir, draftBackupPath));
    actualBackupPath = backupExists ? draftBackupPath : null;
  }

  return {
    chapter,
    chapterId,
    chapterPath,
    draftBackupPath: actualBackupPath,
    changed: decision.changed,
    source,
    generatedAt: now,
    rationale: decision.rationale,
    originalCharCount: countChineseChars(originalBody),
    revisedCharCount,
    previewContent,
    written,
    contextInputs: docs.filter((doc) => doc.status === 'present').map((doc) => doc.resolvedPath ?? doc.declaredPath),
  };
}

export function renderReviseResult(result: ReviseResult): string {
  const lines = [
    `AuthorOS revise: chapter ${result.chapter}`,
    `path: ${result.chapterPath}${result.written ? '' : ' (preview, use --write to apply)'}`,
    `source: ${result.source}`,
    `generated: ${result.generatedAt}`,
    `changed: ${result.changed ? 'yes' : 'no'}`,
  ];

  if (result.changed) {
    lines.push(`length: original ${result.originalCharCount} chars -> revised ${result.revisedCharCount} chars`);
    if (result.draftBackupPath) {
      lines.push(`draft backup: ${result.draftBackupPath}${result.written ? '' : ' (will be created on --write)'}`);
    }
  } else {
    lines.push(`length: ${result.originalCharCount} chars (unchanged)`);
  }

  lines.push('');
  lines.push('rationale:');
  lines.push(result.rationale.trim());
  lines.push('');
  return lines.join('\n');
}

interface ChapterLengthSpec extends BaseChapterLengthSpec {
  currentChars: number;
  status: 'within_range' | 'over' | 'under';
  deviationPercent: number;
}

interface InvokeArgs {
  chapter: number;
  profile: string;
  docs: readonly ContextDoc[];
  originalBody: string;
  internalReview: string;
  readerSimReview: string | null;
  lengthSpec: ChapterLengthSpec;
  maxTokens: number;
  instruction: string | null;
}

interface ReviseDecision {
  changed: boolean;
  rationale: string;
  newBody: string | null;
}

async function invokeReviseModel(llm: LlmClient, args: InvokeArgs): Promise<ReviseDecision> {
  const len = args.lengthSpec;
  const prompt = [
    'REVISE_CHAPTER',
    `chapter: ${args.chapter}`,
    '',
    'agent_profile:',
    args.profile.trim(),
    '',
    'role for this call:',
    'You wrote this chapter as chief-writer. Internal review + simulated readers have weighed in.',
    args.instruction
      ? 'A revision_directive from the author console is present. Follow it as the trigger for revision.'
      : 'As the author, judge each feedback item yourself. You decide if any text changes are needed.',
    '',
    ...revisionDirectiveLines(args.instruction),
    'length_state:',
    `  target_chinese_chars: ${len.target}`,
    `  acceptable_range: ${len.minChars} - ${len.maxChars} (floor ${len.floorPercent}% / ceiling ${len.ceilingPercent}% of target)`,
    `  current_chinese_chars: ${len.currentChars}`,
    `  status: ${len.status.toUpperCase()}${len.status === 'within_range' ? '' : ` (${len.deviationPercent > 0 ? 'over' : 'under'} by ${Math.abs(len.deviationPercent)}%)`}`,
    '',
    'baseline constraints:',
    '- Only address concrete BLOCKING risks or specific 已采纳 items that need text edits.',
    '- Do not add new plot beats, character moves, or canon decisions absent from the draft.',
    '- Do not redirect the chapter or change its ending if the ending is intact.',
    args.instruction
      ? '- If revision_directive is present, you MUST revise the chapter to comply with it.'
      : '- If review only flags style/craft preferences with no blocking risk AND length_state is WITHIN_RANGE, default to NO revision.',
    '',
    'length-conditional rules:',
    ...lengthHandlingLines(len),
    '',
    'agent_context:',
    renderContextBlock(args.docs),
    '',
    'original_chapter:',
    args.originalBody.trim(),
    '',
    'internal_review:',
    args.internalReview.trim(),
    '',
    args.readerSimReview
      ? `reader_sim_review:\n${args.readerSimReview.trim()}`
      : 'reader_sim_review: (not available)',
    '',
    'output_format:',
    args.instruction ? 'Line 1 MUST be exactly:' : 'Line 1 MUST be exactly one of:',
    ...(args.instruction
      ? ['  REVISION_NEEDED: yes']
      : ['  REVISION_NEEDED: no', '  REVISION_NEEDED: yes']),
    '',
    'If "no", then next lines are a "rationale:" section explaining briefly why every review item is non-blocking or already handled AND length is within range.',
    '',
    'If "yes", then:',
    '  rationale:',
    '  <bullet list of what you will change and why; tie each bullet to a specific review item or to the length constraint>',
    '  ---',
    '  <full revised chapter prose in Markdown; replaces the original entirely>',
  ].join('\n');

  let reply: string;
  try {
    reply = await llm.generate(prompt, { temperature: 0.4, maxTokens: args.maxTokens });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AuthorOsError(`Revise model generation failed. ${detail}`);
  }

  return parseReviseReply(reply);
}

function revisionDirectiveLines(instruction: string | null): string[] {
  if (!instruction) return [];
  return [
    'revision_directive (override from author console):',
    instruction,
    '',
    'If revision_directive is present, you MUST revise the chapter to comply with it.',
    'Read internal_review only as supplementary context, not as the trigger.',
    '',
  ];
}

function buildLengthSpec(config: Parameters<typeof computeChapterLengthSpec>[0], body: string): ChapterLengthSpec {
  const base = computeChapterLengthSpec(config);
  const currentChars = countChineseChars(body);

  let status: 'within_range' | 'over' | 'under';
  if (currentChars > base.maxChars) status = 'over';
  else if (currentChars < base.minChars) status = 'under';
  else status = 'within_range';

  const deviationPercent = Math.round(((currentChars - base.target) / base.target) * 100);

  return { ...base, currentChars, status, deviationPercent };
}

function lengthHandlingLines(len: ChapterLengthSpec): string[] {
  if (len.status === 'over') {
    return [
      '- length_state.status is OVER. This is by itself a reason to set REVISION_NEEDED: yes, even if review has no blocking items.',
      '- You MAY relax the ≥80% verbatim constraint specifically to compress unnecessary description, atmosphere, repetitive phrasing, or transitional padding.',
      '- Preserve these intact (do NOT compress): plot beats, character actions, key dialogue, the chapter-end hook, any review-采纳 changes you also need to land.',
      '- Compress these first: scene-setting paragraphs, atmosphere/weather/setting filler, internal monologue beyond what plot requires, redundant restatements.',
      '- Tighten at the sentence level (cut adjectives, fuse short sentences, drop dead-weight clauses); avoid deleting whole paragraphs unless they are pure filler.',
      '- If a review item still requires adding content, offset it by compressing elsewhere; net length must land inside acceptable_range.',
      `- Final length must be inside ${len.minChars} - ${len.maxChars}; do not exceed acceptable_range. Use overall judgment about which sections truly carry the chapter.`,
    ];
  }
  if (len.status === 'under') {
    return [
      '- length_state.status is UNDER. If you are revising for review reasons anyway, you may also expand within the existing structure to reach acceptable_range; expansions must serve review-采纳 items, not invent new plot.',
      '- Keep ≥80% verbatim where possible; expand by enriching existing beats rather than adding new ones.',
      '- If you decide REVISION_NEEDED: no, briefly note in rationale whether the under-length is intentional pacing or an oversight.',
    ];
  }
  return [
    '- length_state.status is WITHIN_RANGE.',
    '- Keep ≥80% of the original prose verbatim. This is NOT a rewrite.',
    '- Any addition should be balanced or minimal so length stays inside acceptable_range.',
  ];
}

function parseReviseReply(reply: string): ReviseDecision {
  const trimmed = reply.trim();
  if (!trimmed) {
    throw new AuthorOsError('Revise model returned empty content.');
  }

  const firstNewline = trimmed.indexOf('\n');
  const firstLine = firstNewline >= 0 ? trimmed.slice(0, firstNewline).trim() : trimmed.trim();
  const rest = firstNewline >= 0 ? trimmed.slice(firstNewline + 1).trim() : '';

  const yesMatch = /^REVISION_NEEDED\s*:\s*yes\b/i.test(firstLine);
  const noMatch = /^REVISION_NEEDED\s*:\s*no\b/i.test(firstLine);

  if (noMatch) {
    const rationale = stripRationaleLabel(rest);
    return { changed: false, rationale: rationale || '(no rationale provided)', newBody: null };
  }

  if (yesMatch) {
    const separatorMatch = rest.split(/^---\s*$/m);
    if (separatorMatch.length < 2) {
      throw new AuthorOsError(
        'Revise model marked revision yes but did not include "---" separator between rationale and revised prose.',
      );
    }
    const rationale = stripRationaleLabel(separatorMatch[0]);
    const newBody = separatorMatch.slice(1).join('\n---\n').trim();
    if (!newBody) {
      throw new AuthorOsError('Revise model marked revision yes but produced empty revised prose.');
    }
    return { changed: true, rationale: rationale || '(no rationale provided)', newBody };
  }

  throw new AuthorOsError(
    `Revise model output did not start with "REVISION_NEEDED: yes|no". Got first line: ${firstLine.slice(0, 120)}`,
  );
}

function stripRationaleLabel(text: string): string {
  return text.replace(/^\s*rationale\s*:\s*\n?/i, '').trim();
}

async function readChapterFile(projectDir: string, relativePath: string): Promise<string> {
  try {
    return await readFile(join(projectDir, relativePath), 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new AuthorOsError(
        `Chapter draft missing at ${relativePath}. Run author write first.`,
      );
    }
    throw error;
  }
}

async function readReviewFile(
  projectDir: string,
  relativePath: string,
  required: boolean,
): Promise<string | null> {
  try {
    return await readFile(join(projectDir, relativePath), 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      if (required) {
        throw new AuthorOsError(
          `Review missing at ${relativePath}. Run author review --mode internal first.`,
        );
      }
      return null;
    }
    throw error;
  }
}

function stripHeader(content: string): string {
  const match = content.match(/^# 章节 \d+[\s\S]*?\n\n((?:.|\n)*)$/m);
  if (!match) return content.trim();

  const rest = match[1];
  // remove the leading blockquote metadata block ("> ..." lines)
  const lines = rest.split(/\n/);
  let firstBodyLineIndex = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.startsWith('>') || line === '') {
      firstBodyLineIndex = i + 1;
    } else {
      break;
    }
  }
  return lines.slice(firstBodyLineIndex).join('\n').trim();
}

function wrapRevisedContent(
  chapter: number,
  body: string,
  source: 'model' | 'scaffold',
  generatedAt: string,
  rationale: string,
): string {
  return [
    `# 章节 ${chapter}`,
    '',
    `> generated: ${generatedAt}`,
    '> agent: chief-writer (revise)',
    `> source: ${source}`,
    `> rationale_summary: ${oneLine(rationale).slice(0, 200)}`,
    '',
    body.trim(),
    '',
  ].join('\n');
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function countChineseChars(text: string): number {
  const matches = text.match(/[一-鿿]/g);
  return matches ? matches.length : 0;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function validateChapter(chapter: number): number {
  if (!Number.isInteger(chapter) || chapter < 1) {
    throw new AuthorOsError('--chapter must be a positive integer.');
  }
  return chapter;
}

function normalizedInstruction(instruction: string | undefined): string | null {
  const trimmed = instruction?.trim();
  return trimmed ? trimmed : null;
}
