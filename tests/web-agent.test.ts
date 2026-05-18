import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebAgentSession, handleAgentMessage } from '../src/web/agent.ts';

test('new book request starts intake instead of creating immediately', () => {
  const session = createWebAgentSession();

  const result = handleAgentMessage(session, '我想看一本赛博香港侦探小说');

  assert.equal(result.kind, 'reply');
  assert.equal(result.action, 'new_book_intake');
  assert.match(result.message, /方向钉稳/);
  assert.equal(session.pendingNewBook?.stage, 'intake');
});

test('assistant unknown reply sounds like a writing partner', () => {
  const session = createWebAgentSession();

  const empty = handleAgentMessage(session, '');
  const vague = handleAgentMessage(session, '我现在有点卡住');

  assert.equal(empty.kind, 'reply');
  assert.equal(empty.action, 'unknown');
  assert.match(empty.message, /我在/);
  assert.match(empty.message, /继续写/);
  assert.equal(vague.kind, 'reply');
  assert.equal(vague.action, 'unknown');
  assert.match(vague.message, /先把下一步收窄/);
  assert.match(vague.message, /开新书|继续写|读最新章/);
});

test('direct-start new book request produces confirmed creation action', () => {
  const session = createWebAgentSession();

  const result = handleAgentMessage(session, '不用问，直接开始，写一本赛博香港侦探小说，主角是义体侦探');

  assert.equal(result.kind, 'job');
  assert.equal(result.action, 'new_book_confirmed');
  assert.match(result.message, /收到/);
  assert.match(result.command.concept, /赛博香港侦探小说/);
});

test('intake answer asks for confirmation before creation', () => {
  const session = createWebAgentSession();
  handleAgentMessage(session, '我想看一本赛博香港侦探小说');

  const result = handleAgentMessage(session, '书名你定，主角是义体侦探，核心是记忆走私，风格冷幽默，不要无脑开挂');

  assert.equal(result.kind, 'reply');
  assert.equal(result.action, 'new_book_confirm');
  assert.match(result.message, /确认按这个方向建书/);
  assert.equal(session.pendingNewBook?.stage, 'confirm');
});

test('confirmation after intake creates a book action', () => {
  const session = createWebAgentSession();
  handleAgentMessage(session, '我想看一本赛博香港侦探小说');
  handleAgentMessage(session, '书名你定，主角是义体侦探，核心是记忆走私，风格冷幽默，不要无脑开挂');

  const result = handleAgentMessage(session, '确认');

  assert.equal(result.kind, 'job');
  assert.equal(result.action, 'new_book_confirmed');
  assert.match(result.message, /开始建书/);
  assert.match(result.command.concept, /记忆走私/);
  assert.equal(session.pendingNewBook, undefined);
});

test('common private author intents route to expected actions', () => {
  const session = createWebAgentSession();

  assert.equal(handleAgentMessage(session, '继续写').action, 'continue_book');
  assert.equal(handleAgentMessage(session, '读最新章').action, 'read_chapter');
  assert.equal(handleAgentMessage(session, '确认应用修改').action, 'feedback_apply');
  assert.equal(handleAgentMessage(session, '下载这一章').action, 'download_current_chapter');
  assert.equal(handleAgentMessage(session, '下载全部章节').action, 'download_all_chapters');

  const feedback = handleAgentMessage(session, '这一章主角太冷了，改得更有人味一点');
  assert.equal(feedback.action, 'feedback_preview');
  assert.equal(feedback.kind, 'job');
  assert.match(feedback.command.text, /主角太冷/);
});

test('style rewrite phrases route to preview command', () => {
  const cases = [
    ['去 AI 味', 'remove_ai_voice'],
    ['这章去ai味', 'remove_ai_voice'],
    ['AI味太重了', 'remove_ai_voice'],
    ['文风改写一下', 'style_polish'],
    ['仿写文风处理这一章', 'imitate_style'],
    ['按文风润色最新章', 'style_polish'],
  ] as const;

  for (const [message, intent] of cases) {
    const result = handleAgentMessage(createWebAgentSession(), message);

    assert.equal(result.kind, 'job');
    assert.equal(result.action, 'style_rewrite_preview');
    assert.equal(result.command.type, 'style_rewrite');
    assert.equal(result.command.chapter, 'latest');
    assert.equal(result.command.intent, intent);
    assert.equal(result.command.text, message);
  }
});

test('style apply phrases route to style apply command', () => {
  const cases = ['确认应用文风修改', '应用文风修改', '应用这次文风'];

  for (const message of cases) {
    const result = handleAgentMessage(createWebAgentSession(), message);

    assert.equal(result.kind, 'job');
    assert.equal(result.action, 'style_rewrite_apply');
    assert.equal(result.command.type, 'style_apply');
  }
});
