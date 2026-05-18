import { resolveProjectModelConfig, type EnvLike } from './modelConfig.ts';

export interface GenerateOptions {
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmClient {
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
}

export type FetchLike = typeof fetch;

const defaultSystemPrompt =
  'You are AuthorOS, a local-first AI author for a single long-form novel. '
  + 'Follow the agent profile and the required context that the command provides. '
  + 'Respect declared canon and the precedence: canon > author profile > product positioning > current chapter plan. '
  + 'Reply in Markdown unless the command explicitly asks for another format.';

export async function createOpenAiCompatibleClientFromProject(
  projectDir: string,
  env: EnvLike = process.env,
  fetcher: FetchLike = fetch,
): Promise<LlmClient> {
  const config = await resolveProjectModelConfig(projectDir, env);
  return createOpenAiCompatibleClient({
    apiKeyEnv: config.apiKeyEnv,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
  }, fetcher);
}

export function createOpenAiCompatibleClient(
  config: {
    apiKeyEnv: string;
    apiKey: string | undefined;
    baseUrl: string;
    model: string | undefined;
  },
  fetcher: FetchLike = fetch,
): LlmClient {
  const apiKey = config.apiKey?.trim();
  const baseUrl = config.baseUrl.trim() || 'https://api.openai.com/v1';
  const model = config.model?.trim() ?? '';

  if (!apiKey) {
    throw new Error(`${config.apiKeyEnv} is required for model-backed AuthorOS commands.`);
  }

  if (!model) {
    throw new Error('AUTHOROS_MODEL or .authoros/model.json model is required for model-backed AuthorOS commands.');
  }

  return {
    async generate(prompt: string, options?: GenerateOptions): Promise<string> {
      const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: options?.model ?? model,
          messages: [
            { role: 'system', content: options?.systemPrompt ?? defaultSystemPrompt },
            { role: 'user', content: prompt },
          ],
          temperature: options?.temperature ?? 0.5,
          max_tokens: options?.maxTokens ?? 1200,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenAI-compatible request failed: ${response.status} ${text}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      };
      const choice = data.choices?.[0];
      const content = choice?.message?.content;

      if (!content) {
        const finish = choice?.finish_reason ?? 'unknown';
        throw new Error(
          `OpenAI-compatible response did not include message content (finish_reason: ${finish}).`,
        );
      }

      return content;
    },
  };
}
