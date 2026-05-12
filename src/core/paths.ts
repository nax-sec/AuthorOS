import { basename } from 'node:path';
import { AuthorOsError } from './schema.ts';

const windowsReservedChars = /[<>:"/\\|?*]/g;

export function defaultProjectDirName(projectName: string): string {
  const cleaned = projectName
    .replace(windowsReservedChars, '-')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || 'book';
}

export function normalizeRelativePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new AuthorOsError('Target directory cannot be empty.');
  }

  if (basename(trimmed) === '..') {
    throw new AuthorOsError('Target directory cannot end with "..".');
  }

  return trimmed;
}

export function formatChapterNumber(chapter: number): string {
  if (!Number.isInteger(chapter) || chapter < 1) {
    throw new AuthorOsError(`Invalid chapter number: ${chapter}`);
  }

  return String(chapter).padStart(4, '0');
}
