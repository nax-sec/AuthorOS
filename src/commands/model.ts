import { readAgentProfile } from '../core/agentProfiles.ts';
import { agentNames } from '../core/agents.ts';
import type { LlmClient } from '../core/llm.ts';
import {
  projectModelConfigPath,
  readProjectModelConfig,
  resetProjectModelConfig,
  resolveProjectModelConfig,
  setProjectModelConfig,
  type EnvLike,
  type ProjectModelConfig,
  type ProjectModelConfigPatch,
  type ResolvedProjectModelConfig,
} from '../core/modelConfig.ts';
import { AuthorOsError } from '../core/schema.ts';

export const defaultSmokeAgent = 'chief-writer';

export interface ModelConfigView {
  configured: boolean;
  path: string;
  secretPath: string;
  apiKeyEnv: string;
  apiKeySet: boolean;
  apiKeySource: 'env' | 'local' | 'missing';
  baseUrl: string;
  model?: string;
}

export interface ModelDoctorResult {
  ready: boolean;
  configured: boolean;
  apiKeyEnv: string;
  apiKeySet: boolean;
  apiKeySource: 'env' | 'local' | 'missing';
  baseUrl: string;
  model?: string;
  smokeAgent: string;
  blockers: string[];
}

export interface ModelSmokeResult {
  agent: string;
  prompt: string;
  reply: string;
  model: string;
  baseUrl: string;
}

export async function getModelConfig(projectDir: string, env: EnvLike): Promise<ModelConfigView> {
  const resolved = await resolveProjectModelConfig(projectDir, env);
  return {
    configured: resolved.configured,
    path: resolved.path,
    secretPath: resolved.secretPath,
    apiKeyEnv: resolved.apiKeyEnv,
    apiKeySet: resolved.apiKeySet,
    apiKeySource: resolved.apiKeySource,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
  };
}

export async function updateModelConfig(
  projectDir: string,
  patch: ProjectModelConfigPatch,
): Promise<ProjectModelConfig> {
  return await setProjectModelConfig(projectDir, patch);
}

export async function clearModelConfig(projectDir: string): Promise<{ path: string }> {
  await resetProjectModelConfig(projectDir);
  return { path: projectModelConfigPath() };
}

export async function getModelDoctor(projectDir: string, env: EnvLike): Promise<ModelDoctorResult> {
  const resolved = await resolveProjectModelConfig(projectDir, env);
  const blockers: string[] = [];
  if (!resolved.apiKeySet) {
    blockers.push(`API key env ${resolved.apiKeyEnv} is not set`);
  }
  if (!resolved.model) {
    blockers.push('model is not set (use --model, AUTHOROS_MODEL, or OPENAI_MODEL)');
  }

  return {
    ready: blockers.length === 0,
    configured: resolved.configured,
    apiKeyEnv: resolved.apiKeyEnv,
    apiKeySet: resolved.apiKeySet,
    apiKeySource: resolved.apiKeySource,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    smokeAgent: defaultSmokeAgent,
    blockers,
  };
}

export async function runModelSmoke(
  projectDir: string,
  llm: LlmClient,
  env: EnvLike,
): Promise<ModelSmokeResult> {
  return await pingAgent(projectDir, defaultSmokeAgent, llm, env);
}

export async function pingAgent(
  projectDir: string,
  agentName: string,
  llm: LlmClient,
  env: EnvLike,
): Promise<ModelSmokeResult> {
  if (!agentNames.includes(agentName)) {
    throw new AuthorOsError(`Unknown agent: ${agentName}`);
  }

  const resolved = await resolveProjectModelConfig(projectDir, env);
  if (!resolved.model) {
    throw new AuthorOsError('model is not set (use --model, AUTHOROS_MODEL, or OPENAI_MODEL)');
  }

  const profile = await readAgentProfile(projectDir, agentName);
  const prompt = [
    `AGENT_PING ${agentName}`,
    'agent_profile:',
    profile,
    '',
    'Task: reply with exactly this short Chinese sentence and nothing else:',
    '已理解我的 AuthorOS 角色。',
  ].join('\n');

  const reply = await llm.generate(prompt, {
    temperature: 0.2,
    maxTokens: 800,
  });

  return {
    agent: agentName,
    prompt,
    reply: reply.trim(),
    model: resolved.model,
    baseUrl: resolved.baseUrl,
  };
}

export function renderModelConfig(view: ModelConfigView): string {
  return [
    'AuthorOS model config',
    `path: ${view.path}`,
    `configured: ${view.configured ? 'yes' : 'no (using defaults)'}`,
    `api key env: ${view.apiKeyEnv} (${view.apiKeySet ? 'set' : 'missing'})`,
    `api key source: ${view.apiKeySource}`,
    `baseUrl: ${view.baseUrl}`,
    `model: ${view.model ?? '(missing)'}`,
    '',
  ].join('\n');
}

export function renderModelConfigUpdated(config: ProjectModelConfig): string {
  return [
    'Updated AuthorOS model config:',
    `provider: ${config.provider}`,
    `apiKeyEnv: ${config.apiKeyEnv ?? '(default OPENAI_API_KEY)'}`,
    `baseUrl: ${config.baseUrl ?? '(default https://api.openai.com/v1)'}`,
    `model: ${config.model ?? '(unset)'}`,
    '',
  ].join('\n');
}

export function renderModelConfigReset(result: { path: string }): string {
  return [`Cleared AuthorOS model config: ${result.path}`, ''].join('\n');
}

export function renderModelDoctor(result: ModelDoctorResult): string {
  const lines = [
    'AuthorOS model doctor',
    `ready: ${result.ready ? 'yes' : 'no'}`,
    `configured: ${result.configured ? 'yes' : 'no (using defaults)'}`,
    `api key env: ${result.apiKeyEnv} (${result.apiKeySet ? 'set' : 'missing'})`,
    `api key source: ${result.apiKeySource}`,
    `baseUrl: ${result.baseUrl}`,
    `model: ${result.model ?? '(missing)'}`,
    `smoke: author model smoke   # pings ${result.smokeAgent}`,
  ];

  if (result.blockers.length > 0) {
    lines.push('');
    lines.push('blockers:');
    for (const item of result.blockers) {
      lines.push(`- ${item}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function renderModelSmokeResult(result: ModelSmokeResult): string {
  return [
    'AuthorOS model smoke',
    `agent: ${result.agent}`,
    `model: ${result.model}`,
    `baseUrl: ${result.baseUrl}`,
    '',
    'reply:',
    result.reply,
    '',
  ].join('\n');
}
