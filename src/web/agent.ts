export type WebAgentAction =
  | 'new_book_intake'
  | 'new_book_confirm'
  | 'new_book_confirmed'
  | 'create_book_and_continue'
  | 'continue_book'
  | 'read_chapter'
  | 'feedback_preview'
  | 'feedback_apply'
  | 'style_rewrite_preview'
  | 'style_rewrite_apply'
  | 'internal_review'
  | 'reader_sim_review'
  | 'chapter_decision'
  | 'memory_update'
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
  | { type: 'new_book_and_continue'; title?: string; concept: string }
  | { type: 'continue' }
  | { type: 'read'; chapter: 'latest' }
  | { type: 'feedback'; chapter: 'latest'; text: string }
  | { type: 'apply' }
  | { type: 'style_rewrite'; chapter: 'latest'; intent: StyleRewriteIntent; text: string }
  | { type: 'style_apply' }
  | { type: 'review'; chapter: number; mode: 'internal' | 'reader-sim' }
  | { type: 'decide'; chapter: number }
  | { type: 'memory_update'; chapter: number }
  | { type: 'download_chapter'; chapter: 'latest' }
  | { type: 'download_all' }
  | { type: 'status' };

export type StyleRewriteIntent = 'imitate_style' | 'remove_ai_voice' | 'style_polish';

const craftRewriteIntents = [
  { label: '强化开头', text: '强化开头：让这一章开场更快抓住读者，先生成修改预览。' },
  { label: '强化章尾钩子', text: '强化章尾钩子：让本章结尾留下更强的继续阅读冲动，先生成修改预览。' },
  { label: '减少解释', text: '减少解释：删掉总结性、说明性、替读者下结论的句子，先生成修改预览。' },
  { label: '增加压迫感', text: '增加压迫感：强化危险、时间压力和场景逼近感，先生成修改预览。' },
  { label: '对白瘦身', text: '对白瘦身：压缩对白，让表达更锋利，先生成修改预览。' },
] as const;

export function createWebAgentSession(): WebAgentSession {
  return {};
}

export function handleAgentMessage(session: WebAgentSession, rawMessage: string): WebAgentResult {
  const message = rawMessage.trim();
  if (!message) return reply('unknown', [
    '我在。你可以直接丢一个很粗的想法，我先帮你收住方向。',
    '也可以说“开一本新书”“继续写”“读最新章”，或者把这一章哪里不顺直接告诉我。',
  ].join('\n'));

  if (session.pendingNewBook) {
    return handlePendingNewBook(session, message);
  }

  const qualityCommand = getQualityCommand(message);
  if (qualityCommand) return qualityCommand;

  if (isStyleApply(message)) {
    return job('style_rewrite_apply', '收到，我开始应用这次文风修改。会先读取待确认预览，再覆盖当前章。', { type: 'style_apply' });
  }
  const styleIntent = getStyleRewriteIntent(message);
  if (styleIntent) {
    return job('style_rewrite_preview', '收到，我先生成文风改写预览，不会直接覆盖正文。', {
      type: 'style_rewrite',
      chapter: 'latest',
      intent: styleIntent,
      text: message,
    });
  }
  const craftIntent = getCraftRewriteIntent(message);
  if (craftIntent) {
    return job('feedback_preview', '收到，我先生成修改预览，不会直接覆盖正文。', {
      type: 'feedback',
      chapter: 'latest',
      text: craftIntent.text,
    });
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
      '我先帮你把这本书的方向钉稳，再开工：',
      '1. 书名或临时书名是什么？',
      '2. 主角是谁，最想要什么？',
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

  return reply('unknown', [
    '我先把下一步收窄一下：',
    '- 如果你想启动新项目，说“开新书”，再给我一个粗方向。',
    '- 如果你想推进当前书，说“继续写”。',
    '- 如果你想回看正文，说“读最新章”。',
    '',
    '也可以直接说卡在哪里，我会先转成一个可执行的写作动作。',
  ].join('\n'));
}

function handlePendingNewBook(session: WebAgentSession, message: string): WebAgentResult {
  const pending = session.pendingNewBook;
  if (!pending) return reply('unknown', '当前没有待确认的新书。');
  if (pending.stage === 'intake') {
    pending.stage = 'confirm';
    pending.brief = message;
    return reply('new_book_confirm', [
      '我先把方向整理成一个开书承诺：',
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

function isStyleApply(message: string): boolean {
  return /确认应用文风修改|应用文风修改|应用这次文风/.test(message);
}

function getQualityCommand(message: string): WebAgentResult | null {
  const chapter = parseChapterNumber(message);
  if (!chapter) return null;
  if (/内评|内部评审/.test(message)) {
    return job('internal_review', `收到，我开始生成第 ${chapter} 章内评。`, {
      type: 'review',
      chapter,
      mode: 'internal',
    });
  }
  if (/读者模拟|模拟读者|reader/i.test(message)) {
    return job('reader_sim_review', `收到，我开始生成第 ${chapter} 章读者模拟。`, {
      type: 'review',
      chapter,
      mode: 'reader-sim',
    });
  }
  if (/决策|创作决策/.test(message)) {
    return job('chapter_decision', `收到，我开始生成第 ${chapter} 章创作决策。`, {
      type: 'decide',
      chapter,
    });
  }
  if (/记忆更新|记忆增量|更新记忆/.test(message)) {
    return job('memory_update', `收到，我开始生成第 ${chapter} 章记忆更新。`, {
      type: 'memory_update',
      chapter,
    });
  }
  return null;
}

function parseChapterNumber(message: string): number | null {
  const match = message.match(/第\s*(\d+)\s*章/);
  if (!match) return null;
  const chapter = Number(match[1]);
  return Number.isInteger(chapter) && chapter > 0 ? chapter : null;
}

function getStyleRewriteIntent(message: string): StyleRewriteIntent | null {
  if (/去\s*AI\s*味|去ai味|AI味/i.test(message)) return 'remove_ai_voice';
  if (/仿写文风/.test(message)) return 'imitate_style';
  if (/文风改写|文风润色|按文风润色|保留剧情换文风|换文风/.test(message)) return 'style_polish';
  return null;
}

function getCraftRewriteIntent(message: string): { label: string; text: string } | null {
  return craftRewriteIntents.find((intent) => message.includes(intent.label)) ?? null;
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
