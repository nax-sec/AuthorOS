import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCockpitOverview } from '../src/web/cockpit.ts';
import { createJobStore } from '../src/web/jobs.ts';

async function withTempRoot(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-cockpit-'));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeBook(root: string): Promise<void> {
  await mkdir(join(root, 'books/demo/chapters'), { recursive: true });
  await mkdir(join(root, 'books/demo/plans'), { recursive: true });
  await writeFile(join(root, 'bookshelf.json'), JSON.stringify({
    version: 1,
    current: 'demo',
    books: [{
      id: 'demo',
      title: 'Demo Book',
      concept: 'A private test book.',
      path: 'books/demo',
      created_at: '2026-05-14T00:00:00.000Z',
      last_active_at: '2026-05-14T01:00:00.000Z',
    }],
  }, null, 2), 'utf8');
  await writeFile(join(root, 'books/demo/plans/0001.md'), 'plan', 'utf8');
  await writeFile(join(root, 'books/demo/chapters/0001.md'), 'chapter one body', 'utf8');
}

async function writeStyleProfile(root: string, input: {
  id: string;
  name: string;
  description: string;
  antiAiVoice: string[];
}): Promise<Record<string, unknown>> {
  await mkdir(join(root, '.authoros/styles/profiles'), { recursive: true });
  const profile = {
    version: 1,
    id: input.id,
    name: input.name,
    description: input.description,
    createdAt: '2026-05-18T07:00:00.000Z',
    sourceNote: '测试样本',
    sourceHash: 'a'.repeat(64),
    rules: {
      sentenceRhythm: ['短句优先。'],
      paragraphDensity: ['段落保持紧凑。'],
      dialogue: ['对白少解释。'],
      narrativeDistance: ['贴近视角。'],
      sensoryDetail: ['保留触感。'],
      imagery: ['城市意象。'],
      pacing: ['快慢交替。'],
      avoid: ['避免空泛。'],
      antiAiVoice: input.antiAiVoice,
    },
  };
  await writeFile(join(root, `.authoros/styles/profiles/${input.id}.json`), JSON.stringify(profile, null, 2), 'utf8');
  return profile;
}

test('cockpit overview handles an empty bookshelf', async () => {
  await withTempRoot(async (root) => {
    const overview = await getCockpitOverview(root, {}, createJobStore());

    assert.equal(overview.current, null);
    assert.deepEqual(overview.style, { profiles: [], binding: null, currentProfile: null, generation: null });
    assert.equal(overview.nextAction.kind, 'new_book');
    assert.equal(overview.books.length, 0);
    assert.equal(overview.quality, null);
    assert.equal(overview.session.service.label, '本机服务在线');
    assert.equal(overview.session.currentBook.label, '暂无当前书');
    assert.equal(overview.session.currentTask, null);
    assert.equal(overview.session.lastCompleted, null);
    assert.equal(overview.session.resume.label, '开一本新书后可恢复现场');
  });
});

test('cockpit overview reports current book latest chapter and model status', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    await writeFile(join(root, 'books/demo/plans/0002.md'), 'plan two', 'utf8');
    await writeFile(join(root, 'books/demo/chapters/0002.md'), 'chapter two body', 'utf8');
    const jobs = createJobStore({ now: () => new Date('2026-05-14T02:00:00Z') });
    const completed = jobs.createJob('continue_book', '开始写下一章');
    jobs.complete(completed.id, { chapter: 1 });
    const running = jobs.createJob('continue_book', '正在写第 2 章');

    const overview = await getCockpitOverview(root, {
      OPENAI_API_KEY: 'key',
      AUTHOROS_MODEL: 'gpt-test',
    }, jobs);

    assert.equal(overview.current?.book.title, 'Demo Book');
    assert.equal(overview.current?.latestChapter?.chapter, 2);
    assert.equal(overview.current?.latestChapter?.excerpt, 'chapter two body');
    assert.deepEqual(overview.current?.draftedChapters, [
      { chapter: 1, chapterId: '0001', label: '第 1 章' },
      { chapter: 2, chapterId: '0002', label: '第 2 章' },
    ]);
    assert.equal(overview.model.apiKeySet, true);
    assert.equal(overview.model.model, 'gpt-test');
    assert.equal(overview.jobs[0].id, running.id);
    assert.equal(overview.nextAction.kind, 'continue_book');
    assert.equal(overview.quality?.nextChapter.chapter, 3);
    assert.equal((overview.quality?.signals[0].label.length ?? 0) > 0, true);
    assert.equal(overview.session.currentBook.label, 'Demo Book');
    assert.equal(overview.session.currentTask?.jobId, running.id);
    assert.equal(overview.session.currentTask?.label, '继续写作');
    assert.equal(overview.session.lastCompleted?.label, '继续写作');
    assert.equal(overview.session.resume.label, '恢复 Demo Book');
  });
});

test('cockpit overview includes model health and daily resume cues', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    const jobs = createJobStore({ now: () => new Date('2026-05-19T09:00:00.000Z') });
    const running = jobs.createJob('continue_book', '继续写');

    const overview = await getCockpitOverview(root, {
      OPENAI_API_KEY: 'sk-test',
      AUTHOROS_MODEL: 'gpt-test',
    }, jobs);

    assert.equal(overview.modelHealth.status, 'ready');
    assert.equal(overview.modelHealth.sourceLabel, '环境变量');
    assert.match(overview.modelHealth.detail, /gpt-test/);
    assert.equal(overview.session.daily.currentTask?.jobId, running.id);
    assert.equal(overview.session.daily.lastActiveBook?.label, 'Demo Book');
    assert.match(overview.session.daily.nextRecommendedAction.label, /继续|处理|开/);
  });
});

test('daily session summarizes recent completed actions and touched chapters', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    const jobs = createJobStore({ now: () => new Date('2026-05-19T10:00:00.000Z') });
    const job = jobs.createJob('chapter_decision', '生成第 2 章决策');
    jobs.complete(job.id, { chapter: 2 });

    const overview = await getCockpitOverview(root, {}, jobs);

    assert.equal(overview.session.daily.lastCompleted?.label, '生成创作决策');
    assert.deepEqual(overview.session.daily.chaptersTouched, [2]);
    assert.match(overview.session.daily.resumeText, /第 2 章/);
    assert.equal(overview.session.daily.lastCompletedActionLabel, '生成创作决策');
  });
});

test('cockpit overview reports missing style binding for the current book', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);

    const overview = await getCockpitOverview(root, {}, createJobStore());

    assert.deepEqual(overview.style.binding, null);
    assert.deepEqual(overview.style.currentProfile, null);
    assert.equal(overview.style.generation?.active, false);
    assert.equal(overview.style.generation?.label, '尚未绑定文风');
    assert.equal(overview.quality?.signals.some((signal) => signal.label === '尚未绑定文风'), true);
  });
});

test('cockpit overview reports global profiles and the current bound style', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    await writeStyleProfile(root, {
      id: 'rain-night-12345678',
      name: '雨夜冷调',
      description: '短句、冷感、带一点城市潮湿气味。',
      antiAiVoice: ['避免万能形容词和总结式抒情。'],
    });
    await mkdir(join(root, 'books/demo/.authoros/private'), { recursive: true });
    await writeFile(join(root, 'books/demo/.authoros/private/style-binding.json'), JSON.stringify({
      version: 1,
      profileId: 'rain-night-12345678',
      boundAt: '2026-05-18T08:00:00.000Z',
    }, null, 2), 'utf8');

    const overview = await getCockpitOverview(root, {}, createJobStore());

    assert.equal(overview.style.profiles.length, 1);
    assert.equal(overview.style.profiles[0].name, '雨夜冷调');
    assert.equal(overview.style.binding?.profileId, 'rain-night-12345678');
    assert.equal(overview.style.currentProfile?.name, '雨夜冷调');
    assert.equal(overview.style.generation?.active, false);
    assert.equal(overview.style.generation?.snapshotPresent, false);
    assert.equal(overview.style.generation?.label, '需要同步文风快照');
    assert.equal(overview.quality?.signals.some((signal) => signal.label === '已绑定文风：雨夜冷调'), true);
  });
});

test('cockpit overview reports active style generation when binding has a matching snapshot', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    const profile = await writeStyleProfile(root, {
      id: 'rain-night-12345678',
      name: '雨夜冷调',
      description: '短句、冷感、带一点城市潮湿气味。',
      antiAiVoice: ['避免万能形容词和总结式抒情。'],
    });
    await mkdir(join(root, 'books/demo/.authoros/private'), { recursive: true });
    await writeFile(join(root, 'books/demo/.authoros/private/style-binding.json'), JSON.stringify({
      version: 1,
      profileId: 'rain-night-12345678',
      boundAt: '2026-05-18T08:00:00.000Z',
      profile,
    }, null, 2), 'utf8');

    const overview = await getCockpitOverview(root, {}, createJobStore());

    assert.equal(overview.style.generation?.active, true);
    assert.equal(overview.style.generation?.snapshotPresent, true);
    assert.equal(overview.style.generation?.matchedBinding, true);
    assert.equal(overview.style.generation?.profileId, 'rain-night-12345678');
    assert.equal(overview.style.generation?.label, '已接入章节生成');
    assert.equal(overview.nextAction.kind, 'continue_book');
    assert.equal(overview.nextAction.styleHint, '下一章将使用文风：雨夜冷调');
  });
});

test('cockpit overview detects pending feedback', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    await mkdir(join(root, 'books/demo/.authoros/private'), { recursive: true });
    await writeFile(join(root, 'books/demo/.authoros/private/pending-feedback.json'), JSON.stringify({
      book_id: 'demo',
      chapter: 1,
      text: 'make it sharper',
      instruction: 'revise',
      created_at: '2026-05-14T03:00:00.000Z',
    }), 'utf8');

    const overview = await getCockpitOverview(root, {}, createJobStore());

    assert.equal(overview.current?.pendingFeedback, true);
    assert.equal(overview.nextAction.kind, 'apply_feedback');
    assert.equal(overview.quality?.pendingPreview?.kind, 'feedback');
    assert.equal(overview.quality?.pendingPreview?.chapter, 1);
  });
});

test('cockpit overview includes pending memory delta visibility', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    await mkdir(join(root, 'books/demo/memory'), { recursive: true });
    await writeFile(join(root, 'books/demo/memory/chapter-0001.delta.md'), '# delta', 'utf8');

    const overview = await getCockpitOverview(root, {}, createJobStore());

    assert.equal(overview.quality?.memoryDeltas.length, 1);
    assert.equal(overview.quality?.memoryDeltas[0].name, 'chapter-0001.delta.md');
  });
});

test('cockpit overview summarizes durable writing assets', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    await writeFile(join(root, 'books/demo/product.md'), '# 产品承诺\n悬疑长篇', 'utf8');
    await writeFile(join(root, 'books/demo/world.md'), '# 世界\n雨城', 'utf8');

    const overview = await getCockpitOverview(root, {}, createJobStore());

    assert.equal(overview.assets.total, 11);
    assert.equal(overview.assets.available, 2);
    assert.equal(overview.assets.items.find((item) => item.id === 'product')?.status, 'available');
    assert.equal(overview.assets.items.find((item) => item.id === 'characters')?.status, 'missing');
  });
});

test('cockpit overview derives book commitment from identity files', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    await writeFile(join(root, 'books/demo/product.md'), [
      '# 类型承诺',
      '悬疑成长。',
      '# 读者钩子',
      '每章都要给一个无法立刻解释的异常。',
      '# 禁区',
      '不要写成纯恋爱。',
    ].join('\n'), 'utf8');
    await writeFile(join(root, 'books/demo/outline.md'), '# 前十章方向\n主角追查黑伞。', 'utf8');

    const overview = await getCockpitOverview(root, {}, createJobStore());

    assert.match(overview.commitment?.genrePromise ?? '', /悬疑成长/);
    assert.match(overview.commitment?.readerHook ?? '', /异常/);
    assert.match(overview.commitment?.boundaries[0] ?? '', /纯恋爱/);
    assert.match(overview.commitment?.firstActDirection ?? '', /黑伞/);
  });
});

test('cockpit overview resolves model status from the current book directory', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    await mkdir(join(root, 'books/demo/.authoros'), { recursive: true });
    await writeFile(join(root, 'books/demo/.authoros/model.json'), JSON.stringify({
      provider: 'openai_compatible',
      model: 'book-model',
    }), 'utf8');

    const overview = await getCockpitOverview(root, {
      AUTHOROS_MODEL: 'root-model',
    }, createJobStore());

    assert.equal(overview.model.model, 'book-model');
  });
});

test('cockpit overview continues at the first missing draft chapter', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    await writeFile(join(root, 'books/demo/plans/0002.md'), 'plan two', 'utf8');
    await writeFile(join(root, 'books/demo/plans/0003.md'), 'plan three', 'utf8');
    await writeFile(join(root, 'books/demo/chapters/0003.md'), 'chapter three body', 'utf8');

    const overview = await getCockpitOverview(root, {}, createJobStore());

    assert.equal(overview.nextAction.kind, 'continue_book');
    assert.equal(overview.nextAction.chapter, 2);
  });
});

test('cockpit overview handles current book with no drafted chapters', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    await rm(join(root, 'books/demo/chapters/0001.md'));

    const overview = await getCockpitOverview(root, {}, createJobStore());

    assert.equal(overview.current?.latestChapter, null);
    assert.equal(overview.nextAction.kind, 'continue_book');
    assert.equal(overview.nextAction.chapter, 1);
  });
});
