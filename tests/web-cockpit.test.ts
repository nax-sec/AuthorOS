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

test('cockpit overview handles an empty bookshelf', async () => {
  await withTempRoot(async (root) => {
    const overview = await getCockpitOverview(root, {}, createJobStore());

    assert.equal(overview.current, null);
    assert.equal(overview.nextAction.kind, 'new_book');
    assert.equal(overview.books.length, 0);
    assert.equal(overview.quality, null);
  });
});

test('cockpit overview reports current book latest chapter and model status', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    const jobs = createJobStore({ now: () => new Date('2026-05-14T02:00:00Z') });
    const job = jobs.createJob('continue_book', '开始写下一章');
    jobs.complete(job.id, { chapter: 1 });

    const overview = await getCockpitOverview(root, {
      OPENAI_API_KEY: 'key',
      AUTHOROS_MODEL: 'gpt-test',
    }, jobs);

    assert.equal(overview.current?.book.title, 'Demo Book');
    assert.equal(overview.current?.latestChapter?.chapter, 1);
    assert.equal(overview.current?.latestChapter?.excerpt, 'chapter one body');
    assert.equal(overview.model.apiKeySet, true);
    assert.equal(overview.model.model, 'gpt-test');
    assert.equal(overview.jobs[0].id, job.id);
    assert.equal(overview.nextAction.kind, 'continue_book');
    assert.equal(overview.quality?.nextChapter.chapter, 2);
    assert.equal((overview.quality?.signals[0].label.length ?? 0) > 0, true);
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
