import { spawn } from 'node:child_process';
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultAgentProfiles } from '../core/agentProfiles.ts';
import { resolveAuthorDir, validateAuthor } from '../core/authorSchema.ts';
import { supportedTemplateKeys, resolveTemplateDir } from '../core/templates.ts';
import type { EnvLike } from '../core/modelConfig.ts';
import { AuthorOsError } from '../core/schema.ts';

export interface AuthorInitOptions {
  dir?: string;
  force?: boolean;
  env?: EnvLike;
}

export interface AuthorInitResult {
  authorDir: string;
  templatesCopied: string[];
}

export interface AuthorDoctorResult {
  authorDir: string;
  violations: Awaited<ReturnType<typeof validateAuthor>>;
}

export async function initAuthorDirectory(options: AuthorInitOptions): Promise<AuthorInitResult> {
  const authorDir = resolveAuthorDir(options.dir, options.env);
  await ensureEmptyOrForce(authorDir, options.force === true);

  for (const dir of [
    '',
    'preferences',
    'agents',
    'templates',
    'knowledge',
    'books',
    'changes',
  ]) {
    await mkdir(join(authorDir, dir), { recursive: true });
  }

  await writeFile(join(authorDir, 'author.md'), defaultAuthorMarkdown(), 'utf8');
  await writeFile(join(authorDir, 'style.md'), defaultStyleMarkdown(), 'utf8');
  await writeFile(join(authorDir, 'preferences/weights.yaml'), defaultWeightsYaml(), 'utf8');
  await writeFile(join(authorDir, 'preferences/readers.yaml'), defaultReadersYaml(), 'utf8');
  await writeFile(join(authorDir, 'knowledge/pitfalls.md'), '# 常见问题\n\n## 变更记录\n\n', 'utf8');
  await writeFile(join(authorDir, 'knowledge/signatures.md'), '# 作者标志\n\n## 变更记录\n\n', 'utf8');
  await writeFile(join(authorDir, 'knowledge/cross_book_canon.md'), '# 跨书设定\n\n## 变更记录\n\n', 'utf8');

  for (const profile of defaultAgentProfiles()) {
    await writeFile(join(authorDir, 'agents', `${profile.name}.md`), profile.content, 'utf8');
  }

  const templatesCopied: string[] = [];
  for (const key of supportedTemplateKeys) {
    const source = await resolveTemplateDir(key);
    await cp(source, join(authorDir, 'templates', key), { recursive: true });
    templatesCopied.push(key);
  }

  return { authorDir, templatesCopied };
}

export async function getAuthorDoctor(dir: string | undefined, env: EnvLike): Promise<AuthorDoctorResult> {
  const authorDir = resolveAuthorDir(dir, env);
  return { authorDir, violations: await validateAuthor(authorDir) };
}

export function getAuthorShow(dir: string | undefined, env: EnvLike): { authorDir: string } {
  return { authorDir: resolveAuthorDir(dir, env) };
}

export async function openAuthorProfile(dir: string | undefined, env: EnvLike): Promise<{ authorDir: string; path: string }> {
  const authorDir = resolveAuthorDir(dir, env);
  const path = join(authorDir, 'author.md');
  const editor = env.EDITOR?.trim();
  if (!editor) {
    throw new AuthorOsError('EDITOR is not set. Set $env:EDITOR or open author.md manually.');
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(editor, [path], { stdio: 'inherit', shell: true });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new AuthorOsError(`EDITOR exited with code ${code}`)));
    child.on('error', reject);
  });
  return { authorDir, path };
}

export function renderAuthorInitResult(result: AuthorInitResult): string {
  return [
    'AuthorOS author init complete',
    `authorDir: ${result.authorDir}`,
    `templates: ${result.templatesCopied.join(', ')}`,
    '',
    'Next:',
    '  author init <book-name> --concept "..."',
    '',
  ].join('\n');
}

export function renderAuthorDoctorResult(result: AuthorDoctorResult): string {
  const lines = [
    'AuthorOS author doctor',
    `authorDir: ${result.authorDir}`,
    `violations: ${result.violations.length}`,
  ];
  for (const violation of result.violations) {
    lines.push(`- ${violation.file}: ${violation.kind} - ${violation.detail}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function renderAuthorShowResult(result: { authorDir: string }): string {
  return [
    'AuthorOS author',
    `authorDir: ${result.authorDir}`,
    '',
  ].join('\n');
}

export function renderEditProfileResult(result: { path: string }): string {
  return [`Opened author profile: ${result.path}`, ''].join('\n');
}

async function ensureEmptyOrForce(authorDir: string, force: boolean): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(authorDir);
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }

  if (entries.length === 0 || force) {
    return;
  }

  throw new AuthorOsError(`author dir already initialized: ${authorDir}. Use --force to overwrite.`);
}

function defaultAuthorMarkdown(): string {
  return [
    '# 作者人格',
    '',
    '## 写作偏好',
    '',
    '- 保持题材承诺清晰,不把单一题材模板当成所有作品默认值。',
    '- 优先维护作品自身的核心读者承诺、人物动力和叙事节奏。',
    '',
    '## 反馈态度',
    '',
    '- 真实读者反馈存在时参与决策;缺席时不模拟补权。',
    '- 区分读者真实痛点和偏离作品定位的噪声建议。',
    '',
    '## 决策原则',
    '',
    '- 作者长期规划 40%。',
    '- 内部评审 30%。',
    '- 模拟读者 10%。',
    '- 真实读者反馈 20%,无则不计且不补权。',
    '',
  ].join('\n');
}

function defaultStyleMarkdown(): string {
  return [
    '# 风格规则',
    '',
    '## 已确立',
    '',
    '- 输出必须贴合作品题材,避免把其它模板的专有词汇带入新书。',
    '',
    '## 已禁止',
    '',
    '- 不在无关题材里默认加入能力、代价、异常、系统等设定词。',
    '',
    '## 变更记录',
    '',
  ].join('\n');
}

function defaultWeightsYaml(): string {
  return [
    'decision_basis_weights:',
    '  author_long_term_plan:',
    '    weight: 40',
    '    enabled_when: always',
    '  internal_review:',
    '    weight: 30',
    '    enabled_when: always',
    '  simulated_readers:',
    '    weight: 10',
    '    enabled_when: always',
    '  reader_feedback:',
    '    weight: 20',
    '    enabled_when: real_feedback_exists',
    '    redistribute_when_absent: false',
    '',
  ].join('\n');
}

function defaultReadersYaml(): string {
  return [
    'simulated_readers:',
    '  - id: R1',
    '    name: 节奏型',
    '    cares: [推进是否清楚, 是否拖沓, 章尾是否想追]',
    '  - id: R2',
    '    name: 角色型',
    '    cares: [主角是否主动, 配角是否像活人, 人物关系是否可信]',
    '  - id: R3',
    '    name: 世界型',
    '    cares: [世界规则是否自洽, 信息释放是否自然, 设定是否服务剧情]',
    '  - id: R4',
    '    name: 情感型',
    '    cares: [情绪是否有落点, 关系变化是否动人, 爽点是否有情绪释放]',
    '  - id: R5',
    '    name: 逻辑型',
    '    cares: [因果是否成立, 行动路径是否可信, 反转是否公平]',
    '',
  ].join('\n');
}
