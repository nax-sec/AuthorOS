import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AuthorOsError } from '../core/schema.ts';

export interface StyleRules {
  sentenceRhythm: string[];
  paragraphDensity: string[];
  dialogue: string[];
  narrativeDistance: string[];
  sensoryDetail: string[];
  imagery: string[];
  pacing: string[];
  avoid: string[];
  antiAiVoice: string[];
}

export interface StyleProfile {
  version: 1;
  id: string;
  name: string;
  description: string;
  createdAt: string;
  sourceNote: string;
  sourceHash: string;
  rules: StyleRules;
}

export interface StyleProfileSummary {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  sourceNote: string;
  sourceHash: string;
}

export interface StyleBinding {
  version: 1;
  profileId: string;
  boundAt: string;
}

export interface StyleBindingResult {
  binding: StyleBinding;
  profile: StyleProfile;
}

export interface CreateStyleProfileOptions {
  name: string;
  text: string;
  sourceNote?: string;
  now?: Date;
}

const MIN_REFERENCE_CHARS = 160;
const RULE_KEYS = [
  'sentenceRhythm',
  'paragraphDensity',
  'dialogue',
  'narrativeDistance',
  'sensoryDetail',
  'imagery',
  'pacing',
  'avoid',
  'antiAiVoice',
] as const;

type RuleKey = typeof RULE_KEYS[number];

export function createStyleProfileFromText(root: string, opts: CreateStyleProfileOptions): StyleProfile {
  void root;
  const name = opts.name.trim();
  if (!name) throw new AuthorOsError('Style profile name cannot be empty.');

  const text = normalizeReferenceText(opts.text);
  if (text.length < MIN_REFERENCE_CHARS || splitSentences(text).length < 3) {
    throw new AuthorOsError('Reference text is too short for a style profile.');
  }

  const sourceHash = createHash('sha256').update(text).digest('hex');
  const paragraphs = splitParagraphs(text);
  const sentences = splitSentences(text);
  const words = splitWords(text);
  const avgSentenceWords = average(sentences.map((sentence) => splitWords(sentence).length));
  const avgParagraphSentences = average(paragraphs.map((paragraph) => splitSentences(paragraph).length));
  const dialogueCount = countMatches(text, /["“”‘’]/g);
  const sensoryCount = countKeywordMatches(text, [
    'saw',
    'seen',
    'sound',
    'smell',
    'taste',
    'touch',
    'felt',
    'heard',
    'noticed',
    'rain',
    'thunder',
    'coffee',
    'oil',
    'window',
    'light',
    'silence',
    '看见',
    '听见',
    '闻到',
    '水声',
    '灯',
    '烟灰',
    '潮气',
    '冷茶',
    '灰尘',
    '香水',
  ]);
  const imageryCount = countMatches(text, /\b(as if|like|seemed|shadow|blue|gold|bright|dark|dust|bruise)\b|像|灯光|雨夜|刀背|眼睛/giu);

  return {
    version: 1,
    id: `${slugify(name)}-${sourceHash.slice(0, 8)}`,
    name,
    description: [
      `${paragraphs.length} paragraphs`,
      `${sentences.length} sentences`,
      `${Math.round(avgSentenceWords)} words per sentence on average`,
    ].join('; '),
    createdAt: (opts.now ?? new Date()).toISOString(),
    sourceNote: opts.sourceNote?.trim() ?? '',
    sourceHash,
    rules: {
      sentenceRhythm: [
        avgSentenceWords >= 18
          ? 'Favor long, layered sentences broken by short decisive beats.'
          : 'Favor concise sentences with visible beat changes.',
        punctuationRule(text),
      ],
      paragraphDensity: [
        avgParagraphSentences >= 3
          ? 'Use medium-dense paragraphs that carry several turns of observation.'
          : 'Use compact paragraphs with one clean dramatic movement each.',
      ],
      dialogue: [
        dialogueCount > 0
          ? 'Let dialogue arrive as controlled pressure rather than exposition.'
          : 'Keep dialogue sparse; carry voice through action and observation.',
      ],
      narrativeDistance: [
        hasFirstPerson(text)
          ? 'Stay close to the narrator while filtering the scene through personal judgment.'
          : 'Use close third-person observation with restrained interpretation.',
      ],
      sensoryDetail: [
        sensoryCount > 0
          ? 'Anchor emotion in concrete sensory details before naming conclusions.'
          : 'Add selective sensory anchors so scenes do not become abstract summary.',
      ],
      imagery: [
        imageryCount > 0
          ? 'Use image-based comparisons sparingly, tied to the scene objects.'
          : 'Prefer plain images from the setting over decorative metaphor.',
      ],
      pacing: [
        paragraphs.length >= 3
          ? 'Move from atmosphere to withheld information to consequence.'
          : 'Keep each passage focused on one reveal or reversal.',
      ],
      avoid: [
        'Do not copy sentences or signature phrasings from the reference text.',
        'Avoid generic intensifiers, moral summaries, and over-explained emotion.',
      ],
      antiAiVoice: [
        words.length >= 120
          ? 'Preserve uneven human cadence: specific objects, delayed answers, and small contradictions.'
          : 'Prefer precise scene evidence over polished generic transitions.',
      ],
    },
  };
}

export async function saveStyleProfile(root: string, profile: StyleProfile): Promise<string> {
  const valid = parseStyleProfile(profile, 'style profile');
  const path = styleProfilePath(root, valid.id);
  await mkdir(styleProfilesDir(root), { recursive: true });
  await writeFile(path, `${JSON.stringify(valid, null, 2)}\n`, 'utf8');
  return path;
}

export async function listStyleProfiles(root: string): Promise<StyleProfileSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(styleProfilesDir(root));
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }

  const profiles = await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => loadStyleProfile(root, entry.slice(0, -'.json'.length))),
  );
  return profiles
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.name.localeCompare(right.name))
    .map((profile) => ({
      id: profile.id,
      name: profile.name,
      description: profile.description,
      createdAt: profile.createdAt,
      sourceNote: profile.sourceNote,
      sourceHash: profile.sourceHash,
    }));
}

export async function loadStyleProfile(root: string, id: string): Promise<StyleProfile> {
  const cleanId = validateId(id);
  const path = styleProfilePath(root, cleanId);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (isMissingFileError(error)) throw new AuthorOsError(`Style profile not found: ${cleanId}`);
    if (error instanceof SyntaxError) throw new AuthorOsError(`Invalid JSON in style profile: ${path}`);
    throw error;
  }
  return parseStyleProfile(parsed, `style profile: ${path}`);
}

export async function bindStyleProfile(
  root: string,
  projectDir: string,
  profileId: string,
  now?: Date,
): Promise<StyleBinding> {
  const profile = await loadStyleProfile(root, profileId);
  const binding: StyleBinding = {
    version: 1,
    profileId: profile.id,
    boundAt: (now ?? new Date()).toISOString(),
  };
  await mkdir(styleBindingDir(projectDir), { recursive: true });
  await writeFile(styleBindingPath(projectDir), `${JSON.stringify(binding, null, 2)}\n`, 'utf8');
  return binding;
}

export async function readStyleBinding(root: string, projectDir: string): Promise<StyleBindingResult | null> {
  const path = styleBindingPath(projectDir);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (isMissingFileError(error)) return null;
    if (error instanceof SyntaxError) throw new AuthorOsError(`Invalid JSON in style binding: ${path}`);
    throw error;
  }

  const binding = parseStyleBinding(parsed, `style binding: ${path}`);
  try {
    return {
      binding,
      profile: await loadStyleProfile(root, binding.profileId),
    };
  } catch (error) {
    if (error instanceof AuthorOsError && error.message.includes('Style profile not found')) {
      throw new AuthorOsError(`Style binding points to a missing profile: ${binding.profileId}`);
    }
    throw error;
  }
}

export function renderStyleProfileSummary(profile: StyleProfileSummary): string {
  return [
    `${profile.name} (${profile.id})`,
    `created: ${profile.createdAt}`,
    `source: ${profile.sourceNote || '(none)'}`,
    profile.description,
  ].join('\n');
}

function styleProfilesDir(root: string): string {
  return join(resolve(root), '.authoros/styles/profiles');
}

function styleProfilePath(root: string, id: string): string {
  return join(styleProfilesDir(root), `${validateId(id)}.json`);
}

function styleBindingDir(projectDir: string): string {
  return join(resolve(projectDir), '.authoros/private');
}

function styleBindingPath(projectDir: string): string {
  return join(styleBindingDir(projectDir), 'style-binding.json');
}

function normalizeReferenceText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, ' ')
    .match(/[^.!?。！？]+[.!?。！？"”'’]*|[^.!?。！？]+$/gu)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? [];
}

function splitWords(text: string): string[] {
  return text.match(/\p{Script=Han}|[\p{L}\p{N}']+/gu) ?? [];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function countKeywordMatches(text: string, words: string[]): number {
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return words.some((word) => /[\u3400-\u9fff]/u.test(word))
    ? escaped.reduce((count, word) => count + countMatches(text, new RegExp(word, 'gu')), 0)
    : countMatches(text, new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi'));
}

function punctuationRule(text: string): string {
  if (/[;:]/.test(text)) return 'Use semicolons or colons for pivots only when they sharpen the turn.';
  if (/[,，]/.test(text)) return 'Use commas to layer perception without smoothing away tension.';
  return 'Keep punctuation plain and let line order carry rhythm.';
}

function hasFirstPerson(text: string): boolean {
  return /\b(I|me|my|mine|we|us|our|ours)\b/i.test(text) || /(^|[^\p{L}])我|我们|咱们/u.test(text);
}

function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug) return slug;
  return `style-${createHash('sha256').update(input).digest('hex').slice(0, 8)}`;
}

function validateId(id: string): string {
  const cleanId = id.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(cleanId)) {
    throw new AuthorOsError(`Invalid style profile id: ${id}`);
  }
  return cleanId;
}

function parseStyleProfile(value: unknown, label: string): StyleProfile {
  if (!isRecord(value)) throw new AuthorOsError(`Invalid ${label}.`);
  if (value.version !== 1) throw new AuthorOsError(`Invalid ${label}: version must be 1.`);
  const profile: StyleProfile = {
    version: 1,
    id: stringField(value, 'id', label),
    name: stringField(value, 'name', label),
    description: stringField(value, 'description', label),
    createdAt: stringField(value, 'createdAt', label),
    sourceNote: stringField(value, 'sourceNote', label),
    sourceHash: stringField(value, 'sourceHash', label),
    rules: parseStyleRules(value.rules, label),
  };
  validateId(profile.id);
  if (!/^[a-f0-9]{64}$/.test(profile.sourceHash)) {
    throw new AuthorOsError(`Invalid ${label}: sourceHash must be sha256 hex.`);
  }
  return profile;
}

function parseStyleRules(value: unknown, label: string): StyleRules {
  if (!isRecord(value)) throw new AuthorOsError(`Invalid ${label}: rules must be an object.`);
  const rules = {} as Record<RuleKey, string[]>;
  for (const key of RULE_KEYS) {
    const field = value[key];
    if (!Array.isArray(field) || field.length === 0 || field.some((item) => typeof item !== 'string' || !item.trim())) {
      throw new AuthorOsError(`Invalid ${label}: rules.${key} must be a non-empty string array.`);
    }
    rules[key] = field.map((item) => item.trim());
  }
  return rules;
}

function parseStyleBinding(value: unknown, label: string): StyleBinding {
  if (!isRecord(value)) throw new AuthorOsError(`Invalid ${label}.`);
  if (value.version !== 1) throw new AuthorOsError(`Invalid ${label}: version must be 1.`);
  return {
    version: 1,
    profileId: validateId(stringField(value, 'profileId', label)),
    boundAt: stringField(value, 'boundAt', label),
  };
}

function stringField(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new AuthorOsError(`Invalid ${label}: ${key} must be a string.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
