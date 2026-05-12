import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthorOsError } from '../core/schema.ts';

export interface SkillInstallOptions {
  targetDir?: string;
  force?: boolean;
}

export interface SkillInstallResult {
  source: string;
  target: string;
  action: 'installed' | 'overwritten' | 'skipped-existing';
}

const SKILL_NAME = 'authoros';
const SKILL_FILENAME = 'SKILL.md';

export async function installSkill(options: SkillInstallOptions = {}): Promise<SkillInstallResult> {
  const source = resolveBundledSkillPath();
  await assertFile(source, 'Bundled SKILL.md not found. Reinstall authoros package.');

  const targetRoot = options.targetDir ?? defaultSkillsRoot();
  const targetDir = join(targetRoot, SKILL_NAME);
  const target = join(targetDir, SKILL_FILENAME);

  await mkdir(targetDir, { recursive: true });

  const existing = await fileExists(target);
  if (existing && !options.force) {
    const sameContent = await filesEqual(source, target);
    if (sameContent) {
      return { source, target, action: 'skipped-existing' };
    }
    throw new AuthorOsError(
      `SKILL.md already exists at ${target} and differs from the bundled copy. Pass --force to overwrite.`,
    );
  }

  await copyFile(source, target);
  return { source, target, action: existing ? 'overwritten' : 'installed' };
}

export function renderSkillInstallResult(result: SkillInstallResult): string {
  const lines = [
    `Source:  ${result.source}`,
    `Target:  ${result.target}`,
  ];
  if (result.action === 'installed') {
    lines.push('Status:  installed');
  } else if (result.action === 'overwritten') {
    lines.push('Status:  overwritten (--force)');
  } else {
    lines.push('Status:  already up to date');
  }
  lines.push('');
  lines.push('Restart Claude Code (or open a new session) to pick up the skill.');
  lines.push('');
  return lines.join('\n');
}

function resolveBundledSkillPath(): string {
  const here = fileURLToPath(import.meta.url);
  const packageRoot = resolve(dirname(here), '..', '..');
  return join(packageRoot, 'skill', SKILL_NAME, SKILL_FILENAME);
}

function defaultSkillsRoot(): string {
  return join(homedir(), '.claude', 'skills');
}

async function assertFile(path: string, message: string): Promise<void> {
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      throw new AuthorOsError(`${message} (path is not a file: ${path})`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AuthorOsError(`${message} (missing: ${path})`);
    }
    throw error;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function filesEqual(a: string, b: string): Promise<boolean> {
  const [bufA, bufB] = await Promise.all([readFile(a), readFile(b)]);
  return bufA.equals(bufB);
}
