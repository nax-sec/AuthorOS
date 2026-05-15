import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJobStore } from '../src/web/jobs.ts';

test('job store records lifecycle events', () => {
  const jobs = createJobStore({ now: () => new Date('2026-05-14T10:00:00Z') });

  const job = jobs.createJob('continue_book', '开始写下一章');
  jobs.append(job.id, 'planning', '正在规划章节');
  jobs.complete(job.id, { chapter: 1 });

  const stored = jobs.get(job.id);
  assert.equal(stored?.status, 'completed');
  assert.equal(stored?.events.map((event) => event.type).join(','), 'received,planning,completed');
  assert.deepEqual(stored?.result, { chapter: 1 });
});

test('job store records failed jobs with message', () => {
  const jobs = createJobStore({ now: () => new Date('2026-05-14T10:00:00Z') });

  const job = jobs.createJob('feedback_preview', '开始生成修改预览');
  jobs.fail(job.id, 'model timeout');

  const stored = jobs.get(job.id);
  assert.equal(stored?.status, 'failed');
  assert.equal(stored?.error, 'model timeout');
  assert.equal(stored?.events.at(-1)?.type, 'failed');
  assert.equal(stored?.events.at(-1)?.message, 'model timeout');
});

test('job store notifies subscribers when new events are appended', () => {
  const jobs = createJobStore({ now: () => new Date('2026-05-14T10:00:00Z') });
  const job = jobs.createJob('continue_book', '开始写下一章');
  const seen: string[] = [];

  const unsubscribe = jobs.subscribe(job.id, (event) => seen.push(event.type));
  jobs.append(job.id, 'planning', '正在规划章节');
  unsubscribe();
  jobs.append(job.id, 'writing', '正在写作');

  assert.deepEqual(seen, ['planning']);
});
