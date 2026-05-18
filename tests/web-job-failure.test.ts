import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explainJobFailure } from '../src/web/job-failure.ts';

test('explainJobFailure classifies model timeout errors', () => {
  const failure = explainJobFailure(new Error('request timeout after 30000ms'));

  assert.equal(failure.kind, 'model_timeout');
  assert.equal(failure.title, '模型请求超时。');
  assert.match(failure.next, /重试/);
});

test('explainJobFailure classifies finish_reason length truncation', () => {
  const failure = explainJobFailure(new Error('OpenAI-compatible response did not include message content (finish_reason: length).'));

  assert.equal(failure.kind, 'model_length');
  assert.equal(failure.title, '模型输出被截断。');
  assert.match(failure.next, /降低章节字数|换更大上下文/);
});

test('explainJobFailure classifies network connection errors', () => {
  const failure = explainJobFailure(new Error('fetch failed: ECONNREFUSED 127.0.0.1'));

  assert.equal(failure.kind, 'network');
  assert.equal(failure.title, '网络或模型服务连接失败。');
  assert.match(failure.next, /base_url|网络/);
});

test('explainJobFailure classifies model configuration errors', () => {
  const failure = explainJobFailure(new Error('OPENAI_API_KEY is required for model-backed AuthorOS commands.'));

  assert.equal(failure.kind, 'model_config');
  assert.equal(failure.title, '模型配置不完整。');
  assert.match(failure.next, /API key|model config/);
});
