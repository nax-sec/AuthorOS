import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentContextPaths } from './agentContext.ts';
import { formatChapterNumber } from './paths.ts';
import { AuthorOsError } from './schema.ts';

export type ContextStatus = 'present' | 'optional-missing' | 'required-missing';

export interface ContextDoc {
  declaredPath: string;
  resolvedPath: string | null;
  status: ContextStatus;
  optional: boolean;
  content: string | null;
}

export interface ContextBindings {
  chapter?: number;
}

const optionalSuffix = ' when available';

export async function assembleAgentContext(
  projectDir: string,
  agent: string,
  bindings: ContextBindings = {},
): Promise<ContextDoc[]> {
  const declared = agentContextPaths(agent);
  if (declared.length === 0) {
    return [];
  }

  const docs: ContextDoc[] = [];
  for (const rawPath of declared) {
    const optional = rawPath.endsWith(optionalSuffix);
    const trimmed = optional ? rawPath.slice(0, -optionalSuffix.length).trim() : rawPath.trim();
    const resolved = resolvePlaceholders(trimmed, bindings);

    if (resolved === null) {
      docs.push({
        declaredPath: rawPath,
        resolvedPath: null,
        status: optional ? 'optional-missing' : 'required-missing',
        optional,
        content: null,
      });
      continue;
    }

    try {
      const content = await readFile(join(projectDir, resolved), 'utf8');
      docs.push({
        declaredPath: rawPath,
        resolvedPath: resolved,
        status: 'present',
        optional,
        content,
      });
    } catch (error) {
      if (isMissingFileError(error)) {
        docs.push({
          declaredPath: rawPath,
          resolvedPath: resolved,
          status: optional ? 'optional-missing' : 'required-missing',
          optional,
          content: null,
        });
        continue;
      }
      throw error;
    }
  }

  return docs;
}

export function assertNoRequiredMissing(agent: string, docs: readonly ContextDoc[]): void {
  const missing = docs.filter((doc) => doc.status === 'required-missing');
  if (missing.length === 0) {
    return;
  }

  const paths = missing.map((doc) => doc.resolvedPath ?? doc.declaredPath).join(', ');
  throw new AuthorOsError(
    `Agent "${agent}" is missing required context: ${paths}`,
  );
}

export function renderContextBlock(docs: readonly ContextDoc[]): string {
  const blocks: string[] = [];
  for (const doc of docs) {
    if (doc.status !== 'present' || doc.content === null) {
      continue;
    }

    blocks.push(`[${doc.resolvedPath}]`);
    blocks.push(doc.content.trimEnd());
    blocks.push('');
  }

  return blocks.join('\n').trimEnd();
}

function resolvePlaceholders(rawPath: string, bindings: ContextBindings): string | null {
  let path = rawPath;

  if (path.includes('<chapter>')) {
    if (bindings.chapter === undefined) {
      return null;
    }
    path = path.replaceAll('<chapter>', formatChapterNumber(bindings.chapter));
  }

  if (path.includes('<previous-chapter>')) {
    if (bindings.chapter === undefined || bindings.chapter <= 1) {
      return null;
    }
    path = path.replaceAll('<previous-chapter>', formatChapterNumber(bindings.chapter - 1));
  }

  return path;
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
