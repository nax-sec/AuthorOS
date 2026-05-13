import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  bookSchema,
  type BookSchema,
  type MarkdownFileSchema,
  type YamlFileSchema,
} from '../core/bookSchema.ts';
import type { LlmClient } from '../core/llm.ts';
import { AuthorOsError } from '../core/schema.ts';
import { resolveTemplateDir, supportedTemplateKeys } from '../core/templates.ts';

export interface TemplateMeta {
  key: string;
  name: string;
  status: string;
  tone_keywords: string[];
  one_line_pitch: string;
  applicable_when: string;
  not_applicable_when: string;
}

export interface SetupStrategy {
  base: 'none' | string;
  borrow_from: string[];
  invent: string[];
  scope_hint: 'this-book-only' | 'may-elevate-to-author';
  per_section_intent: Record<string, string>;
  rationale: string;
}

const hardBannedVocabulary = [
  '能力',
  '代价',
  '异能',
  '异常',
  '灵根',
  '境界',
  '神迹',
  '种族',
  '线索',
  '嫌疑人',
] as const;

export async function createSetupStrategy(args: {
  projectName: string;
  concept: string;
  metas: TemplateMeta[];
  llm: LlmClient;
}): Promise<SetupStrategy> {
  const prompt = buildStrategyPrompt({
    projectName: args.projectName,
    concept: args.concept,
    metas: args.metas,
    schema: bookSchema,
  });

  let lastRaw = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      lastRaw = await args.llm.generate(prompt, { temperature: 0.4, maxTokens: 4000 });
      return parseSetupStrategy(lastRaw);
    } catch (error) {
      if (attempt === 2) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new AuthorOsError(
          `setup strategy returned invalid JSON. Retry or check model output: ${lastRaw.slice(0, 200)} (${detail})`,
        );
      }
    }
  }

  throw new AuthorOsError('setup strategy returned invalid JSON.');
}

export function parseSetupStrategy(raw: string): SetupStrategy {
  let parsed: unknown;
  const jsonText = stripJsonFences(raw);
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AuthorOsError(`setup strategy returned invalid JSON. ${detail}`);
  }

  if (!isPlainObject(parsed)) {
    throw new AuthorOsError('setup strategy returned invalid JSON object.');
  }

  const base = stringValue(parsed.base);
  const scopeHint = stringValue(parsed.scope_hint);
  const perSectionIntent = parsed.per_section_intent;
  if (!base || (scopeHint !== 'this-book-only' && scopeHint !== 'may-elevate-to-author')) {
    throw new AuthorOsError('setup strategy missing base or scope_hint.');
  }
  if (!isPlainObject(perSectionIntent)) {
    throw new AuthorOsError('setup strategy missing per_section_intent.');
  }

  const intents: Record<string, string> = {};
  for (const entry of bookSchema.identityFiles) {
    intents[entry.file] = stringValue(perSectionIntent[entry.file]) ?? '';
  }

  return {
    base,
    borrow_from: stringArray(parsed.borrow_from),
    invent: stringArray(parsed.invent),
    scope_hint: scopeHint,
    per_section_intent: intents,
    rationale: stringValue(parsed.rationale) ?? '',
  };
}

export function buildStrategyPrompt(args: {
  projectName: string;
  concept: string;
  metas: TemplateMeta[];
  schema: BookSchema;
}): string {
  return [
    'SETUP_STRATEGY',
    `project_name: ${args.projectName}`,
    `concept: ${args.concept}`,
    '',
    'available_templates (metas only, NO content):',
    ...args.metas
      .filter((meta) => meta.status !== 'archived')
      .map((meta) => [
        `- key: ${meta.key}`,
        `  pitch: ${meta.one_line_pitch}`,
        `  tone: ${meta.tone_keywords.join(', ')}`,
        `  applicable_when: ${meta.applicable_when}`,
        `  not_applicable_when: ${meta.not_applicable_when}`,
      ].join('\n')),
    '',
    'book_file_skeleton (required headings/keys, structure only):',
    ...args.schema.identityFiles.map((entry) => `- ${schemaLine(entry)}`),
    '',
    'task:',
    'Analyze the concept. Decide how to build this book WITHOUT copying any template\'s content.',
    '',
    'Output exactly this JSON (no commentary, no fences):',
    '{',
    '  "base": "none" | "<template-key>",',
    '  "borrow_from": ["<template-key>", ...],',
    '  "invent": ["<element>", ...],',
    '  "scope_hint": "this-book-only" | "may-elevate-to-author",',
    '  "per_section_intent": {',
    '    "product.md": "<one or two sentences on what to write>",',
    '    "author.md": "<...>",',
    '    "outline.md": "<...>",',
    '    "world.md": "<...>",',
    '    "characters.yaml": "<...>",',
    '    "review_rules.md": "<...>"',
    '  },',
    '  "rationale": "<short explanation>"',
    '}',
    '',
    'Constraints:',
    '- "base" picks at most one template as structural reference (or "none" if concept doesn\'t fit any).',
    '- "borrow_from" lists templates whose tone/structure (not content) might inspire — keep small.',
    '- "invent" lists novel elements not covered by any existing template.',
    '- per_section_intent must be neutral, MUST NOT use vocabulary copied from any template\'s pitch.',
  ].join('\n');
}

export function buildGenerationPrompt(args: {
  projectName: string;
  concept: string;
  section: MarkdownFileSchema | YamlFileSchema;
  sectionIntent: string;
  agentProfile: string;
  bannedVocabulary: string[];
}): string {
  return [
    `SETUP_GENERATE_${args.section.marker}`,
    `project_name: ${args.projectName}`,
    `concept: ${args.concept}`,
    '',
    `section_file: ${args.section.file}`,
    'section_skeleton:',
    '  required_headings (md) or required_keys (yaml):',
    ...sectionSkeleton(args.section).map((line) => `  ${line}`),
    '',
    'section_intent (from strategy):',
    args.sectionIntent || '(none)',
    '',
    'agent_profile:',
    args.agentProfile.trim(),
    '',
    'task:',
    `Write the contents of ${args.section.file} for this book.`,
    '',
    'Hard constraints:',
    '- Use ONLY the required headings/keys above. You may add subheadings/keys, but all required ones MUST appear.',
    '- Derive all content from the concept + section_intent. Do NOT use vocabulary borrowed from any other template.',
    '- For markdown files: output Markdown only, no code fences, no commentary.',
    '- For yaml files: output valid YAML only, no code fences, no commentary.',
    '- Be concrete; avoid generic platitudes.',
    '- Length guideline: 600-1500 characters for markdown, structural completeness for yaml.',
    '',
    'Banned vocabulary (do NOT use these words unless the concept itself uses them):',
    args.bannedVocabulary.length > 0 ? args.bannedVocabulary.join(', ') : '(none)',
  ].join('\n');
}

export function buildBannedVocabulary(
  concept: string,
  strategy: Pick<SetupStrategy, 'base' | 'borrow_from'>,
  metas: TemplateMeta[],
): string[] {
  const selected = new Set([strategy.base, ...strategy.borrow_from].filter((key) => key && key !== 'none'));
  const selectedToneWords = new Set(
    metas
      .filter((meta) => selected.has(meta.key))
      .flatMap((meta) => meta.tone_keywords),
  );
  const allToneWords = metas.flatMap((meta) => meta.tone_keywords);

  return unique([...hardBannedVocabulary, ...allToneWords])
    .filter((word) => !concept.includes(word))
    .filter((word) => !selectedToneWords.has(word));
}

export async function loadTemplateMetas(authorDir?: string | null): Promise<TemplateMeta[]> {
  const keys = await discoverTemplateKeys(authorDir);
  const metas: TemplateMeta[] = [];
  for (const key of keys) {
    try {
      const templateDir = await resolveTemplateDir(key, { authorRoot: authorDir ?? null });
      const raw = await readFile(join(templateDir, 'meta.yaml'), 'utf8');
      const meta = parseTemplateMeta(raw, key);
      if (meta.status !== 'archived') {
        metas.push(meta);
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }
  return metas;
}

function schemaLine(entry: MarkdownFileSchema | YamlFileSchema): string {
  if ('requiredHeadings' in entry) {
    return `${entry.file}: [${entry.requiredHeadings.join(', ')}]`;
  }
  return `${entry.file} keys: [${entry.requiredKeys.map((key) => key.path).join(', ')}]`;
}

function sectionSkeleton(entry: MarkdownFileSchema | YamlFileSchema): string[] {
  if ('requiredHeadings' in entry) {
    return entry.requiredHeadings.map((heading) => `- ${heading}`);
  }
  return entry.requiredKeys.map((key) => `- ${key.path}${key.type === 'array' ? '[]' : ''}`);
}

async function discoverTemplateKeys(authorDir?: string | null): Promise<string[]> {
  const keys = new Set<string>(supportedTemplateKeys);
  if (!authorDir) return [...keys];

  const templatesDir = join(authorDir, 'templates');
  try {
    const entries = await readdir(templatesDir);
    for (const entry of entries) {
      if (await isDirectory(join(templatesDir, entry))) {
        keys.add(entry);
      }
    }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
  return [...keys];
}

function parseTemplateMeta(raw: string, fallbackKey: string): TemplateMeta {
  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    values[match[1]!] = match[2]!.trim();
  }

  return {
    key: values.key || fallbackKey,
    name: values.name || fallbackKey,
    status: values.status || 'active',
    tone_keywords: parseInlineArray(values.tone_keywords || ''),
    one_line_pitch: values.one_line_pitch || '',
    applicable_when: values.applicable_when || '',
    not_applicable_when: values.not_applicable_when || '',
  };
}

function parseInlineArray(value: string): string[] {
  const match = value.match(/^\[(.*)\]$/);
  if (!match) return [];
  return match[1]!
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function stripJsonFences(raw: string): string {
  const text = raw.trim();
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1]!.trim() : text;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
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
