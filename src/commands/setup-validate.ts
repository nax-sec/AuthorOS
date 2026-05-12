import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  schemaEntryForFile,
  validateMarkdownFile,
  validateYamlFile,
  type SchemaViolation,
} from '../core/bookSchema.ts';
import type { LlmClient } from '../core/llm.ts';
import { AuthorOsError } from '../core/schema.ts';

export interface RepairResult {
  file: string;
  repaired: boolean;
  violationsBefore: SchemaViolation[];
  violationsAfter: SchemaViolation[];
}

export async function validateAndRepairBookFiles(args: {
  bookDir: string;
  projectName: string;
  files: string[];
  llm: LlmClient;
}): Promise<RepairResult[]> {
  const results: RepairResult[] = [];
  for (const file of args.files) {
    const result = await repairBookFileIfNeeded(args.bookDir, args.projectName, file, args.llm);
    if (result.violationsAfter.length > 0) {
      throw new AuthorOsError(
        `setup failed to produce schema-compliant ${file}. Details: ${result.violationsAfter.map((v) => v.detail).join('; ')}`,
      );
    }
    results.push(result);
  }
  return results;
}

export async function repairBookFileIfNeeded(
  bookDir: string,
  projectName: string,
  file: string,
  llm: LlmClient,
): Promise<RepairResult> {
  const violationsBefore = await validateSingleFile(bookDir, file);
  if (violationsBefore.length === 0) {
    return { file, repaired: false, violationsBefore, violationsAfter: [] };
  }

  const current = await readFile(join(bookDir, file), 'utf8');
  const prompt = [
    'SETUP_REPAIR',
    `project_name: ${projectName}`,
    '',
    `current_file_content (file: ${file}):`,
    current.trim(),
    '',
    'required_but_missing:',
    ...violationsBefore.map((violation) => `- ${violation.detail}`),
    '',
    'task:',
    'Add ONLY the missing headings/keys to make the file compliant with the schema.',
    '- Do NOT rewrite existing content.',
    '- Do NOT change meaning of existing content.',
    '- Append or insert minimally.',
    '- Output the complete corrected file, Markdown or YAML only, no commentary, no fences.',
  ].join('\n');

  let reply: string;
  try {
    reply = await llm.generate(prompt, { temperature: 0.2, maxTokens: 2000 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AuthorOsError(`Setup repair for ${file} model generation failed. ${detail}`);
  }

  await writeFile(join(bookDir, file), sanitizeFileBody(reply), 'utf8');
  const violationsAfter = await validateSingleFile(bookDir, file);
  return { file, repaired: true, violationsBefore, violationsAfter };
}

async function validateSingleFile(bookDir: string, file: string): Promise<SchemaViolation[]> {
  const spec = schemaEntryForFile(file);
  if (!spec) {
    throw new AuthorOsError(`Unknown book schema file: ${file}`);
  }
  const absPath = join(bookDir, file);
  return 'requiredHeadings' in spec
    ? await validateMarkdownFile(absPath, spec)
    : await validateYamlFile(absPath, spec);
}

function sanitizeFileBody(reply: string): string {
  let text = reply.trim();
  const fenceMatch = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/);
  if (fenceMatch) {
    text = fenceMatch[1]!.trim();
  }
  return `${text}\n`;
}
