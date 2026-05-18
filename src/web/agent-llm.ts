import {
  handleAgentMessage,
  type StyleRewriteIntent,
  type WebAgentResult,
  type WebAgentSession,
} from './agent.ts';
import type { LlmClient } from '../core/llm.ts';

export type WebAgentMode = 'rule' | 'llm' | 'hybrid';

export interface HandleAgentMessageWithLlmOptions {
  mode?: WebAgentMode;
  llm: LlmClient;
}

type LlmAgentAction =
  | { action: 'new_book_intake'; message: string }
  | { action: 'new_book_confirmed'; message: string; title?: string; concept: string }
  | { action: 'create_book_and_continue'; message: string; title?: string; concept: string }
  | { action: 'continue_book'; message: string }
  | { action: 'read_chapter'; message: string }
  | { action: 'feedback_preview'; message: string; text: string }
  | { action: 'feedback_apply'; message: string }
  | { action: 'style_rewrite_preview'; message: string; intent: StyleRewriteIntent; text: string }
  | { action: 'style_rewrite_apply'; message: string }
  | { action: 'download_current_chapter'; message: string }
  | { action: 'download_all_chapters'; message: string }
  | { action: 'status'; message: string }
  | { action: 'unknown'; message: string };

export async function handleAgentMessageWithLlm(
  session: WebAgentSession,
  rawMessage: string,
  options: HandleAgentMessageWithLlmOptions,
): Promise<WebAgentResult> {
  const mode = options.mode ?? 'hybrid';
  if (mode === 'rule') return handleAgentMessage(session, rawMessage);

  try {
    const parsed = parseLlmAgentAction(await options.llm.generate(buildAgentPrompt(rawMessage), {
      temperature: 0.2,
      maxTokens: 700,
    }));
    return applyLlmAction(session, rawMessage, parsed);
  } catch {
    return handleAgentMessage(session, rawMessage);
  }
}

function buildAgentPrompt(message: string): string {
  return [
    'You are the AuthorOS private web front-desk agent.',
    'Classify the user message into exactly one JSON action.',
    'Safety rules:',
    '- Do not create a new book from a vague first idea unless the user explicitly asks to start directly.',
    '- Feedback preview never overwrites chapters.',
    '- Applying feedback requires explicit confirmation.',
    '- Style rewrite preview never overwrites chapters.',
    '- Applying style rewrite requires explicit confirmation.',
    '- Downloads are safe.',
    '',
    'Allowed actions:',
    '- new_book_intake: ask compact setup questions before creating a book.',
    '- new_book_confirmed: create a book only if explicit direct-start/confirmation is present.',
    '- create_book_and_continue: create a book and immediately plan/write chapter 1 unless the user asked to only create setup.',
    '- continue_book',
    '- read_chapter',
    '- feedback_preview',
    '- feedback_apply',
    '- style_rewrite_preview: generate a bound-style rewrite preview for latest chapter. Requires intent and text.',
    '- style_rewrite_apply: apply the saved style rewrite preview only after explicit confirmation.',
    '- download_current_chapter',
    '- download_all_chapters',
    '- status',
    '- unknown',
    '',
    'Output JSON only. Examples:',
    '{"action":"feedback_preview","message":"收到，我先生成修改预览。","text":"用户反馈原文或整理后的反馈"}',
    '{"action":"style_rewrite_preview","message":"收到，我先生成文风改写预览。","intent":"remove_ai_voice","text":"用户原文"}',
    '{"action":"new_book_intake","message":"先确认几个开书问题..."}',
    '',
    `User message: ${JSON.stringify(message)}`,
  ].join('\n');
}

function parseLlmAgentAction(raw: string): LlmAgentAction {
  const jsonText = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  const parsed = JSON.parse(jsonText) as Partial<LlmAgentAction>;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.action !== 'string') {
    throw new Error('Invalid llm agent action.');
  }
  const message = typeof parsed.message === 'string' && parsed.message.trim() ? parsed.message.trim() : '收到。';
  switch (parsed.action) {
    case 'new_book_intake':
      return { action: parsed.action, message };
    case 'new_book_confirmed': {
      const concept = 'concept' in parsed && typeof parsed.concept === 'string' ? parsed.concept.trim() : '';
      if (!concept) throw new Error('new_book_confirmed requires concept.');
      const title = 'title' in parsed && typeof parsed.title === 'string' ? parsed.title.trim() : undefined;
      return { action: parsed.action, message, title, concept };
    }
    case 'create_book_and_continue': {
      const concept = 'concept' in parsed && typeof parsed.concept === 'string' ? parsed.concept.trim() : '';
      if (!concept) throw new Error('create_book_and_continue requires concept.');
      const title = 'title' in parsed && typeof parsed.title === 'string' ? parsed.title.trim() : undefined;
      return { action: parsed.action, message, title, concept };
    }
    case 'feedback_preview': {
      const text = 'text' in parsed && typeof parsed.text === 'string' ? parsed.text.trim() : '';
      if (!text) throw new Error('feedback_preview requires text.');
      return { action: parsed.action, message, text };
    }
    case 'style_rewrite_preview': {
      const text = 'text' in parsed && typeof parsed.text === 'string' ? parsed.text.trim() : '';
      const intent = 'intent' in parsed && typeof parsed.intent === 'string' ? parsed.intent.trim() : '';
      if (!text) throw new Error('style_rewrite_preview requires text.');
      if (!isStyleRewriteIntent(intent)) throw new Error('style_rewrite_preview requires valid intent.');
      return { action: parsed.action, message, intent, text };
    }
    case 'continue_book':
    case 'read_chapter':
    case 'feedback_apply':
    case 'style_rewrite_apply':
    case 'download_current_chapter':
    case 'download_all_chapters':
    case 'status':
    case 'unknown':
      return { action: parsed.action, message } as LlmAgentAction;
    default:
      throw new Error(`Unsupported llm agent action: ${parsed.action}`);
  }
}

function isStyleRewriteIntent(intent: string): intent is StyleRewriteIntent {
  return intent === 'imitate_style' || intent === 'remove_ai_voice' || intent === 'style_polish';
}

function applyLlmAction(session: WebAgentSession, rawMessage: string, action: LlmAgentAction): WebAgentResult {
  if (action.action === 'new_book_intake') {
    session.pendingNewBook = { stage: 'intake', seed: rawMessage };
    return { kind: 'reply', action: action.action, message: action.message };
  }
  if (action.action === 'new_book_confirmed') {
    return {
      kind: 'job',
      action: action.action,
      message: action.message,
      command: { type: 'new_book', title: action.title, concept: action.concept },
    };
  }
  if (action.action === 'create_book_and_continue') {
    return {
      kind: 'job',
      action: action.action,
      message: action.message,
      command: { type: 'new_book_and_continue', title: action.title, concept: action.concept },
    };
  }
  if (action.action === 'continue_book') {
    return { kind: 'job', action: action.action, message: action.message, command: { type: 'continue' } };
  }
  if (action.action === 'read_chapter') {
    return { kind: 'job', action: action.action, message: action.message, command: { type: 'read', chapter: 'latest' } };
  }
  if (action.action === 'feedback_preview') {
    return { kind: 'job', action: action.action, message: action.message, command: { type: 'feedback', chapter: 'latest', text: action.text } };
  }
  if (action.action === 'feedback_apply') {
    return { kind: 'job', action: action.action, message: action.message, command: { type: 'apply' } };
  }
  if (action.action === 'style_rewrite_preview') {
    return {
      kind: 'job',
      action: action.action,
      message: action.message,
      command: { type: 'style_rewrite', chapter: 'latest', intent: action.intent, text: action.text },
    };
  }
  if (action.action === 'style_rewrite_apply') {
    return { kind: 'job', action: action.action, message: action.message, command: { type: 'style_apply' } };
  }
  if (action.action === 'download_current_chapter') {
    return { kind: 'job', action: action.action, message: action.message, command: { type: 'download_chapter', chapter: 'latest' } };
  }
  if (action.action === 'download_all_chapters') {
    return { kind: 'job', action: action.action, message: action.message, command: { type: 'download_all' } };
  }
  if (action.action === 'status') {
    return { kind: 'job', action: action.action, message: action.message, command: { type: 'status' } };
  }
  return { kind: 'reply', action: 'unknown', message: action.message };
}
