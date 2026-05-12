import { cp, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CascadeContext } from './cascade.ts';
import { AuthorOsError } from './schema.ts';

export const supportedTemplateKeys = [
  'urban_power_anomaly',
  'xianxia',
  'western_fantasy',
  'mystery_thriller',
  'sci_fi',
  'rules_horror',
  'wuxia',
  'dog_blood_romance',
  'system_literature',
  'apocalypse',
  'period_drama',
  'campus_realism',
] as const;

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const templatesRoot = join(sourceRoot, 'seed-templates');

export async function readTemplateFile(template: string, relativePath: string, ctx?: Partial<CascadeContext>): Promise<string> {
  const templateDir = await resolveTemplateDir(template, ctx);
  return await readFile(join(templateDir, relativePath), 'utf8');
}

export async function copyTemplateDirectory(template: string, targetDir: string, ctx?: Partial<CascadeContext>): Promise<void> {
  const templateDir = await resolveTemplateDir(template, ctx);
  await cp(templateDir, targetDir, { recursive: true });
}

export async function resolveTemplateDir(template: string, ctx?: Partial<CascadeContext>): Promise<string> {
  const authorRoot = ctx?.authorRoot ?? null;
  if (authorRoot) {
    const authorTemplateDir = join(authorRoot, 'templates', template);
    if (await isDirectory(authorTemplateDir)) {
      return authorTemplateDir;
    }
  }

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

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
