import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { agentNames } from './agents.ts';
import {
  type MarkdownFileSchema,
  type SchemaViolation,
  type YamlFileSchema,
  validateMarkdownFile,
  validateYamlFile,
} from './bookSchema.ts';

export interface JsonFileSchema {
  file: string;
  type: 'json';
  optional: boolean;
}

export interface AuthorSchema {
  rootFiles: Array<MarkdownFileSchema | YamlFileSchema>;
  preferenceFiles: Array<YamlFileSchema | JsonFileSchema>;
  agentProfiles: { dir: 'agents/'; required: readonly string[] };
}

export const authorSchema: AuthorSchema = {
  rootFiles: [
    {
      file: 'author.md',
      title: '作者人格',
      marker: 'AUTHOR',
      purpose: '作者级默认写作人格',
      requiredHeadings: ['# 作者人格', '## 写作偏好', '## 反馈态度', '## 决策原则'],
    },
    {
      file: 'style.md',
      title: '风格规则',
      marker: 'STYLE',
      purpose: '作者级默认风格规则',
      requiredHeadings: ['# 风格规则', '## 已确立', '## 已禁止', '## 变更记录'],
    },
  ],
  preferenceFiles: [
    {
      file: 'preferences/weights.yaml',
      title: '决策权重',
      marker: 'WEIGHTS',
      purpose: '作者级默认决策权重',
      requiredKeys: [
        { path: 'decision_basis_weights.author_long_term_plan.weight', type: 'number', required: true },
        { path: 'decision_basis_weights.author_long_term_plan.enabled_when', type: 'string', required: true },
        { path: 'decision_basis_weights.internal_review.weight', type: 'number', required: true },
        { path: 'decision_basis_weights.internal_review.enabled_when', type: 'string', required: true },
        { path: 'decision_basis_weights.simulated_readers.weight', type: 'number', required: true },
        { path: 'decision_basis_weights.simulated_readers.enabled_when', type: 'string', required: true },
        { path: 'decision_basis_weights.reader_feedback.weight', type: 'number', required: true },
        { path: 'decision_basis_weights.reader_feedback.enabled_when', type: 'string', required: true },
      ],
    },
    {
      file: 'preferences/readers.yaml',
      title: '模拟读者',
      marker: 'READERS',
      purpose: '作者级默认模拟读者',
      requiredKeys: [
        { path: 'simulated_readers', type: 'array', required: true },
      ],
    },
    { file: 'preferences/model.json', type: 'json', optional: true },
  ],
  agentProfiles: {
    dir: 'agents/',
    required: agentNames,
  },
};

export async function validateAuthor(authorDir: string): Promise<SchemaViolation[]> {
  const violations: SchemaViolation[] = [];
  for (const spec of authorSchema.rootFiles) {
    violations.push(...('requiredHeadings' in spec
      ? await validateMarkdownFile(join(authorDir, spec.file), spec)
      : await validateYamlFile(join(authorDir, spec.file), spec)));
  }
  for (const spec of authorSchema.preferenceFiles) {
    if ('type' in spec && spec.type === 'json') {
      if (!spec.optional && !await fileExists(join(authorDir, spec.file))) {
        violations.push({ file: spec.file, kind: 'missing-required-file', detail: `Missing required file: ${spec.file}` });
      }
      continue;
    }
    violations.push(...await validateYamlFile(join(authorDir, spec.file), spec));
  }
  for (const agent of authorSchema.agentProfiles.required) {
    const file = `${authorSchema.agentProfiles.dir}${agent}.md`;
    if (!await fileExists(join(authorDir, file))) {
      violations.push({ file, kind: 'missing-required-file', detail: `Missing required file: ${file}` });
    }
  }
  return violations;
}

export function resolveAuthorDir(opt: string | undefined, env: Record<string, string | undefined> = process.env): string {
  return opt?.trim() || env.AUTHOROS_AUTHOR_DIR?.trim() || join(homedir(), '.authoros');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
