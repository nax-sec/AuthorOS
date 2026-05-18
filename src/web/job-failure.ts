export type JobFailureKind = 'model_timeout' | 'model_length' | 'network' | 'model_config' | 'unknown';

export interface JobFailureExplanation {
  kind: JobFailureKind;
  title: string;
  detail: string;
  next: string;
}

export function explainJobFailure(error: unknown): JobFailureExplanation {
  const detail = errorMessage(error);
  const lower = detail.toLowerCase();
  if (/timeout|timed out|etimedout/.test(lower)) {
    return {
      kind: 'model_timeout',
      title: '模型请求超时。',
      detail,
      next: '稍后重试；如果反复超时，换更快的模型或降低本次任务长度。',
    };
  }
  if (/finish_reason:\s*length|finish reason.*length|context_length|max_tokens|maximum context|token limit/.test(lower)) {
    return {
      kind: 'model_length',
      title: '模型输出被截断。',
      detail,
      next: '降低章节字数、拆小任务，或换更大上下文/输出上限的模型后重试。',
    };
  }
  if (/econnrefused|enotfound|eai_again|network|fetch failed|connection refused|socket|dns/.test(lower)) {
    return {
      kind: 'network',
      title: '网络或模型服务连接失败。',
      detail,
      next: '检查网络、base_url 和模型服务是否可访问，然后重试。',
    };
  }
  if (/api[_ -]?key|model is required|model-backed|authoros_model|openai_model|base[_ -]?url|unauthorized|401|403/.test(lower)) {
    return {
      kind: 'model_config',
      title: '模型配置不完整。',
      detail,
      next: '检查 API key、base_url 和 model 配置；可运行 author model config 或 author model doctor。',
    };
  }
  return {
    kind: 'unknown',
    title: '任务执行失败。',
    detail,
    next: '查看技术细节后重试；如果反复失败，先检查模型配置和当前书状态。',
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isJobFailureExplanation(value: unknown): value is JobFailureExplanation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return isFailureKind(record.kind)
    && typeof record.title === 'string'
    && typeof record.detail === 'string'
    && typeof record.next === 'string';
}

function isFailureKind(value: unknown): value is JobFailureKind {
  return value === 'model_timeout'
    || value === 'model_length'
    || value === 'network'
    || value === 'model_config'
    || value === 'unknown';
}
