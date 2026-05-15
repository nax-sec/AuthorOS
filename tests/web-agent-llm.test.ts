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

test('hybrid agent lets receptionist handle chat before rule fallback', async () => {
  let called = false;
  const llm: LlmClient = {
    async generate() {
      called = true;
      return JSON.stringify({
        action: 'new_book_intake',
        message: '我先问两个关键问题，再开始。',
      });
    },
  };

  const result = await handleAgentMessageWithLlm(createWebAgentSession(), '我也不知道写什么，你随便写一本', { llm, mode: 'hybrid' });

  assert.equal(result.action, 'new_book_intake');
  assert.equal(result.kind, 'reply');
  assert.equal(called, true);
});

test('llm receptionist can create a book and continue into chapter one', async () => {
  const result = await handleAgentMessageWithLlm(createWebAgentSession(), '你决定，直接开始写', {
    mode: 'hybrid',
    llm: llmReturning(JSON.stringify({
      action: 'create_book_and_continue',
      message: '收到，我会先建书，然后直接写第 1 章。',
      title: '记忆交易所',
      concept: '近未来记忆交易悬疑小说。',
    })),
  });

  assert.equal(result.kind, 'job');
  assert.equal(result.action, 'create_book_and_continue');
  assert.equal(result.command.type, 'new_book_and_continue');
  assert.equal(result.command.title, '记忆交易所');
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
