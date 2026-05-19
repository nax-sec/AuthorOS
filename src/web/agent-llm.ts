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

const agentRouterSystemPrompt = [
  'You are AuthorOS JSON router for a private writing cockpit.',
  'Return JSON only. No Markdown, no prose before or after JSON, no code fences.',
  'Keep the message field concise in Simplified Chinese.',
].join(' ');

type LlmAgentAction =
  | { action: 'new_book_intake'; message: string }
  | { action: 'new_book_confirm'; message: string; title?: string; concept: string }
  | { action: 'new_book_confirmed'; message: string; title?: string; concept: string }
  | { action: 'create_book_and_continue'; message: string; title?: string; concept: string }
  | { action: 'continue_book'; message: string }
  | { action: 'read_chapter'; message: string }
  | { action: 'feedback_preview'; message: string; text: string }
  | { action: 'feedback_apply'; message: string }
  | { action: 'style_rewrite_preview'; message: string; intent: StyleRewriteIntent; text: string }
  | { action: 'style_rewrite_apply'; message: string }
  | { action: 'internal_review'; message: string; chapter: number }
  | { action: 'reader_sim_review'; message: string; chapter: number }
  | { action: 'chapter_decision'; message: string; chapter: number }
  | { action: 'memory_update'; message: string; chapter: number }
  | { action: 'download_current_chapter'; message: string }
  | { action: 'download_all_chapters'; message: string }
  | { action: 'status'; message: string }
  | { action: 'unknown'; message: string };

export async function handleAgentMessageWithLlm(
  session: WebAgentSession,
  rawMessage: string,
  options: HandleAgentMessageWithLlmOptions,
): Promise<WebAgentResult> {
  const mode = options.mode ?? 'llm';
  if (mode === 'rule') return handleAgentMessage(session, rawMessage);
  if (mode === 'hybrid' && session.pendingNewBook) return handleAgentMessage(session, rawMessage);

  try {
    const parsed = parseLlmAgentAction(await options.llm.generate(buildAgentPrompt(session, rawMessage), {
      systemPrompt: agentRouterSystemPrompt,
      temperature: 0.1,
      maxTokens: 1600,
    }));
    return applyLlmAction(session, rawMessage, parsed);
  } catch (error) {
    if (mode === 'hybrid') return handleAgentMessage(session, rawMessage);
    throw new Error(`模型接待失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function buildAgentPrompt(session: WebAgentSession, message: string): string {
  return [
    'You are the AuthorOS 常驻写作搭档 inside the private web cockpit.',
    'Classify the user message into exactly one JSON action, but write the user-facing message like a calm author assistant, 不要像命令分类器.',
    'When the user is 模糊, stuck, or exploratory, gently narrow the next writing step instead of pretending you know too much.',
    'Use the current session state. If pendingNewBook exists, treat the user message as the next turn in that exact book-starting flow.',
    `Current session state: ${JSON.stringify({ pendingNewBook: session.pendingNewBook ?? null })}`,
    'Safety rules:',
    '- Do not create a new book from a vague first idea unless the user explicitly asks to start directly.',
    '- If the user is vague about a new book, use new_book_intake and ask compact creative questions.',
    '- If pendingNewBook.stage is "intake" and the user supplies book details, use new_book_confirm with a complete concept and ask for final confirmation.',
    '- If pendingNewBook.stage is "confirm" and the user confirms, use new_book_confirmed with the full concept from session state.',
    '- If the user is generally stuck, prefer unknown with a useful next-step message, unless a concrete route is clear.',
    '- Feedback preview never overwrites chapters.',
    '- Craft rewrite intents also produce feedback_preview first: 强化开头, 强化章尾钩子, 减少解释, 增加压迫感, 对白瘦身.',
    '- Applying feedback requires explicit confirmation.',
    '- Style rewrite preview never overwrites chapters.',
    '- Style rewrite intents produce style_rewrite_preview first: 去 AI 味, 仿写文风, 文风润色, 保留剧情换文风.',
    '- Applying style rewrite requires explicit confirmation.',
    '- Quality loop actions require an explicit positive chapter number.',
    '- Downloads are safe.',
    '',
    'Allowed actions:',
    '- new_book_intake: ask compact setup questions before creating a book.',
    '- new_book_confirm: summarize the proposed book concept and ask the user to confirm before creating it. Requires concept.',
    '- new_book_confirmed: create a book only if explicit direct-start/confirmation is present.',
    '- create_book_and_continue: create a book and immediately plan/write chapter 1 unless the user asked to only create setup.',
    '- continue_book',
    '- read_chapter',
    '- feedback_preview: use for craft rewrite intents such as 强化开头, 强化章尾钩子, 减少解释, 增加压迫感, 对白瘦身.',
    '- feedback_apply',
    '- style_rewrite_preview: generate a bound-style rewrite preview for latest chapter. Requires intent and text. Use for 去 AI 味, 仿写文风, 文风润色, 保留剧情换文风.',
    '- style_rewrite_apply: apply the saved style rewrite preview only after explicit confirmation.',
    '- internal_review: generate internal review for a specific chapter. Requires chapter.',
    '- reader_sim_review: generate simulated reader review for a specific chapter. Requires chapter.',
    '- chapter_decision: generate chapter creative decision after reviews. Requires chapter.',
    '- memory_update: generate memory delta after chapter decision. Requires chapter.',
    '- download_current_chapter',
    '- download_all_chapters',
    '- status',
    '- unknown',
    '',
    'Output JSON only. Examples:',
    '{"action":"feedback_preview","message":"收到，我先把这条感觉转成修改预览，不会覆盖正文。","text":"用户反馈原文或整理后的反馈"}',
    '{"action":"style_rewrite_preview","message":"收到，我先做一版文风改写预览，正文先不动。","intent":"remove_ai_voice","text":"用户原文"}',
    '{"action":"reader_sim_review","message":"收到，我生成第 1 章读者模拟。","chapter":1}',
    '{"action":"new_book_intake","message":"我先帮你把开书方向钉稳，再开始建书。"}',
    '{"action":"new_book_confirm","message":"我先把方向整理成一个开书承诺，确认后就建书。","concept":"完整开书概念"}',
    '{"action":"new_book_confirmed","message":"确认收到，我开始建书。","concept":"完整开书概念"}',
    '{"action":"unknown","message":"我先把下一步收窄一下：可以开新书、继续写，或者读最新章。"}',
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
    case 'new_book_confirm': {
      const concept = 'concept' in parsed && typeof parsed.concept === 'string' ? parsed.concept.trim() : '';
      if (!concept) throw new Error('new_book_confirm requires concept.');
      const title = 'title' in parsed && typeof parsed.title === 'string' ? parsed.title.trim() : undefined;
      return { action: parsed.action, message, title, concept };
    }
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
    case 'internal_review':
    case 'reader_sim_review':
    case 'chapter_decision':
    case 'memory_update': {
      const chapter = 'chapter' in parsed && Number.isInteger(parsed.chapter) ? parsed.chapter : 0;
      if (chapter < 1) throw new Error(`${parsed.action} requires chapter.`);
      return { action: parsed.action, message, chapter } as LlmAgentAction;
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
  if (action.action === 'new_book_confirm') {
    session.pendingNewBook = {
      stage: 'confirm',
      seed: session.pendingNewBook?.seed ?? rawMessage,
      brief: action.concept,
    };
    return { kind: 'reply', action: action.action, message: action.message };
  }
  if (action.action === 'new_book_confirmed') {
    session.pendingNewBook = undefined;
    return {
      kind: 'job',
      action: action.action,
      message: action.message,
      command: { type: 'new_book', title: action.title, concept: action.concept },
    };
  }
  if (action.action === 'create_book_and_continue') {
    session.pendingNewBook = undefined;
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
  if (action.action === 'internal_review') {
    return {
      kind: 'job',
      action: action.action,
      message: action.message,
      command: { type: 'review', chapter: action.chapter, mode: 'internal' },
    };
  }
  if (action.action === 'reader_sim_review') {
    return {
      kind: 'job',
      action: action.action,
      message: action.message,
      command: { type: 'review', chapter: action.chapter, mode: 'reader-sim' },
    };
  }
  if (action.action === 'chapter_decision') {
    return { kind: 'job', action: action.action, message: action.message, command: { type: 'decide', chapter: action.chapter } };
  }
  if (action.action === 'memory_update') {
    return { kind: 'job', action: action.action, message: action.message, command: { type: 'memory_update', chapter: action.chapter } };
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
