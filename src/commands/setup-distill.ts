import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { bookSchema } from '../core/bookSchema.ts';
import type { LlmClient } from '../core/llm.ts';
import { AuthorOsError } from '../core/schema.ts';
import { resolveTemplateDir, supportedTemplateKeys } from '../core/templates.ts';

export interface ExistingTemplateMeta {
  key: string;
  raw: string;
}

export interface DistillResultRaw {
  should_create: boolean;
  reason: string;
  proposed_key?: string;
  meta?: {
    name: string;
    tone_keywords: string[];
    one_line_pitch: string;
    applicable_when: string;
    not_applicable_when: string;
    diff_from: Record<string, string>;
  };
  skeleton_files?: Record<string, string>;
}

export interface SetupDistillResult {
  shouldCreate: boolean;
  reason: string;
  key?: string;
  path?: string;
  leakedTerms?: string[];
}

const identityFiles = bookSchema.identityFiles.map((entry) => entry.file);
const requiredSkeletonFiles = [
  'product.md',
  'outline.md',
  'world.md',
  'characters.yaml',
  'review_rules.md',
  'memory/canon.md',
  'memory/foreshadowing.yaml',
  'memory/plot_threads.yaml',
  'memory/character_state.yaml',
  'memory/style.md',
] as const;

export async function runSetupDistill(args: {
  bookDir: string;
  authorDir: string;
  projectName: string;
  concept: string;
  llm: LlmClient;
  now?: Date;
}): Promise<SetupDistillResult> {
  const strategyJson = await readFile(join(args.bookDir, '.authoros/strategy.json'), 'utf8');
  const generatedBookFiles = await readGeneratedBookFiles(args.bookDir);
  const existingTemplateMetas = await loadExistingTemplateMetas(args.authorDir);
  const concreteTerms = extractConcreteTerms(generatedBookFiles);

  let prompt = buildDistillPrompt({
    projectName: args.projectName,
    concept: args.concept,
    strategyJson,
    generatedBookFiles,
    existingTemplateMetas,
    retryLeakTerms: [],
  });

  let parsed = parseDistillResult(await generateDistill(args.llm, prompt));
  if (!parsed.should_create) {
    return { shouldCreate: false, reason: parsed.reason };
  }

  let leaked = findLeakedTerms(parsed.skeleton_files ?? {}, concreteTerms);
  if (leaked.length > 0) {
    prompt = buildDistillPrompt({
      projectName: args.projectName,
      concept: args.concept,
      strategyJson,
      generatedBookFiles,
      existingTemplateMetas,
      retryLeakTerms: leaked,
    });
    parsed = parseDistillResult(await generateDistill(args.llm, prompt));
    if (!parsed.should_create) {
      return { shouldCreate: false, reason: parsed.reason, leakedTerms: leaked };
    }
    leaked = findLeakedTerms(parsed.skeleton_files ?? {}, concreteTerms);
    if (leaked.length > 0) {
      return { shouldCreate: false, reason: `distill aborted (concrete leak): ${leaked.join(', ')}`, leakedTerms: leaked };
    }
  }

  assertCandidate(parsed);
  const key = await uniqueTemplateKey(args.authorDir, normalizeTemplateKey(parsed.proposed_key!));
  const targetDir = join(args.authorDir, 'templates', key);
  await writeCandidateTemplate({
    targetDir,
    key,
    projectName: args.projectName,
    parsed,
    prompt,
    now: args.now ?? new Date(),
  });

  return { shouldCreate: true, reason: parsed.reason, key, path: targetDir };
}

export function parseDistillResult(raw: string): DistillResultRaw {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AuthorOsError(`setup distill returned invalid JSON. ${detail}`);
  }
  if (!isPlainObject(parsed) || typeof parsed.should_create !== 'boolean') {
    throw new AuthorOsError('setup distill returned invalid JSON object.');
  }
  return {
    should_create: parsed.should_create,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    proposed_key: typeof parsed.proposed_key === 'string' ? parsed.proposed_key : undefined,
    meta: isPlainObject(parsed.meta) ? {
      name: stringValue(parsed.meta.name),
      tone_keywords: stringArray(parsed.meta.tone_keywords),
      one_line_pitch: stringValue(parsed.meta.one_line_pitch),
      applicable_when: stringValue(parsed.meta.applicable_when),
      not_applicable_when: stringValue(parsed.meta.not_applicable_when),
      diff_from: stringRecord(parsed.meta.diff_from),
    } : undefined,
    skeleton_files: isPlainObject(parsed.skeleton_files) ? stringRecord(parsed.skeleton_files) : undefined,
  };
}

export function buildDistillPrompt(args: {
  projectName: string;
  concept: string;
  strategyJson: string;
  generatedBookFiles: Record<string, string>;
  existingTemplateMetas: ExistingTemplateMeta[];
  retryLeakTerms: string[];
}): string {
  return [
    'SETUP_DISTILL',
    `project_name: ${args.projectName}`,
    `concept: ${args.concept}`,
    'strategy:',
    args.strategyJson.trim(),
    '',
    'generated_book_files (full text):',
    ...Object.entries(args.generatedBookFiles).map(([file, content]) => [
      `--- ${file} ---`,
      content.trim(),
    ].join('\n')),
    '',
    'existing_template_metas:',
    ...args.existingTemplateMetas.map((meta) => [
      `--- ${meta.key}/meta.yaml ---`,
      meta.raw.trim(),
    ].join('\n')),
    '',
    'task:',
    'Determine if this book represents a genre/structure NOT well-covered by any existing template.',
    '',
    'If yes, propose a NEW candidate template by extracting reusable, genre-level patterns',
    '(NOT plot-specific or character-specific content).',
    '',
    'Output exactly this JSON (no commentary, no fences):',
    '{',
    '  "should_create": true | false,',
    '  "reason": "<why or why not>",',
    '  "proposed_key": "<kebab_case_key>",',
    '  "meta": {',
    '    "name": "<中文展示名>",',
    '    "tone_keywords": ["<词1>", "..."],',
    '    "one_line_pitch": "<一句话定位>",',
    '    "applicable_when": "<...>",',
    '    "not_applicable_when": "<...>",',
    '    "diff_from": { "<existing-key>": "<difference>", ... }',
    '  },',
    '  "skeleton_files": {',
    '    "product.md": "<骨架文本>",',
    '    "outline.md": "<骨架文本>",',
    '    "world.md": "<骨架文本>",',
    '    "characters.yaml": "<骨架 yaml>",',
    '    "review_rules.md": "<骨架文本>",',
    '    "memory/canon.md": "<骨架文本>",',
    '    "memory/foreshadowing.yaml": "<骨架 yaml>",',
    '    "memory/plot_threads.yaml": "<骨架 yaml>",',
    '    "memory/character_state.yaml": "<骨架 yaml>",',
    '    "memory/style.md": "<骨架文本>"',
    '  }',
    '}',
    '',
    'Skeleton constraints (CRITICAL):',
    '- No specific character names, no specific place names, no specific chapter numbers from the generated book.',
    '- Use placeholders like "<主角姓名>", "<阵营 A>" for required structure.',
    '- Keep section structure compliant with bookSchema.',
    args.retryLeakTerms.length > 0
      ? `Previous attempt leaked specific names: ${args.retryLeakTerms.join(', ')}. Strip them and retry.`
      : '',
  ].filter((line) => line !== '').join('\n');
}

export async function loadExistingTemplateMetas(authorDir: string): Promise<ExistingTemplateMeta[]> {
  const metas = new Map<string, string>();
  for (const key of supportedTemplateKeys) {
    try {
      metas.set(key, await readFile(join(await resolveTemplateDir(key), 'meta.yaml'), 'utf8'));
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }

  const authorTemplates = join(authorDir, 'templates');
  try {
    for (const entry of await readdir(authorTemplates)) {
      const metaPath = join(authorTemplates, entry, 'meta.yaml');
      try {
        metas.set(entry, await readFile(metaPath, 'utf8'));
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
      }
    }
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }

  return [...metas.entries()].map(([key, raw]) => ({ key, raw }));
}

async function readGeneratedBookFiles(bookDir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const file of identityFiles) {
    out[file] = await readFile(join(bookDir, file), 'utf8');
  }
  return out;
}

async function generateDistill(llm: LlmClient, prompt: string): Promise<string> {
  try {
    return await llm.generate(prompt, { temperature: 0.35, maxTokens: 5000 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AuthorOsError(`Setup distill model generation failed. ${detail}`);
  }
}

function assertCandidate(parsed: DistillResultRaw): asserts parsed is DistillResultRaw & {
  proposed_key: string;
  meta: NonNullable<DistillResultRaw['meta']>;
  skeleton_files: Record<string, string>;
} {
  if (!parsed.proposed_key || !parsed.meta || !parsed.skeleton_files) {
    throw new AuthorOsError('setup distill candidate is missing proposed_key, meta, or skeleton_files.');
  }
  for (const file of requiredSkeletonFiles) {
    if (!parsed.skeleton_files[file]?.trim()) {
      throw new AuthorOsError(`setup distill candidate missing skeleton file: ${file}`);
    }
  }
}

function extractConcreteTerms(files: Record<string, string>): string[] {
  const terms = new Set<string>();
  const characters = files['characters.yaml'] ?? '';
  for (const match of characters.matchAll(/^\s*name:\s*["']?([^"'\n#]+)["']?/gm)) {
    const value = match[1]?.trim();
    if (value && !value.includes('<') && value.length >= 2) {
      terms.add(value);
    }
  }
  return [...terms];
}

function findLeakedTerms(files: Record<string, string>, terms: string[]): string[] {
  const content = Object.values(files).join('\n');
  return terms.filter((term) => content.includes(term));
}

async function writeCandidateTemplate(args: {
  targetDir: string;
  key: string;
  projectName: string;
  parsed: DistillResultRaw & {
    proposed_key: string;
    meta: NonNullable<DistillResultRaw['meta']>;
    skeleton_files: Record<string, string>;
  };
  prompt: string;
  now: Date;
}): Promise<void> {
  await mkdir(args.targetDir, { recursive: true });
  await writeFile(join(args.targetDir, 'meta.yaml'), renderCandidateMeta(args.key, args.parsed, args.projectName, args.now), 'utf8');
  for (const [file, content] of Object.entries(args.parsed.skeleton_files)) {
    const absPath = join(args.targetDir, file);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, ensureTrailingNewline(content), 'utf8');
  }
  await writeDefaultRuntimeFiles(args.targetDir);
  await writeFile(join(args.targetDir, 'provenance.md'), renderProvenance(args.projectName, args.prompt, args.now), 'utf8');
}

function renderCandidateMeta(key: string, parsed: DistillResultRaw & { meta: NonNullable<DistillResultRaw['meta']> }, projectName: string, now: Date): string {
  return [
    `key: ${key}`,
    `name: ${parsed.meta.name}`,
    'status: candidate',
    `tone_keywords: [${parsed.meta.tone_keywords.join(', ')}]`,
    `one_line_pitch: ${parsed.meta.one_line_pitch}`,
    `applicable_when: ${parsed.meta.applicable_when}`,
    `not_applicable_when: ${parsed.meta.not_applicable_when}`,
    'diff_from:',
    ...Object.entries(parsed.meta.diff_from).map(([k, v]) => `  ${k}: ${v}`),
    'created_from:',
    `  book_name: "${escapeYaml(projectName)}"`,
    `  created_at: ${now.toISOString()}`,
    '',
  ].join('\n');
}

async function writeDefaultRuntimeFiles(targetDir: string): Promise<void> {
  const seed = await resolveTemplateDir('urban_power_anomaly');
  for (const file of ['author.md', 'weights.yaml', 'readers.yaml']) {
    const target = join(targetDir, file);
    try {
      await stat(target);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      await cp(join(seed, file), target);
    }
  }
}

function renderProvenance(projectName: string, prompt: string, now: Date): string {
  return [
    '# Template Provenance',
    '',
    `created from: ${projectName}`,
    `created at: ${now.toISOString()}`,
    `distill prompt hash: ${createHash('sha256').update(prompt).digest('hex')}`,
    '',
  ].join('\n');
}

async function uniqueTemplateKey(authorDir: string, baseKey: string): Promise<string> {
  let key = baseKey;
  let suffix = 2;
  while (await pathExists(join(authorDir, 'templates', key))) {
    key = `${baseKey}_v${suffix}`;
    suffix += 1;
  }
  return key;
}

function normalizeTemplateKey(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_ -]+/g, '')
    .replace(/[-\s]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const withPrefix = /^[a-z]/.test(normalized) ? normalized : `template_${normalized}`;
  return withPrefix.slice(0, 41) || 'template_candidate';
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

function stripJsonFences(raw: string): string {
  const text = raw.trim();
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1]!.trim() : text;
}

function ensureTrailingNewline(value: string): string {
  return `${value.trimEnd()}\n`;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeYaml(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
