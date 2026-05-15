import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebAgentSession } from '../src/web/agent.ts';
import { handleAgentMessageWithLlm } from '../src/web/agent-llm.ts';
import type { LlmClient } from '../src/core/llm.ts';

function llmReturning(content: string): LlmClient {
  return {
    async generate() {
      return content;
    },
  };
}

test('hybrid agent uses rules for explicit commands without calling llm', async () => {
  let called = false;
  const llm: LlmClient = {
    async generate() {
      called = true;
      return '{}';
    },
  };

  const result = await handleAgentMessageWithLlm(createWebAgentSession(), '继续写', { llm, mode: 'hybrid' });

  assert.equal(result.action, 'continue_book');
  assert.equal(result.kind, 'job');
  assert.equal(called, false);
});

test('llm agent can route vague feedback into feedback preview', async () => {
  const result = await handleAgentMessageWithLlm(createWebAgentSession(), '这章读起来怪怪的，不够有趣', {
    mode: 'llm',
    llm: llmReturning(JSON.stringify({
      action: 'feedback_preview',
      message: '收到，我先整理你的感觉并生成修改预览。',
      text: '这章读起来怪怪的，不够有趣，需要增强趣味和可读性。',
    })),
  });

  assert.equal(result.kind, 'job');
  assert.equal(result.action, 'feedback_preview');
  assert.equal(result.command.type, 'feedback');
  assert.match(result.command.text, /不够有趣/);
});

test('llm agent falls back to rules when model returns invalid json', async () => {
  const result = await handleAgentMessageWithLlm(createWebAgentSession(), '读最新章', {
    mode: 'llm',
    llm: llmReturning('not json'),
  });

  assert.equal(result.action, 'read_chapter');
  assert.equal(result.kind, 'job');
});

