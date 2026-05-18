export type CompletedCommandType =
  | 'new_book'
  | 'new_book_and_continue'
  | 'continue'
  | 'feedback'
  | 'apply'
  | 'style_rewrite'
  | 'style_apply'
  | 'internal_review'
  | 'reader_sim_review'
  | 'chapter_decision'
  | 'memory_update'
  | 'read'
  | 'download_chapter'
  | 'download_all'
  | 'status';

export interface JobCompletionCopy {
  title: string;
  detail: string;
  next: string;
}

export function withJobCompletion<T extends Record<string, unknown>>(
  command: CompletedCommandType,
  result: T,
): T & { completion: JobCompletionCopy } {
  return {
    ...result,
    completion: completionCopy(command, result),
  };
}

function completionCopy(command: CompletedCommandType, result: Record<string, unknown>): JobCompletionCopy {
  const chapter = chapterNumber(result);
  const book = bookTitle(result);
  if (command === 'new_book') {
    return {
      title: book ? `《${book}》已建好。` : '新书已建好。',
      detail: '作品定位、世界观、人物和大纲已经写入当前书。',
      next: '可以继续写第 1 章，或先补充设定。',
    };
  }
  if (command === 'new_book_and_continue') {
    return {
      title: book ? `《${book}》已建好，第 ${chapter ?? 1} 章已写好。` : `新书已建好，第 ${chapter ?? 1} 章已写好。`,
      detail: '最新章节已经载入工作区，可以直接阅读。',
      next: '读最新章、提反馈，或继续写下一章。',
    };
  }
  if (command === 'continue') {
    return {
      title: chapter ? `第 ${chapter} 章已写好。` : '下一章已写好。',
      detail: '最新章节已经载入工作区，可以直接阅读。',
      next: '读最新章、提反馈，或继续写下一章。',
    };
  }
  if (command === 'feedback') {
    return {
      title: chapter ? `第 ${chapter} 章修改预览已生成。` : '修改预览已生成。',
      detail: '正文还没有被覆盖，需要确认后才会应用。',
      next: '检查预览，满意后说“确认应用修改”。',
    };
  }
  if (command === 'apply') {
    return {
      title: chapter ? `第 ${chapter} 章修改已应用。` : '修改已应用。',
      detail: '当前章节已经更新，原稿仍保留在变更记录里。',
      next: '读最新章，或继续写下一章。',
    };
  }
  if (command === 'style_rewrite') {
    return {
      title: chapter ? `第 ${chapter} 章文风改写预览已生成。` : '文风改写预览已生成。',
      detail: '正文还没有被覆盖，需要确认后才会应用。',
      next: '检查预览，满意后说“应用文风修改”。',
    };
  }
  if (command === 'style_apply') {
    return {
      title: chapter ? `第 ${chapter} 章文风修改已应用。` : '文风修改已应用。',
      detail: '当前章节已经按绑定文风更新。',
      next: '读最新章，或继续写下一章。',
    };
  }
  if (command === 'internal_review') {
    return {
      title: chapter ? `第 ${chapter} 章内评已生成。` : '内评已生成。',
      detail: '内部顾问和编辑决议已经写入 reviews，并会在质量产物面板打开。',
      next: '查看产物，继续生成读者模拟，或进入章节决策。',
    };
  }
  if (command === 'reader_sim_review') {
    return {
      title: chapter ? `第 ${chapter} 章读者模拟已生成。` : '读者模拟已生成。',
      detail: '模拟读者反馈已经写入 reviews，并会在质量产物面板打开。',
      next: '查看产物；如果内评也已完成，可以生成章节决策。',
    };
  }
  if (command === 'chapter_decision') {
    return {
      title: chapter ? `第 ${chapter} 章创作决策已生成。` : '创作决策已生成。',
      detail: '本章后的取舍、采纳反馈和下一章策略已经写入 decisions，并会在质量产物面板打开。',
      next: '查看产物，生成记忆更新，或按决策继续写下一章。',
    };
  }
  if (command === 'memory_update') {
    return {
      title: chapter ? `第 ${chapter} 章记忆更新已生成。` : '记忆更新已生成。',
      detail: '记忆增量已经写入 memory，并会在记忆更新面板打开。',
      next: '审阅记忆更新，或继续写下一章。',
    };
  }
  if (command === 'read') {
    return {
      title: chapter ? `已读取第 ${chapter} 章。` : '已读取最新章节。',
      detail: '章节内容已经显示在当前章节区域。',
      next: '继续写、提反馈，或下载当前章。',
    };
  }
  if (command === 'download_chapter') {
    return {
      title: '当前章节已准备下载。',
      detail: '浏览器会接管下载文件。',
      next: '下载后可以继续写，或返回检查章节。',
    };
  }
  if (command === 'download_all') {
    return {
      title: '全部章节已准备打包下载。',
      detail: '浏览器会接管下载压缩包。',
      next: '下载后可以继续写，或返回检查章节。',
    };
  }
  return {
    title: '状态已刷新。',
    detail: '当前工作区状态已经更新。',
    next: '查看下一步建议，或直接告诉助理要做什么。',
  };
}

function chapterNumber(result: Record<string, unknown>): number | null {
  const value = result.chapter;
  return Number.isInteger(value) && typeof value === 'number' && value > 0 ? value : null;
}

function bookTitle(result: Record<string, unknown>): string | null {
  const book = result.book;
  if (!book || typeof book !== 'object' || Array.isArray(book)) return null;
  const title = (book as { title?: unknown }).title;
  return typeof title === 'string' && title.trim() ? title.trim() : null;
}
