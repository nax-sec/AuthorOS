import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AuthorOsError } from './schema.ts';

export interface EnvLike {
  [key: string]: string | undefined;
}

export interface ProjectModelConfig {
  provider: 'openai_compatible';
  apiKeyEnv?: string;
  baseUrl?: string;
  model?: string;
}

export interface ResolvedProjectModelConfig {
  provider: 'openai_compatible';
  path: string;
  configured: boolean;
  apiKeyEnv: string;
  apiKeySet: boolean;
  baseUrl: string;
  model?: string;
}

export interface ProjectModelConfigPatch {
  apiKeyEnv?: string;
  baseUrl?: string;
  model?: string;
}

export const defaultProjectModelConfig: ProjectModelConfig = {
  provider: 'openai_compatible',
  apiKeyEnv: 'OPENAI_API_KEY',
};

export function projectModelConfigPath(): string {
  return '.authoros/model.json';
}

export async function readProjectModelConfig(projectDir: string): Promise<ProjectModelConfig> {
  const stored = await readStoredProjectModelConfig(projectDir);
  return {
    ...defaultProjectModelConfig,
    ...stored,
    provider: 'openai_compatible',
  };
}

export async function resolveProjectModelConfig(
  projectDir: string,
  env: EnvLike,
): Promise<ResolvedProjectModelConfig> {
  const stored = await readStoredProjectModelConfig(projectDir);
  const configured = Object.keys(stored).length > 0;
  const config = {
    ...defaultProjectModelConfig,
    ...stored,
    provider: 'openai_compatible' as const,
  };
  const apiKeyEnv = config.apiKeyEnv ?? 'OPENAI_API_KEY';
  const baseUrl = config.baseUrl?.trim()
    || env.OPENAI_BASE_URL?.trim()
    || 'https://api.openai.com/v1';
  const model = config.model?.trim()
    || env.AUTHOROS_MODEL?.trim()
    || env.OPENAI_MODEL?.trim()
    || undefined;

  return {
    provider: 'openai_compatible',
    path: projectModelConfigPath(),
    configured,
    apiKeyEnv,
    apiKeySet: Boolean(env[apiKeyEnv]?.trim()),
    baseUrl,
    model,
  };
}

export async function setProjectModelConfig(
  projectDir: string,
  patch: ProjectModelConfigPatch,
): Promise<ProjectModelConfig> {
  const normalized = normalizeProjectModelConfigPatch(patch);
  if (
    normalized.apiKeyEnv === undefined
    && normalized.baseUrl === undefined
    && normalized.model === undefined
  ) {
    throw new AuthorOsError('Model config set requires --api-key-env, --base-url, or --model.');
  }

  const current = await readProjectModelConfig(projectDir);
  const next: ProjectModelConfig = {
    ...current,
    ...normalized,
    provider: 'openai_compatible',
  };
  const path = join(projectDir, projectModelConfigPath());
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, undefined, 2)}\n`, 'utf8');
  return next;
}

export async function resetProjectModelConfig(projectDir: string): Promise<void> {
  try {
    await unlink(join(projectDir, projectModelConfigPath()));
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function readStoredProjectModelConfig(projectDir: string): Promise<Partial<ProjectModelConfig>> {
  try {
    const raw = await readFile(join(projectDir, projectModelConfigPath()), 'utf8');
    return normalizeStoredConfig(JSON.parse(raw) as Partial<ProjectModelConfig>);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return {};
    }

    throw error;
  }
}

function normalizeStoredConfig(input: Partial<ProjectModelConfig>): Partial<ProjectModelConfig> {
  if (input.provider !== undefined && input.provider !== 'openai_compatible') {
    throw new AuthorOsError(`Unsupported model provider: ${String(input.provider)}`);
  }

  return normalizeProjectModelConfigPatch(input);
}

function normalizeProjectModelConfigPatch(input: ProjectModelConfigPatch): Partial<ProjectModelConfig> {
  const output: Partial<ProjectModelConfig> = {};
  if (input.apiKeyEnv !== undefined) {
    const apiKeyEnv = input.apiKeyEnv.trim();
    if (!apiKeyEnv.match(/^[A-Za-z_][A-Za-z0-9_]*$/)) {
      throw new AuthorOsError('--api-key-env must be an environment variable name.');
    }
    output.apiKeyEnv = apiKeyEnv;
  }

  if (input.baseUrl !== undefined) {
    const baseUrl = input.baseUrl.trim();
    try {
      new URL(baseUrl);
    } catch {
      throw new AuthorOsError('--base-url must be a valid URL.');
    }
    output.baseUrl = baseUrl.replace(/\/$/, '');
  }

  if (input.model !== undefined) {
    const model = input.model.trim();
    if (!model) {
      throw new AuthorOsError('--model cannot be empty.');
    }
    output.model = model;
  }

  return output;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
