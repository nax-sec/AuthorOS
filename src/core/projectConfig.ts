import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ProjectConfig {
  version: number;
  projectName: string;
  template: string;
  language: string;
  chapterWordCount: number;
  chapterWordCountFloorPercent: number;
  chapterWordCountCeilingPercent: number;
}

export const defaultProjectConfig: ProjectConfig = {
  version: 1,
  projectName: '',
  template: 'urban_power_anomaly',
  language: 'zh-CN',
  chapterWordCount: 3000,
  chapterWordCountFloorPercent: 70,
  chapterWordCountCeilingPercent: 150,
};

export interface ChapterLengthSpec {
  target: number;
  minChars: number;
  maxChars: number;
  maxTokens: number;
  floorPercent: number;
  ceilingPercent: number;
}

export function computeChapterLengthSpec(config: ProjectConfig): ChapterLengthSpec {
  const target = Math.max(500, config.chapterWordCount);
  const minChars = Math.round(target * (config.chapterWordCountFloorPercent / 100));
  const maxChars = Math.round(target * (config.chapterWordCountCeilingPercent / 100));
  const maxTokens = Math.max(8000, Math.ceil(maxChars * 2.5));
  return {
    target,
    minChars,
    maxChars,
    maxTokens,
    floorPercent: config.chapterWordCountFloorPercent,
    ceilingPercent: config.chapterWordCountCeilingPercent,
  };
}

export async function readProjectConfig(projectDir: string): Promise<ProjectConfig> {
  let raw: string;
  try {
    raw = await readFile(join(projectDir, '.authoros/config.yaml'), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...defaultProjectConfig };
    }
    throw error;
  }

  const fields = parseFlatYaml(raw);
  return {
    version: parseIntSafe(fields.version) ?? defaultProjectConfig.version,
    projectName: fields.project_name ?? defaultProjectConfig.projectName,
    template: fields.template ?? defaultProjectConfig.template,
    language: fields.language ?? defaultProjectConfig.language,
    chapterWordCount: parseIntSafe(fields.chapter_word_count) ?? defaultProjectConfig.chapterWordCount,
    chapterWordCountFloorPercent: parsePercent(fields.chapter_word_count_floor_percent)
      ?? defaultProjectConfig.chapterWordCountFloorPercent,
    chapterWordCountCeilingPercent: parsePercent(fields.chapter_word_count_ceiling_percent)
      ?? defaultProjectConfig.chapterWordCountCeilingPercent,
  };
}

function parsePercent(value: string | undefined): number | undefined {
  const parsed = parseIntSafe(value);
  if (parsed === undefined) return undefined;
  if (parsed <= 0 || parsed > 1000) return undefined;
  return parsed;
}

function parseFlatYaml(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const rawLine of raw.split(/\r?\n/)) {
    const match = rawLine.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    fields[key] = value;
  }
  return fields;
}

function parseIntSafe(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return undefined;
  return parsed;
}
