import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface MarkdownFileSchema {
  file: string;
  title: string;
  marker: string;
  purpose: string;
  requiredHeadings: string[];
  optionalHeadings?: string[];
  minChars?: number;
}

export interface YamlFileSchema {
  file: string;
  title: string;
  marker: string;
  purpose: string;
  requiredKeys: YamlKeySpec[];
  minBytes?: number;
}

export interface YamlKeySpec {
  path: string;
  type: 'string' | 'number' | 'array' | 'object';
  required: boolean;
  allowEmpty?: boolean;
}

export interface BookSchema {
  identityFiles: Array<MarkdownFileSchema | YamlFileSchema>;
  memoryFiles: Array<MarkdownFileSchema | YamlFileSchema>;
  configFiles: YamlFileSchema[];
}

export interface SchemaViolation {
  file: string;
  kind: 'missing-required-file' | 'missing-heading' | 'missing-key' | 'wrong-type' | 'empty-required' | 'too-short';
  detail: string;
}

export const bookSchema: BookSchema = {
  identityFiles: [
    markdown('product.md', '作品定位', 'PRODUCT', '题材、目标读者、核心卖点、禁区', [
      '# 作品定位',
      '## 题材',
      '## 目标读者',
      '## 核心卖点',
      '## 禁区',
    ]),
    markdown('author.md', '作者人格', 'AUTHOR', '本书对作者人格的局部覆盖,可为空但结构必须存在', [
      '# 作者人格',
      '## 写作偏好',
      '## 反馈态度',
      '## 决策原则',
    ]),
    markdown('world.md', '世界与规则', 'WORLD', '基础规则、冲突来源、限制与风险提醒', [
      '# 世界与规则',
      '## 基础规则',
      '## 风险提醒',
    ]),
    markdown('outline.md', '主线大纲', 'OUTLINE', '节奏规则、主线阶段、待规划章节', [
      '# 主线大纲',
      '## 节奏规则',
      '## 主线阶段',
      '## 待规划章节',
    ]),
    yaml('characters.yaml', '人物表', 'CHARACTERS', 'protagonist、major、minor、antagonists', [
      { path: 'protagonist.name', type: 'string', required: true, allowEmpty: true },
      { path: 'protagonist.desire', type: 'string', required: true, allowEmpty: true },
      { path: 'major', type: 'array', required: true, allowEmpty: true },
      { path: 'antagonists', type: 'array', required: true, allowEmpty: true },
    ]),
    markdown('review_rules.md', '章节评审规则', 'REVIEW_RULES', '必查项、风险分级', [
      '# 章节评审规则',
      '## 必查项',
      '## 风险分级',
    ]),
  ],
  memoryFiles: [
    markdown('memory/canon.md', '正史设定', 'MEMORY_CANON', '不可违背的已确认事实', [
      '# 正史设定',
      '## 变更记录',
    ]),
    yaml('memory/foreshadowing.yaml', '伏笔账本', 'MEMORY_FORESHADOWING', '伏笔的新增、推进与回收', [
      { path: 'hooks', type: 'array', required: true, allowEmpty: true },
    ]),
    yaml('memory/plot_threads.yaml', '主线状态', 'MEMORY_PLOT_THREADS', '主线线程与当前状态', [
      { path: 'threads', type: 'array', required: true, allowEmpty: true },
    ]),
    yaml('memory/character_state.yaml', '人物状态', 'MEMORY_CHARACTER_STATE', '主要人物的阶段性状态', [
      { path: 'protagonist', type: 'object', required: true },
    ]),
    markdown('memory/style.md', '风格规则', 'MEMORY_STYLE', '已确立与已禁止的风格规则', [
      '# 风格规则',
      '## 变更记录',
    ]),
  ],
  configFiles: [
    yaml('.authoros/config.yaml', '项目配置', 'CONFIG', '书级基础配置', [
      { path: 'version', type: 'number', required: true },
      { path: 'project_name', type: 'string', required: true },
      { path: 'template', type: 'string', required: true },
    ]),
  ],
};

export interface SetupSectionSchema {
  file: string;
  title: string;
  marker: string;
  purpose: string;
}

export function identitySetupSections(): SetupSectionSchema[] {
  return bookSchema.identityFiles.map((entry) => ({
    file: entry.file,
    title: entry.title,
    marker: entry.marker,
    purpose: entry.purpose,
  }));
}

export function schemaEntryForFile(file: string): MarkdownFileSchema | YamlFileSchema | undefined {
  return [
    ...bookSchema.identityFiles,
    ...bookSchema.memoryFiles,
    ...bookSchema.configFiles,
  ].find((entry) => entry.file === file);
}

export async function validateBookFiles(bookDir: string): Promise<SchemaViolation[]> {
  const checks = [
    ...bookSchema.identityFiles,
    ...bookSchema.memoryFiles,
    ...bookSchema.configFiles,
  ];
  const all: SchemaViolation[] = [];
  for (const spec of checks) {
    const absPath = join(bookDir, spec.file);
    all.push(...('requiredHeadings' in spec
      ? await validateMarkdownFile(absPath, spec)
      : await validateYamlFile(absPath, spec)));
  }
  return all;
}

export async function validateMarkdownFile(absPath: string, spec: MarkdownFileSchema): Promise<SchemaViolation[]> {
  let raw: string;
  try {
    raw = await readFile(absPath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      return [{ file: spec.file, kind: 'missing-required-file', detail: `Missing required file: ${spec.file}` }];
    }
    throw error;
  }

  const violations: SchemaViolation[] = [];
  const lines = raw.split(/\r?\n/).map((line) => line.trim());
  for (const heading of spec.requiredHeadings) {
    if (!lines.includes(heading)) {
      violations.push({ file: spec.file, kind: 'missing-heading', detail: `Missing required heading: ${heading}` });
    }
  }
  if (spec.minChars !== undefined && raw.trim().length < spec.minChars) {
    violations.push({ file: spec.file, kind: 'too-short', detail: `Expected at least ${spec.minChars} chars.` });
  }
  return violations;
}

export async function validateYamlFile(absPath: string, spec: YamlFileSchema): Promise<SchemaViolation[]> {
  let raw: string;
  try {
    raw = await readFile(absPath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      return [{ file: spec.file, kind: 'missing-required-file', detail: `Missing required file: ${spec.file}` }];
    }
    throw error;
  }

  const doc = parseSimpleYaml(raw);
  const violations: SchemaViolation[] = [];
  for (const key of spec.requiredKeys) {
    const value = getPath(doc, key.path);
    if (value === undefined || value === null) {
      if (key.required) {
        violations.push({ file: spec.file, kind: 'missing-key', detail: `Missing required key: ${key.path}` });
      }
      continue;
    }
    if (!matchesType(value, key.type)) {
      violations.push({
        file: spec.file,
        kind: 'wrong-type',
        detail: `Expected ${key.path} to be ${key.type}.`,
      });
      continue;
    }
    if (!key.allowEmpty && isEmpty(value)) {
      violations.push({ file: spec.file, kind: 'empty-required', detail: `Required key is empty: ${key.path}` });
    }
  }
  if (spec.minBytes !== undefined && Buffer.byteLength(raw, 'utf8') < spec.minBytes) {
    violations.push({ file: spec.file, kind: 'too-short', detail: `Expected at least ${spec.minBytes} bytes.` });
  }
  return violations;
}

function markdown(
  file: string,
  title: string,
  marker: string,
  purpose: string,
  requiredHeadings: string[],
): MarkdownFileSchema {
  return { file, title, marker, purpose, requiredHeadings };
}

function yaml(
  file: string,
  title: string,
  marker: string,
  purpose: string,
  requiredKeys: YamlKeySpec[],
): YamlFileSchema {
  return { file, title, marker, purpose, requiredKeys };
}

interface StackFrame {
  indent: number;
  value: Record<string, unknown> | unknown[];
  parent?: StackFrame;
  parentKey?: string;
}

function parseSimpleYaml(raw: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const parsedLines = raw.split(/\r?\n/)
    .map((line, index) => ({ line, index }))
    .filter((entry) => {
      const trimmed = stripComment(entry.line).trim();
      return trimmed.length > 0;
    });
  const stack: StackFrame[] = [{ indent: -1, value: root }];

  for (let i = 0; i < parsedLines.length; i += 1) {
    const line = stripComment(parsedLines[i]!.line);
    const indent = countIndent(line);
    const trimmed = line.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]!;

    if (trimmed.startsWith('- ')) {
      const arrayParent = ensureArrayParent(parent);
      const itemText = trimmed.slice(2).trim();
      const item = parseArrayItem(itemText);
      arrayParent.push(item);
      if (isPlainObject(item)) {
        stack.push({ indent, value: item, parent });
      }
      continue;
    }

    const keyMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!keyMatch || Array.isArray(parent.value)) continue;
    const key = keyMatch[1]!.trim();
    const valueText = keyMatch[2]!.trim();
    const value = valueText
      ? parseScalar(valueText)
      : nextChildIsArray(parsedLines, i, indent) ? [] : {};
    parent.value[key] = value;
    if (isPlainObject(value) || Array.isArray(value)) {
      stack.push({ indent, value, parent, parentKey: key });
    }
  }

  return root;
}

function ensureArrayParent(parent: StackFrame): unknown[] {
  if (Array.isArray(parent.value)) return parent.value;
  if (parent.parent && parent.parentKey !== undefined) {
    const replacement: unknown[] = [];
    parent.parent.value[parent.parentKey as keyof typeof parent.parent.value] = replacement as never;
    parent.value = replacement;
    return replacement;
  }
  return [];
}

function parseArrayItem(itemText: string): unknown {
  if (!itemText) return {};
  const keyMatch = itemText.match(/^([^:]+):\s*(.*)$/);
  if (keyMatch) {
    return { [keyMatch[1]!.trim()]: parseScalar(keyMatch[2]!.trim()) };
  }
  return parseScalar(itemText);
}

function parseScalar(valueText: string): unknown {
  const trimmed = valueText.trim();
  if (trimmed === '[]') return [];
  if (trimmed === '{}') return {};
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^['"]|['"]$/g, '');
}

function nextChildIsArray(lines: Array<{ line: string; index: number }>, currentIndex: number, indent: number): boolean {
  for (let i = currentIndex + 1; i < lines.length; i += 1) {
    const line = stripComment(lines[i]!.line);
    const nextIndent = countIndent(line);
    if (nextIndent <= indent) return false;
    return line.trim().startsWith('- ');
  }
  return false;
}

function getPath(input: unknown, path: string): unknown {
  let current = input;
  for (const part of path.split('.')) {
    if (!isPlainObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

function matchesType(value: unknown, type: YamlKeySpec['type']): boolean {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isPlainObject(value);
  if (type === 'number') return typeof value === 'number';
  return typeof value === 'string';
}

function isEmpty(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripComment(line: string): string {
  const index = line.indexOf('#');
  return index >= 0 ? line.slice(0, index) : line;
}

function countIndent(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
