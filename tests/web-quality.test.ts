import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getProjectState } from '../src/commands/state.ts';
import { getQualityOverview } from '../src/web/quality.ts';
import { createJobStore } from '../src/web/jobs.ts';

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
    }), 'utf8');
    const state = await getProjectState(bookDir);

    const overview = await getQualityOverview(bookDir, state, createJobStore());

    assert.equal(overview.pendingPreview?.kind, 'feedback');
    assert.equal(overview.pendingPreview?.chapter, 1);
    assert.equal(overview.pendingPreview?.text, '结尾压力不够');
    assert.equal(overview.signals.some((signal) => signal.kind === 'warning' && signal.label.includes('修改预览')), true);
  });
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
