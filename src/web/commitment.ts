import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface BookCommitment {
  genrePromise: string;
  protagonistDesire: string;
  coreConflict: string;
  readerHook: string;
  boundaries: string[];
  firstActDirection: string;
  confidence: 'strong' | 'partial' | 'sparse';
}

export async function deriveBookCommitment(projectDir: string): Promise<BookCommitment> {
  const product = await readOptional(join(projectDir, 'product.md')) ?? '';
  const outline = await readOptional(join(projectDir, 'outline.md')) ?? '';
  const characters = await readOptional(join(projectDir, 'characters.md')) ?? '';
  const world = await readOptional(join(projectDir, 'world.md')) ?? '';

  const genrePromise = firstText([
    extractHeading(product, ['类型承诺', '产品承诺', '题材', 'genre']),
    firstMeaningfulLine(product),
  ], '尚未写清类型承诺');
  const protagonistDesire = firstText([
    extractHeading(characters, ['主角欲望', '主角', 'protagonist']),
    extractHeading(product, ['主角欲望', '主角']),
  ], '尚未写清主角欲望');
  const coreConflict = firstText([
    extractHeading(product, ['核心冲突', '冲突']),
    extractHeading(outline, ['核心冲突', '主线冲突']),
    firstMeaningfulLine(world),
  ], '尚未写清核心冲突');
  const readerHook = firstText([
    extractHeading(product, ['读者钩子', '看点', 'hook']),
    extractHeading(outline, ['读者钩子', '悬念']),
  ], '尚未写清读者钩子');
  const boundaries = listItems(firstText([
    extractHeading(product, ['禁区', '边界', '不要']),
    extractHeading(outline, ['禁区', '边界', '不要']),
  ], ''));
  const firstActDirection = firstText([
    extractHeading(outline, ['前十章方向', '第一幕', 'first act']),
    firstMeaningfulLine(outline),
  ], '尚未写清前十章方向');

  const present = [
    genrePromise !== '尚未写清类型承诺',
    protagonistDesire !== '尚未写清主角欲望',
    coreConflict !== '尚未写清核心冲突',
    readerHook !== '尚未写清读者钩子',
    boundaries.length > 0,
    firstActDirection !== '尚未写清前十章方向',
  ].filter(Boolean).length;

  return {
    genrePromise,
    protagonistDesire,
    coreConflict,
    readerHook,
    boundaries: boundaries.length > 0 ? boundaries : ['尚未写清禁区'],
    firstActDirection,
    confidence: present >= 4 ? 'strong' : present >= 2 ? 'partial' : 'sparse',
  };
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function extractHeading(content: string, headings: readonly string[]): string {
  const lines = content.split(/\r?\n/);
  let collecting = false;
  const body: string[] = [];
  for (const line of lines) {
    const heading = line.match(/^#+\s+(.+?)\s*$/);
    if (heading) {
      if (collecting) break;
      collecting = headings.some((target) => heading[1].toLowerCase().includes(target.toLowerCase()));
      continue;
    }
    if (collecting) body.push(line);
  }
  return normalizeBlock(body.join('\n'));
}

function firstMeaningfulLine(content: string): string {
  const line = content
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith('#'));
  return line ? normalizeLine(line) : '';
}

function firstText(candidates: readonly string[], fallback: string): string {
  return candidates.find((item) => item.trim()) ?? fallback;
}

function listItems(content: string): string[] {
  return content
    .split(/\r?\n|；|;/)
    .map((line) => normalizeLine(line))
    .filter(Boolean)
    .slice(0, 5);
}

function normalizeBlock(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => normalizeLine(line))
    .filter(Boolean)
    .join('\n');
}

function normalizeLine(line: string): string {
  return line.replace(/^[-*]\s*/, '').trim();
}
