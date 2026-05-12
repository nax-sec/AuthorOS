import { cp, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthorOsError } from './schema.ts';

export const supportedTemplateKeys = ['urban_power_anomaly'] as const;

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const templatesRoot = join(sourceRoot, 'templates');

export async function readTemplateFile(template: string, relativePath: string): Promise<string> {
  const templateDir = await resolveTemplateDir(template);
  return await readFile(join(templateDir, relativePath), 'utf8');
}

export async function copyTemplateDirectory(template: string, targetDir: string): Promise<void> {
  const templateDir = await resolveTemplateDir(template);
  await cp(templateDir, targetDir, { recursive: true });
}

export async function resolveTemplateDir(template: string): Promise<string> {
  const templateDir = join(templatesRoot, template);

  try {
    const templateStat = await stat(templateDir);
    if (!templateStat.isDirectory()) {
      throw new AuthorOsError(`Template path is not a directory: ${template}`);
    }
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new AuthorOsError(`Template files are missing: ${template}`);
    }

    throw error;
  }

  return templateDir;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
