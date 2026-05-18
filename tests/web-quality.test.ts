import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getProjectState } from '../src/commands/state.ts';
import { getQualityOverview } from '../src/web/quality.ts';
import { createJobStore, type JobStore, type WebJob } from '../src/web/jobs.ts';

async function withTempBook(body: (bookDir: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-quality-'));
  try {
    await mkdir(join(root, 'plans'), { recursive: true });
    await mkdir(join(root, 'chapters'), { recursive: true });
    await mkdir(join(root, 'reviews'), { recursive: true });
    await mkdir(join(root, 'decisions'), { recursive: true });
    await mkdir(join(root, 'memory'), { recursive: true });
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('quality overview derives next chapter card and stage states', async () => {
  await withTempBook(async (bookDir) => {
    await writeFile(join(bookDir, 'plans/0001.md'), 'plan one', 'utf8');
    await writeFile(join(bookDir, 'chapters/0001.md'), 'draft one', 'utf8');
    await writeFile(join(bookDir, 'reviews/0001.internal.md'), 'internal review', 'utf8');
    await writeFile(join(bookDir, 'plans/0002.md'), 'plan two', 'utf8');
    const state = await getProjectState(bookDir);

    const overview = await getQualityOverview(bookDir, state, createJobStore());

    assert.equal(overview.nextChapter.chapter, 2);
    assert.equal(overview.nextChapter.message, '继续写');
    assert.deepEqual(overview.nextChapter.blockers, []);
    assert.equal(overview.chapters[0].chapter, 1);
    assert.equal(overview.chapters[0].stages.find((stage) => stage.key === 'draft')?.status, 'done');
    assert.equal(overview.chapters[0].stages.find((stage) => stage.key === 'readerSimReview')?.status, 'missing');
    assert.equal(overview.chapters[1].stages.find((stage) => stage.key === 'draft')?.status, 'next');
  });
});

test('quality overview exposes executable actions for review closure', async () => {
  await withTempBook(async (bookDir) => {
    await writeFile(join(bookDir, 'plans/0001.md'), 'plan one', 'utf8');
    await writeFile(join(bookDir, 'chapters/0001.md'), 'draft one', 'utf8');

    const draftState = await getProjectState(bookDir);
    let overview = await getQualityOverview(bookDir, draftState, createJobStore());

    assert.deepEqual(overview.actions.map((action) => action.type), ['internal_review', 'reader_sim_review']);
    assert.deepEqual(overview.actions.map((action) => action.message), ['生成第 1 章内评', '生成第 1 章读者模拟']);

    await writeFile(join(bookDir, 'reviews/0001.internal.md'), 'internal review', 'utf8');
    await writeFile(join(bookDir, 'reviews/0001.reader-sim.md'), 'reader review', 'utf8');

    const reviewedState = await getProjectState(bookDir);
    overview = await getQualityOverview(bookDir, reviewedState, createJobStore());

    assert.equal(overview.actions.some((action) => action.type === 'chapter_decision' && action.message === '生成第 1 章决策'), true);

    await writeFile(join(bookDir, 'decisions/0001.md'), 'decision', 'utf8');

    const decidedState = await getProjectState(bookDir);
    overview = await getQualityOverview(bookDir, decidedState, createJobStore());

    assert.equal(overview.actions.some((action) => action.type === 'memory_update' && action.message === '生成第 1 章记忆更新'), true);

    await writeFile(join(bookDir, 'memory/chapter-0001.delta.md'), '# delta', 'utf8');

    const memoryPendingState = await getProjectState(bookDir);
    overview = await getQualityOverview(bookDir, memoryPendingState, createJobStore());

    assert.equal(overview.actions.some((action) => action.type === 'memory_update'), false);
  });
});

test('quality overview lists readable review and decision artifacts', async () => {
  await withTempBook(async (bookDir) => {
    await writeFile(join(bookDir, 'plans/0001.md'), 'plan one', 'utf8');
    await writeFile(join(bookDir, 'chapters/0001.md'), 'draft one', 'utf8');
    await writeFile(join(bookDir, 'reviews/0001.internal.md'), 'internal review', 'utf8');
    await writeFile(join(bookDir, 'reviews/0001.reader-sim.md'), 'reader review', 'utf8');
    await writeFile(join(bookDir, 'decisions/0001.md'), 'decision', 'utf8');
    const state = await getProjectState(bookDir);

    const overview = await getQualityOverview(bookDir, state, createJobStore());

    assert.deepEqual(overview.artifacts, [
      {
        type: 'internal_review',
        label: '第 1 章内评',
        chapter: 1,
        path: 'reviews/0001.internal.md',
      },
      {
        type: 'reader_sim_review',
        label: '第 1 章读者模拟',
        chapter: 1,
        path: 'reviews/0001.reader-sim.md',
      },
      {
        type: 'chapter_decision',
        label: '第 1 章决策',
        chapter: 1,
        path: 'decisions/0001.md',
      },
    ]);
  });
});

test('quality overview signals missing style binding', async () => {
  await withTempBook(async (bookDir) => {
    const state = await getProjectState(bookDir);

    const overview = await getQualityOverview(bookDir, state, createJobStore(), {
      binding: null,
      currentProfile: null,
    });

    assert.equal(overview.signals.some((signal) => signal.kind === 'warning' && signal.label === '尚未绑定文风'), true);
  });
});

test('quality overview signals bound style profile name', async () => {
  await withTempBook(async (bookDir) => {
    const state = await getProjectState(bookDir);

    const overview = await getQualityOverview(bookDir, state, createJobStore(), {
      binding: { version: 1, profileId: 'rain-night-12345678', boundAt: '2026-05-18T08:00:00.000Z' },
      currentProfile: { id: 'rain-night-12345678', name: '雨夜冷调' },
    });

    assert.equal(overview.signals.some((signal) => signal.kind === 'ok' && signal.label === '已绑定文风：雨夜冷调'), true);
  });
});

test('quality overview prioritizes missing plans before the next draft', async () => {
  await withTempBook(async (bookDir) => {
    await writeFile(join(bookDir, 'chapters/0001.md'), 'draft one', 'utf8');
    const state = await getProjectState(bookDir);

    const overview = await getQualityOverview(bookDir, state, createJobStore());

    assert.equal(overview.nextChapter.chapter, 1);
    assert.equal(overview.nextChapter.state, 'needs_plan');
    assert.equal(overview.nextChapter.blockers.includes('第 1 章缺少计划'), true);
    assert.match(overview.nextChapter.stages.find((stage) => stage.key === 'plan')?.status ?? '', /^(next|missing)$/);
    assert.notEqual(overview.nextChapter.stages.find((stage) => stage.key === 'draft')?.status, 'next');
  });
});

test('quality overview reports pending feedback preview without applying it', async () => {
  await withTempBook(async (bookDir) => {
    await writeFile(join(bookDir, 'plans/0001.md'), 'plan one', 'utf8');
    await writeFile(join(bookDir, 'chapters/0001.md'), 'draft one', 'utf8');
    await mkdir(join(bookDir, '.authoros/private'), { recursive: true });
    await writeFile(join(bookDir, '.authoros/private/pending-feedback.json'), JSON.stringify({
      book_id: 'demo',
      chapter: 1,
      text: '结尾压力不够',
      instruction: 'revise chapter 1',
      created_at: '2026-05-18T08:00:00.000Z',
      original_hash: 'abc123',
      preview_content: '# 第 1 章\n\n修改后的正文',
      rationale: '强化结尾压力',
      original_char_count: 9,
      revised_char_count: 12,
    }), 'utf8');
    const state = await getProjectState(bookDir);

    const overview = await getQualityOverview(bookDir, state, createJobStore());

    assert.equal(overview.pendingPreview?.kind, 'feedback');
    assert.equal(overview.pendingPreview?.chapter, 1);
    assert.equal(overview.pendingPreview?.text, '结尾压力不够');
    assert.equal(overview.pendingPreview?.previewContent, '# 第 1 章\n\n修改后的正文');
    assert.equal(overview.pendingPreview?.rationale, '强化结尾压力');
    assert.equal(overview.signals.some((signal) => signal.kind === 'warning' && signal.label.includes('修改预览')), true);
  });
});

test('quality overview reports pending style rewrite preview metadata', async () => {
  await withTempBook(async (bookDir) => {
    await writeFile(join(bookDir, 'plans/0001.md'), 'plan one', 'utf8');
    await writeFile(join(bookDir, 'chapters/0001.md'), 'draft one', 'utf8');
    await mkdir(join(bookDir, '.authoros/private'), { recursive: true });
    await writeFile(join(bookDir, '.authoros/private/pending-style-rewrite.json'), JSON.stringify({
      version: 1,
      book_id: 'demo',
      chapter: 1,
      profile_id: 'rain-night-12345678',
      profile_name: '雨夜冷调',
      intent: 'remove_ai_voice',
      text: '去掉 AI 味',
      instruction: 'remove ai voice for chapter 1',
      created_at: '2026-05-18T08:00:00.000Z',
      original_hash: 'abc123',
      preview_content: '# 第 1 章\n\n改写后的正文',
      rationale: '减少模板化表达',
      original_char_count: 9,
      revised_char_count: 12,
    }), 'utf8');
    const state = await getProjectState(bookDir);

    const overview = await getQualityOverview(bookDir, state, createJobStore());

    assert.equal(overview.styleRewritePreview?.kind, 'style_rewrite');
    assert.equal(overview.styleRewritePreview?.chapter, 1);
    assert.equal(overview.styleRewritePreview?.profileName, '雨夜冷调');
    assert.equal(overview.styleRewritePreview?.intent, 'remove_ai_voice');
    assert.equal(overview.styleRewritePreview?.rationale, '减少模板化表达');
    assert.equal(overview.styleRewritePreview?.previewContent, '# 第 1 章\n\n改写后的正文');
    assert.equal(overview.styleRewritePreview?.revisedCharCount, 12);
    assert.equal(
      overview.signals.some((signal) => signal.kind === 'warning' && signal.label === '第 1 章有文风改写预览待确认'),
      true,
    );
  });
});

test('quality overview rejects invalid pending feedback JSON distinctly', async () => {
  await withTempBook(async (bookDir) => {
    await mkdir(join(bookDir, '.authoros/private'), { recursive: true });
    await writeFile(join(bookDir, '.authoros/private/pending-feedback.json'), '{bad', 'utf8');
    const state = await getProjectState(bookDir);

    await assert.rejects(
      () => getQualityOverview(bookDir, state, createJobStore()),
      /Invalid pending private feedback JSON\./,
    );
  });
});

test('quality overview rejects malformed pending feedback structure', async () => {
  const cases = [
    { name: 'null', content: 'null' },
    { name: 'non-object', content: JSON.stringify('feedback') },
    {
      name: 'chapter zero',
      content: JSON.stringify({
        chapter: 0,
        text: '结尾压力不够',
        instruction: 'revise chapter 1',
        created_at: '2026-05-18T08:00:00.000Z',
      }),
    },
  ];

  for (const item of cases) {
    await withTempBook(async (bookDir) => {
      await mkdir(join(bookDir, '.authoros/private'), { recursive: true });
      await writeFile(join(bookDir, '.authoros/private/pending-feedback.json'), item.content, 'utf8');
      const state = await getProjectState(bookDir);

      await assert.rejects(
        () => getQualityOverview(bookDir, state, createJobStore()),
        /Invalid pending private feedback\./,
        item.name,
      );
    });
  }
});

test('quality overview lists pending memory deltas', async () => {
  await withTempBook(async (bookDir) => {
    await writeFile(join(bookDir, 'plans/0001.md'), 'plan one', 'utf8');
    await writeFile(join(bookDir, 'chapters/0001.md'), 'draft one', 'utf8');
    await writeFile(join(bookDir, 'memory/chapter-0001.delta.md'), '# delta', 'utf8');
    const state = await getProjectState(bookDir);

    const overview = await getQualityOverview(bookDir, state, createJobStore());

    assert.equal(overview.memoryDeltas.length, 1);
    assert.equal(overview.memoryDeltas[0].name, 'chapter-0001.delta.md');
    assert.equal(overview.signals.some((signal) => signal.kind === 'warning' && signal.label.includes('记忆更新待审阅')), true);
  });
});

test('quality overview gives recovery guidance for the latest failed job', async () => {
  await withTempBook(async (bookDir) => {
    const jobs = createJobStore({ now: () => new Date('2026-05-18T09:00:00Z') });
    const job = jobs.createJob('continue_book', '开始写下一章');
    jobs.append(job.id, 'planning', '正在规划下一章');
    jobs.fail(job.id, 'model timeout');
    const state = await getProjectState(bookDir);

    const overview = await getQualityOverview(bookDir, state, jobs);

    assert.equal(overview.recovery?.jobId, job.id);
    assert.equal(overview.recovery?.failedPhase, 'planning');
    assert.equal(overview.recovery?.message, 'model timeout');
    assert.match(overview.recovery?.suggestion ?? '', /继续写/);
  });
});

test('quality overview returns concrete recovery actions for failed jobs', async () => {
  await withTempBook(async (bookDir) => {
    const jobs = createJobStore({ now: () => new Date('2026-05-18T09:00:00Z') });
    const job = jobs.createJob('continue_book', '开始写下一章');
    jobs.append(job.id, 'planning', '正在规划下一章');
    jobs.fail(job.id, 'missing API key', {
      kind: 'model_config',
      title: '模型配置不完整。',
      detail: 'missing API key',
      next: '检查 API key 后重试。',
    });
    const state = await getProjectState(bookDir);

    const overview = await getQualityOverview(bookDir, state, jobs);

    assert.deepEqual(overview.recovery?.actions, [
      { type: 'send', label: '一键重试', message: '继续写', primary: true },
      { type: 'model_config', label: '检查模型配置' },
      { type: 'read_latest', label: '读最新章' },
      { type: 'resume', label: '回到当前书' },
    ]);
  });
});

test('quality overview chooses the newest failed job from an unsorted job list', async () => {
  await withTempBook(async (bookDir) => {
    const oldJob = failedJob({
      id: 'job-9',
      action: 'read_chapter',
      createdAt: '2026-05-18T08:00:00.000Z',
      phase: 'reading',
      error: 'old failure',
    });
    const newestJob = failedJob({
      id: 'job-2',
      action: 'continue_book',
      createdAt: '2026-05-18T09:00:00.000Z',
      phase: 'planning',
      error: 'new failure',
    });
    const jobs = fakeJobStore([oldJob, newestJob]);
    const state = await getProjectState(bookDir);

    const overview = await getQualityOverview(bookDir, state, jobs);

    assert.equal(overview.recovery?.jobId, 'job-2');
    assert.equal(overview.recovery?.failedPhase, 'planning');
    assert.equal(overview.recovery?.message, 'new failure');
  });
});

function fakeJobStore(jobs: WebJob[]): JobStore {
  return {
    createJob() {
      throw new Error('unused');
    },
    append() {
      throw new Error('unused');
    },
    complete() {
      throw new Error('unused');
    },
    fail() {
      throw new Error('unused');
    },
    get(id) {
      return jobs.find((job) => job.id === id);
    },
    list() {
      return jobs;
    },
    listEvents() {
      throw new Error('unused');
    },
    subscribe() {
      throw new Error('unused');
    },
  };
}

function failedJob(input: {
  id: string;
  action: string;
  createdAt: string;
  phase: string;
  error: string;
}): WebJob {
  return {
    id: input.id,
    action: input.action,
    status: 'failed',
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    events: [
      { type: 'received', message: 'received', at: input.createdAt },
      { type: input.phase, message: input.phase, at: input.createdAt },
      { type: 'failed', message: input.error, at: input.createdAt },
    ],
    error: input.error,
  };
}
