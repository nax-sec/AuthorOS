export type WebAgentAction =
  | 'new_book_intake'
  | 'new_book_confirm'
  | 'new_book_confirmed'
  | 'continue_book'
  | 'read_chapter'
  | 'feedback_preview'
  | 'feedback_apply'
  | 'download_current_chapter'
  | 'download_all_chapters'
  | 'status'
  | 'unknown';

export interface PendingNewBook {
  stage: 'intake' | 'confirm';
  seed: string;
  brief?: string;
}

export interface WebAgentSession {
  pendingNewBook?: PendingNewBook;
}

export type WebAgentResult =
  | {
      kind: 'reply';
      action: WebAgentAction;
      message: string;
    }
  | {
      kind: 'job';
      action: WebAgentAction;
      message: string;
      command: WebAgentCommand;
    };

export type WebAgentCommand =
  | { type: 'new_book'; title?: string; concept: string }
  | { type: 'continue' }
  | { type: 'read'; chapter: 'latest' }
  | { type: 'feedback'; chapter: 'latest'; text: string }
  | { type: 'apply' }
  | { type: 'download_chapter'; chapter: 'latest' }
  | { type: 'download_all' }
  | { type: 'status' };

export function createWebAgentSession(): WebAgentSession {
  return {};
}

export function handleAgentMessage(session: WebAgentSession, rawMessage: string): WebAgentResult {
  const message = rawMessage.trim();
  if (!message) return reply('unknown', '我没收到具体内容。你可以说“开一本新书”“继续写”“读最新章”，或者直接提修改意见。');

  if (session.pendingNewBook) {
    return handlePendingNewBook(session, message);
  }

  if (isApply(message)) {
    return job('feedback_apply', '收到，我开始应用这次修改。会先读取待确认反馈，再覆盖当前章。', { type: 'apply' });
  }
  if (isDownloadAll(message)) {
    return job('download_all_chapters', '收到，我准备打包全部章节。', { type: 'download_all' });
  }
  if (isDownloadCurrent(message)) {
    return job('download_current_chapter', '收到，我准备下载当前章节。', { type: 'download_chapter', chapter: 'latest' });
  }
  if (isContinue(message)) {
    return job('continue_book', '收到，我开始写下一章。会先做章节计划，再生成正文，可能需要 1-3 分钟。', { type: 'continue' });
  }
  if (isRead(message)) {
    return job('read_chapter', '收到，我读取最新章节。', { type: 'read', chapter: 'latest' });
  }
  if (isNewBookRequest(message)) {
    if (isDirectStart(message)) {
      return job('new_book_confirmed', '收到，我按你给的方向直接建书。', { type: 'new_book', concept: message });
    }
    session.pendingNewBook = { stage: 'intake', seed: message };
    return reply('new_book_intake', [
      '先确认几个开书问题，避免我直接跑偏：',
      '1. 书名或临时书名？',
      '2. 主角是谁？',
      '3. 核心冲突或最大看点是什么？',
      '4. 想要什么语气和节奏？',
      '5. 明确不要什么？',
      '',
      '每一项都可以回答“你决定”。',
    ].join('\n'));
  }
  if (looksLikeFeedback(message)) {
    return job('feedback_preview', '收到，我先按你的意见生成修改预览，不会直接覆盖正文。', {
      type: 'feedback',
      chapter: 'latest',
      text: message,
    });
  }

  return reply('unknown', '我不确定你要我做什么。你可以说：开新书、继续写、读最新章、下载这一章，或者直接指出哪里要改。');
}

function handlePendingNewBook(session: WebAgentSession, message: string): WebAgentResult {
  const pending = session.pendingNewBook;
  if (!pending) return reply('unknown', '当前没有待确认的新书。');
  if (pending.stage === 'intake') {
    pending.stage = 'confirm';
    pending.brief = message;
    return reply('new_book_confirm', [
      '我先按这个方向理解：',
      `- 初始想法：${pending.seed}`,
      `- 补充设定：${message}`,
      '- 我会把它整理成一本可持续写的 AuthorOS 书，而不是一次性短文。',
      '',
      '确认按这个方向建书吗？回复“确认 / 可以 / 就这样 / 开始建”。',
    ].join('\n'));
  }
  if (isConfirm(message)) {
    const concept = [pending.seed, pending.brief].filter(Boolean).join('\n');
    session.pendingNewBook = undefined;
    return job('new_book_confirmed', '确认收到，我开始建书。会先生成作品定位、世界观、人物和大纲。', {
      type: 'new_book',
      concept,
    });
  }
  pending.brief = [pending.brief, message].filter(Boolean).join('\n');
  return reply('new_book_confirm', [
    '我更新了开书方向：',
    `- 初始想法：${pending.seed}`,
    `- 当前补充：${pending.brief}`,
    '',
    '如果可以，回复“确认”。如果还要改，继续补充。',
  ].join('\n'));
}

function reply(action: WebAgentAction, message: string): WebAgentResult {
  return { kind: 'reply', action, message };
}

function job(action: WebAgentAction, message: string, command: WebAgentCommand): WebAgentResult {
  return { kind: 'job', action, message, command };
}

function isConfirm(message: string): boolean {
  return /^(确认|可以|就这样|开始建|开始吧|ok|OK)$/i.test(message.trim());
}

function isDirectStart(message: string): boolean {
  return /直接开始|不用问|别问|你决定.*直接建|直接建/.test(message);
}

function isNewBookRequest(message: string): boolean {
  return /我想看|写一本|开一本|新书|建书|起一本/.test(message);
}

function isContinue(message: string): boolean {
  return /继续写|下一章|写下去|续写/.test(message);
}

function isRead(message: string): boolean {
  return /读最新|看看最新|阅读最新|最新章/.test(message);
}

function isApply(message: string): boolean {
  return /确认应用|应用修改|覆盖吧|可以应用|确认修改/.test(message);
}

function isDownloadCurrent(message: string): boolean {
  return /下载(这一章|当前章|最新章)|导出(这一章|当前章|最新章)/.test(message);
}

function isDownloadAll(message: string): boolean {
  return /下载全部|导出全部|打包全部|全部章节/.test(message);
}

function looksLikeFeedback(message: string): boolean {
  return /不好|不行|太|改|修改|反馈|别|不要|更|少一点|多一点|问题/.test(message);
}

