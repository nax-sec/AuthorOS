import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadWebJobHistory, saveWebJobHistory, webJobHistoryPath } from '../src/web/job-persistence.ts';
import type { WebJob } from '../src/web/jobs.ts';

async function withTempRoot(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-web-jobs-'));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function job(id: string, createdAt: string): WebJob {
  return {
    id,
    action: 'continue_book',
    status: 'completed',
    createdAt,
    updatedAt: createdAt,
    events: [{ type: 'completed', message: '完成', at: createdAt }],
    result: { chapter: Number(id.replace('job-', '')) },
  };
}

test('web job history returns empty when missing', async () => {
  await withTempRoot(async (root) => {
    assert.deepEqual(loadWebJobHistory(root), []);
  });
});

test('web job history saves and loads recent jobs', async () => {
  await withTempRoot(async (root) => {
    saveWebJobHistory(root, [
      job('job-1', '2026-05-14T10:00:00.000Z'),
      job('job-2', '2026-05-14T11:00:00.000Z'),
    ]);

    assert.deepEqual(loadWebJobHistory(root).map((item) => item.id), ['job-1', 'job-2']);
    const raw = JSON.parse(await readFile(webJobHistoryPath(root), 'utf8'));
    assert.equal(raw.version, 1);
    assert.equal(raw.jobs.length, 2);
  });
});

test('web job history keeps only the newest limit by creation time', async () => {
  await withTempRoot(async (root) => {
    saveWebJobHistory(root, [
      job('job-1', '2026-05-14T10:00:00.000Z'),
      job('job-2', '2026-05-14T11:00:00.000Z'),
      job('job-3', '2026-05-14T12:00:00.000Z'),
    ], 2);

    assert.deepEqual(loadWebJobHistory(root).map((item) => item.id), ['job-2', 'job-3']);
  });
});

test('web job history rejects invalid json shape', async () => {
  await withTempRoot(async (root) => {
    const path = webJobHistoryPath(root);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ version: 1, jobs: [{ id: 7 }] }), 'utf8');

    assert.throws(() => loadWebJobHistory(root), /Invalid web job history/);
  });
});

test('web job history rejects non-string job error', async () => {
  await withTempRoot(async (root) => {
    const path = webJobHistoryPath(root);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({
      version: 1,
      jobs: [{
        ...job('job-1', '2026-05-14T10:00:00.000Z'),
        error: 123,
      }],
    }), 'utf8');

    assert.throws(() => loadWebJobHistory(root), /Invalid web job history/);
  });
});

test('web job history reports invalid json syntax separately', async () => {
  await withTempRoot(async (root) => {
    const path = webJobHistoryPath(root);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '{not json', 'utf8');

    assert.throws(() => loadWebJobHistory(root), /Invalid web job history JSON/);
  });
});
