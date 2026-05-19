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

test('hybrid agent preserves pending new book intake before calling receptionist', async () => {
  const session = createWebAgentSession();
  session.pendingNewBook = { stage: 'intake', seed: '我想开一本新书' };
  let called = false;
  const llm: LlmClient = {
    async generate() {
      called = true;
      return JSON.stringify({
        action: 'unknown',
        message: '我不确定你在补充什么。',
      });
    },
  };

  const result = await handleAgentMessageWithLlm(session, '主角是刘新弟，虐恋重生，感情要细腻', { llm, mode: 'hybrid' });

  assert.equal(called, false);
  assert.equal(result.kind, 'reply');
  assert.equal(result.action, 'new_book_confirm');
  assert.match(result.message, /开书承诺/);
  assert.equal(session.pendingNewBook?.stage, 'confirm');
});

test('hybrid agent preserves pending new book confirmation before calling receptionist', async () => {
  const session = createWebAgentSession();
  session.pendingNewBook = {
    stage: 'confirm',
    seed: '我想开一本新书',
    brief: '主角是刘新弟，虐恋重生，感情要细腻',
  };
  let called = false;
  const llm: LlmClient = {
    async generate() {
      called = true;
      return JSON.stringify({
        action: 'unknown',
        message: '收到「确认」，不过我不确定你确认的是哪一步。',
      });
    },
  };

  const result = await handleAgentMessageWithLlm(session, '确认', { llm, mode: 'hybrid' });

  assert.equal(called, false);
  assert.equal(result.kind, 'job');
  assert.equal(result.action, 'new_book_confirmed');
  assert.equal(result.command.type, 'new_book');
  assert.match(result.command.concept, /刘新弟/);
  assert.equal(session.pendingNewBook, undefined);
});

test('llm receptionist can create a book and continue into chapter one', async () => {
  const result = await handleAgentMessageWithLlm(createWebAgentSession(), '你决定，直接开始写', {
    mode: 'llm',
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

test('llm agent can ask for final new book confirmation with model-written concept', async () => {
  const session = createWebAgentSession();
  session.pendingNewBook = { stage: 'intake', seed: '我想开一本新书' };
  const result = await handleAgentMessageWithLlm(session, '主角是刘新弟，舔狗重生虐恋，感情要细腻', {
    mode: 'llm',
    llm: llmReturning(JSON.stringify({
      action: 'new_book_confirm',
      message: '我先整理成开书承诺，确认后就建书。',
      concept: '主角刘新弟在重生后陷入舔狗式虐恋，文笔细腻，感情推进足够疼。',
    })),
  });

  assert.equal(result.kind, 'reply');
  assert.equal(result.action, 'new_book_confirm');
  assert.match(result.message, /开书承诺/);
  assert.equal(session.pendingNewBook?.stage, 'confirm');
  assert.match(session.pendingNewBook?.brief ?? '', /刘新弟/);
});

test('llm new book confirmation always shows the organized concept before creation', async () => {
  const session = createWebAgentSession();
  session.pendingNewBook = { stage: 'intake', seed: '我想开一本新书' };
  const result = await handleAgentMessageWithLlm(session, '主角是刘新弟，狗血舔狗重生虐恋，夹在男男和男女三角关系里', {
    mode: 'llm',
    llm: llmReturning(JSON.stringify({
      action: 'new_book_confirm',
      message: '我先帮你把想法整理成一个开书概念，确认后就建书开始写。',
      title: '暂定名',
      concept: '刘新弟重生后被迫重走一段狗血舔狗虐恋，在男男暧昧与男女旧情的三角拉扯里越陷越深，文笔细腻，情感足够虐。',
    })),
  });

  assert.equal(result.kind, 'reply');
  assert.equal(result.action, 'new_book_confirm');
  assert.match(result.message, /开书概念/);
  assert.match(result.message, /刘新弟/);
  assert.match(result.message, /三角/);
  assert.match(result.message, /建书前我还想确认几个问题/);
  assert.match(result.message, /结局气质/);
  assert.match(result.message, /确认建书/);
});

test('llm new book flow does not create when the user asks to see the organized concept', async () => {
  const session = createWebAgentSession();
  session.pendingNewBook = {
    stage: 'confirm',
    seed: '我想看一本主角是刘新弟的狗血舔狗重生虐恋文',
    brief: '刘新弟重生后被夹在男男和男女三角关系里，感情细腻，足够虐。',
  };
  const result = await handleAgentMessageWithLlm(session, 'ok，整理吧，让我看看你的概念', {
    mode: 'llm',
    llm: llmReturning(JSON.stringify({
      action: 'new_book_confirmed',
      message: '概念已整理确认，我开始建书。',
      concept: '刘新弟重生后被迫重走舔狗虐恋，在男男暧昧和男女旧情之间被反复撕扯。',
    })),
  });

  assert.equal(result.kind, 'reply');
  assert.equal(result.action, 'new_book_confirm');
  assert.match(result.message, /开书概念/);
  assert.match(result.message, /刘新弟/);
  assert.match(result.message, /确认建书/);
  assert.equal(session.pendingNewBook?.stage, 'confirm');
});

test('llm agent prompt includes pending new book state for confirmation', async () => {
  const session = createWebAgentSession();
  session.pendingNewBook = {
    stage: 'confirm',
    seed: '我想开一本新书',
    brief: '主角刘新弟，舔狗重生虐恋，感情要细腻',
  };
  let prompt = '';
  const result = await handleAgentMessageWithLlm(session, '确认', {
    mode: 'llm',
    llm: {
      async generate(input) {
        prompt = input;
        return JSON.stringify({
          action: 'new_book_confirmed',
          message: '确认收到，我开始建书。',
          concept: '主角刘新弟，舔狗重生虐恋，感情细腻且足够虐。',
        });
      },
    },
  });

  assert.match(prompt, /pendingNewBook/);
  assert.match(prompt, /刘新弟/);
  assert.equal(result.kind, 'job');
  assert.equal(result.action, 'new_book_confirmed');
  assert.equal(result.command.type, 'new_book');
  assert.match(result.command.concept, /刘新弟/);
  assert.equal(session.pendingNewBook, undefined);
});

test('llm agent prompt includes recent server-side conversation history', async () => {
  const session = createWebAgentSession();
  session.turns = [
    { role: 'user', text: '我想看一本主角是刘新弟的狗血舔狗重生虐恋文' },
    { role: 'assistant', text: '我先帮你把开书方向钉稳。', action: 'new_book_intake' },
  ];
  let prompt = '';
  await handleAgentMessageWithLlm(session, '你来补全后建书', {
    mode: 'llm',
    llm: {
      async generate(input) {
        prompt = input;
        return JSON.stringify({
          action: 'unknown',
          message: '我接着前面的方向继续收窄。',
        });
      },
    },
  });

  assert.match(prompt, /Recent conversation history/);
  assert.match(prompt, /刘新弟/);
  assert.match(prompt, /开书方向钉稳/);
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

test('llm prompt lists style rewrite actions', async () => {
  let prompt = '';
  const llm: LlmClient = {
    async generate(input) {
      prompt = input;
      return JSON.stringify({
        action: 'unknown',
        message: '我不确定你要我做什么。',
      });
    },
  };

  await handleAgentMessageWithLlm(createWebAgentSession(), '看看状态', { mode: 'llm', llm });

  assert.match(prompt, /常驻写作搭档/);
  assert.match(prompt, /不要像命令分类器/);
  assert.match(prompt, /模糊/);
  assert.match(prompt, /style_rewrite_preview/);
  assert.match(prompt, /style_rewrite_apply/);
  assert.match(prompt, /强化章尾钩子/);
  assert.match(prompt, /减少解释/);
  assert.match(prompt, /保留剧情换文风/);
  assert.match(prompt, /internal_review/);
  assert.match(prompt, /reader_sim_review/);
  assert.match(prompt, /chapter_decision/);
  assert.match(prompt, /memory_update/);
});

test('llm receptionist uses a JSON router system prompt with enough output budget', async () => {
  let capturedOptions: Parameters<LlmClient['generate']>[1] | undefined;
  const llm: LlmClient = {
    async generate(_input, options) {
      capturedOptions = options;
      return JSON.stringify({
        action: 'unknown',
        message: '我先帮你收窄下一步。',
      });
    },
  };

  await handleAgentMessageWithLlm(createWebAgentSession(), '看看状态', { mode: 'llm', llm });

  assert.match(capturedOptions?.systemPrompt ?? '', /JSON router/);
  assert.match(capturedOptions?.systemPrompt ?? '', /JSON only/);
  assert.equal(capturedOptions?.temperature, 0.1);
  assert.equal(capturedOptions?.maxTokens, 9000);
});

test('llm agent can route style rewrite preview', async () => {
  const result = await handleAgentMessageWithLlm(createWebAgentSession(), '去 AI 味', {
    mode: 'llm',
    llm: llmReturning(JSON.stringify({
      action: 'style_rewrite_preview',
      message: '收到，我先生成文风改写预览。',
      intent: 'remove_ai_voice',
      text: '去 AI 味',
    })),
  });

  assert.equal(result.kind, 'job');
  assert.equal(result.action, 'style_rewrite_preview');
  assert.equal(result.command.type, 'style_rewrite');
  assert.equal(result.command.chapter, 'latest');
  assert.equal(result.command.intent, 'remove_ai_voice');
  assert.equal(result.command.text, '去 AI 味');
});

test('llm agent can route style rewrite apply', async () => {
  const result = await handleAgentMessageWithLlm(createWebAgentSession(), '确认应用文风修改', {
    mode: 'llm',
    llm: llmReturning(JSON.stringify({
      action: 'style_rewrite_apply',
      message: '收到，我应用这次文风修改。',
    })),
  });

  assert.equal(result.kind, 'job');
  assert.equal(result.action, 'style_rewrite_apply');
  assert.equal(result.command.type, 'style_apply');
});

test('llm agent can route quality loop actions with chapter numbers', async () => {
  const result = await handleAgentMessageWithLlm(createWebAgentSession(), '生成第 2 章决策', {
    mode: 'llm',
    llm: llmReturning(JSON.stringify({
      action: 'chapter_decision',
      message: '收到，我生成第 2 章创作决策。',
      chapter: 2,
    })),
  });

  assert.equal(result.kind, 'job');
  assert.equal(result.action, 'chapter_decision');
  assert.equal(result.command.type, 'decide');
  assert.equal(result.command.chapter, 2);
});

test('llm agent rejects invalid model routing instead of falling back to local rules', async () => {
  await assert.rejects(() => handleAgentMessageWithLlm(createWebAgentSession(), '读最新章', {
    mode: 'llm',
    llm: llmReturning('not json'),
  }), /模型接待失败/);
});
