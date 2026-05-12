import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { agentRoster } from '../core/agents.ts';
import { defaultAgentProfiles } from '../core/agentProfiles.ts';
import { defaultProjectDirName, normalizeRelativePath } from '../core/paths.ts';
import { AuthorOsError, validateProjectName, validateTemplate } from '../core/schema.ts';
import { copyTemplateDirectory, resolveTemplateDir, supportedTemplateKeys } from '../core/templates.ts';

export interface InitOptions {
  projectName: string | undefined;
  template?: string;
  cwd: string;
  targetDir?: string;
  force?: boolean;
}

export interface InitResult {
  projectName: string;
  targetDir: string;
  template: string;
}

const topLevelTemplateFiles = [
  'product.md',
  'author.md',
  'outline.md',
  'world.md',
  'characters.yaml',
  'review_rules.md',
] as const;

const memoryTemplateFiles = [
  'memory/canon.md',
  'memory/foreshadowing.yaml',
  'memory/plot_threads.yaml',
  'memory/character_state.yaml',
  'memory/style.md',
] as const;

const authorosTemplateFiles = [
  { from: 'weights.yaml', to: '.authoros/weights.yaml' },
  { from: 'readers.yaml', to: '.authoros/readers.yaml' },
] as const;

const runtimeDirectories = [
  'plans',
  'chapters',
  'reviews',
  'feedback',
  'decisions',
  '.authoros/agents',
  '.authoros/runs',
] as const;

export async function initProject(options: InitOptions): Promise<InitResult> {
  const projectName = validateProjectName(options.projectName);
  const template = validateTemplate(options.template ?? 'urban_power_anomaly', supportedTemplateKeys);
  const targetRelative = options.targetDir
    ? normalizeRelativePath(options.targetDir)
    : defaultProjectDirName(projectName);
  const targetDir = resolve(options.cwd, targetRelative);

  await ensureTargetDirEmpty(targetDir, options.force === true);

  const templateDir = await resolveTemplateDir(template);

  await mkdir(targetDir, { recursive: true });

  for (const dir of runtimeDirectories) {
    await mkdir(join(targetDir, dir), { recursive: true });
  }

  for (const relativePath of topLevelTemplateFiles) {
    await copyTemplateFile(templateDir, targetDir, relativePath, relativePath);
  }

  for (const relativePath of memoryTemplateFiles) {
    await copyTemplateFile(templateDir, targetDir, relativePath, relativePath);
  }

  for (const entry of authorosTemplateFiles) {
    await copyTemplateFile(templateDir, targetDir, entry.from, entry.to);
  }

  await copyTemplateDirectory(template, join(targetDir, '.authoros/templates', template));

  for (const profile of defaultAgentProfiles()) {
    await writeFile(join(targetDir, profile.path), profile.content, 'utf8');
  }

  await writeFile(join(targetDir, '.authoros/config.yaml'), renderConfigYaml(projectName, template), 'utf8');
  await writeFile(join(targetDir, '.authoros/state.json'), renderInitialState(), 'utf8');
  await writeFile(join(targetDir, 'README.md'), renderBookReadme(projectName, template), 'utf8');

  return { projectName, targetDir, template };
}

async function ensureTargetDirEmpty(targetDir: string, force: boolean): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(targetDir);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return;
    }

    throw error;
  }

  if (entries.length === 0 || force) {
    return;
  }

  throw new AuthorOsError(
    `Target directory is not empty: ${targetDir}. Use --force to write into it anyway.`,
  );
}

async function copyTemplateFile(
  templateDir: string,
  targetDir: string,
  templateRelative: string,
  targetRelative: string,
): Promise<void> {
  const targetPath = join(targetDir, targetRelative);
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(join(templateDir, templateRelative), targetPath);
}

function renderConfigYaml(projectName: string, template: string): string {
  return [
    'version: 1',
    `project_name: "${escapeYamlScalar(projectName)}"`,
    `template: ${template}`,
    'language: zh-CN',
    'chapter_word_count: 3000',
    '# Length tolerance (percent of chapter_word_count) baked into every chief-writer call.',
    '# Default: chapters may run from 80% to 150% of target. Adjust if your genre runs short or long.',
    'chapter_word_count_floor_percent: 80',
    'chapter_word_count_ceiling_percent: 150',
    'model:',
    '  provider: openai_compatible',
    '  name: ""',
    '',
  ].join('\n');
}

function renderInitialState(): string {
  return `${JSON.stringify({ chapters: {} }, null, 2)}\n`;
}

function renderBookReadme(projectName: string, template: string): string {
  const agentLines = agentRoster.map((agent) => `- ${agent.name} — ${agent.description}`);

  return [
    `# ${projectName}`,
    '',
    `Template: ${template}`,
    '',
    '## Closed creative loop',
    '',
    '```text',
    '作品定位 + 作者人格',
    '  -> 章节计划 (plan)',
    '  -> 章节写作 (write)',
    '  -> 评审三路 (internal review + simulated readers + optional real feedback)',
    '  -> 创作决策 (decide)',
    '  -> 作品记忆更新 (memory)',
    '  -> next chapter',
    '```',
    '',
    '## Agents',
    '',
    ...agentLines,
    '',
    '## Files of record',
    '',
    '- `product.md` — 作品定位',
    '- `author.md` — 作者人格',
    '- `outline.md` — 主线大纲',
    '- `world.md` — 世界与规则',
    '- `characters.yaml` — 人物表',
    '- `review_rules.md` — 内部评审规则',
    '- `memory/canon.md` — 正史设定 (不可违背)',
    '- `memory/foreshadowing.yaml` — 伏笔账本',
    '- `memory/plot_threads.yaml` — 主线状态',
    '- `memory/character_state.yaml` — 人物状态',
    '- `memory/style.md` — 风格规则',
    '- `.authoros/weights.yaml` — 决策依据权重',
    '- `.authoros/readers.yaml` — 模拟读者人格',
    '- `.authoros/agents/<name>.md` — 各 agent 可编辑档案',
    '',
  ].join('\n');
}

function escapeYamlScalar(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
