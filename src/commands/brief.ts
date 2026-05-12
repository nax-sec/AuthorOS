import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AuthorOsError } from '../core/schema.ts';

export interface BriefResult {
  path: string;
  content: string;
}

export async function getProductBrief(projectDir: string): Promise<BriefResult> {
  return await readIdentityFile(projectDir, 'product.md', 'product.md (作品定位)');
}

export async function getAuthorProfile(projectDir: string): Promise<BriefResult> {
  return await readIdentityFile(projectDir, 'author.md', 'author.md (作者人格)');
}

export function renderIdentityFile(result: BriefResult): string {
  return `${result.content.trimEnd()}\n`;
}

async function readIdentityFile(
  projectDir: string,
  relativePath: string,
  label: string,
): Promise<BriefResult> {
  try {
    const content = await readFile(join(projectDir, relativePath), 'utf8');
    return { path: relativePath, content };
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AuthorOsError(
        `${label} not found at ${relativePath}. Run author init or restore the file.`,
      );
    }
    throw error;
  }
}
