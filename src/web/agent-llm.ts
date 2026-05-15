import {
  handleAgentMessage,
  type WebAgentAction,
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
  | { action: 'continue_book'; message: string }
  | { action: 'read_chapter'; message: string }
  | { action: 'feedback_preview'; message: string; text: string }
  | { action: 'feedback_apply'; message: string }
  | { action: 'download_current_chapter'; message: string }
  | { action: 'download_all_chapters'; message: string }
  | { action: 'status'; message: string }
  | { action: 'unknown'; message: string };

const knownRuleActions = new Set<WebAgentAction>([
  'new_book_intake',
  'new_book_confirm',
  'new_book_confirmed',
  'continue_book',
  'read_chapter',
  'feedback_preview',
  'feedback_apply',
  'download_current_chapter',
  'download_all_chapters',
  'status',
]);

export async function handleAgentMessageWithLlm(
  session: WebAgentSession,
  rawMessage: string,
  options: HandleAgentMessageWithLlmOptions,
): Promise<WebAgentResult> {
  const mode = options.mode ?? 'hybrid';
  if (mode === 'rule') return handleAgentMessage(session, rawMessage);

  const ruleResult = handleAgentMessage(session, rawMessage);
  if (mode === 'hybrid' && knownRuleActions.has(ruleResult.action) && ruleResult.action !== 'unknown') {
    return ruleResult;
  }

  try {
    const parsed = parseLlmAgentAction(await options.llm.generate(buildAgentPrompt(rawMessage), {
      temperature: 0.2,
      maxTokens: 700,
    }));
    return applyLlmAction(session, rawMessage, parsed);
  } catch {
    return ruleResult;
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
    '- Downloads are safe.',
    '',
    'Allowed actions:',
    '- new_book_intake: ask compact setup questions before creating a book.',
    '- new_book_confirmed: create a book only if explicit direct-start/confirmation is present.',
    '- continue_book',
    '- read_chapter',
    '- feedback_preview',
    '- feedback_apply',
    '- download_current_chapter',
    '- download_all_chapters',
    '- status',
    '- unknown',
    '',
    'Output JSON only. Examples:',
    '{"action":"feedback_preview","message":"收到，我先生成修改预览。","text":"用户反馈原文或整理后的反馈"}',
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
    case 'feedback_preview': {
      const text = 'text' in parsed && typeof parsed.text === 'string' ? parsed.text.trim() : '';
      if (!text) throw new Error('feedback_preview requires text.');
      return { action: parsed.action, message, text };
    }
    case 'continue_book':
    case 'read_chapter':
    case 'feedback_apply':
    case 'download_current_chapter':
    case 'download_all_chapters':
    case 'status':
    case 'unknown':
      return { action: parsed.action, message } as LlmAgentAction;
    default:
      throw new Error(`Unsupported llm agent action: ${parsed.action}`);
  }
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

