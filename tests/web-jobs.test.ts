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

test('job store records structured failed job details', () => {
  const jobs = createJobStore({ now: () => new Date('2026-05-14T10:00:00Z') });
  const failure = {
    kind: 'model_length',
    title: '模型输出被截断。',
    detail: 'finish_reason: length',
    next: '降低章节字数或换更大上下文模型后重试。',
  };

  const job = jobs.createJob('continue_book', '开始写下一章');
  jobs.fail(job.id, failure.title, failure);

  const stored = jobs.get(job.id);
  assert.deepEqual(stored?.failure, failure);
  assert.deepEqual(stored?.events.at(-1)?.data, failure);
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

test('job store lists newest jobs first', () => {
  const dates = [
    new Date('2026-05-14T10:00:00Z'),
    new Date('2026-05-14T10:01:00Z'),
    new Date('2026-05-14T10:02:00Z'),
  ];
  let index = 0;
  const jobs = createJobStore({ now: () => dates[index++] ?? dates.at(-1)! });

  const first = jobs.createJob('continue_book', '开始写下一章');
  const second = jobs.createJob('feedback_preview', '生成修改预览');

  assert.deepEqual(jobs.list().map((job) => job.id), [second.id, first.id]);
});

test('job store lists same-timestamp jobs newest first by id', () => {
  const jobs = createJobStore({ now: () => new Date('2026-05-14T10:00:00Z') });

  const first = jobs.createJob('continue_book', '开始写下一章');
  const second = jobs.createJob('feedback_preview', '生成修改预览');

  assert.deepEqual(jobs.list().map((job) => job.id), [second.id, first.id]);
});

test('job store hydrates existing jobs and continues ids', () => {
  const jobs = createJobStore({
    now: () => new Date('2026-05-14T11:00:00Z'),
    initialJobs: [{
      id: 'job-7',
      action: 'continue_book',
      status: 'completed',
      createdAt: '2026-05-14T10:00:00.000Z',
      updatedAt: '2026-05-14T10:05:00.000Z',
      events: [{
        type: 'completed',
        message: '完成',
        at: '2026-05-14T10:05:00.000Z',
      }],
      result: { chapter: 1 },
    }],
  });

  const next = jobs.createJob('read_chapter', '读取最新章');

  assert.equal(next.id, 'job-8');
  assert.equal(jobs.get('job-7')?.status, 'completed');
});

test('job store calls onChange after mutations', () => {
  const snapshots: string[][] = [];
  const jobs = createJobStore({
    now: () => new Date('2026-05-14T10:00:00Z'),
    onChange: (items) => snapshots.push(items.map((job) => `${job.id}:${job.status}`)),
  });

  const job = jobs.createJob('continue_book', '开始写下一章');
  jobs.complete(job.id, { chapter: 1 });

  assert.deepEqual(snapshots, [
    ['job-1:running'],
    ['job-1:completed'],
  ]);
});

test('job store mutation methods return clones', () => {
  const jobs = createJobStore({ now: () => new Date('2026-05-14T10:00:00Z') });
  const fakeEvent = {
    type: 'fake',
    message: 'should not leak',
    at: '2026-05-14T10:30:00.000Z',
  };

  const created = jobs.createJob('continue_book', '开始写下一章');
  created.events.push(fakeEvent);

  const appended = jobs.append(created.id, 'planning', '正在规划章节');
  appended.events.push(fakeEvent);

  const completed = jobs.complete(created.id, { chapter: 1 });
  completed.events.push(fakeEvent);

  const failed = jobs.fail(created.id, 'retry later');
  failed.events.push(fakeEvent);

  assert.deepEqual(jobs.get(created.id)?.events.map((event) => event.type), [
    'received',
    'planning',
    'completed',
    'failed',
  ]);
});

test('job store listEvents returns cloned events', () => {
  const jobs = createJobStore({ now: () => new Date('2026-05-14T10:00:00Z') });
  const job = jobs.createJob('continue_book', '开始写下一章');

  const events = jobs.listEvents(job.id);
  events[0]!.type = 'fake';
  events[0]!.message = 'should not leak';

  assert.deepEqual(jobs.listEvents(job.id).map((event) => `${event.type}:${event.message}`), [
    'received:开始写下一章',
  ]);
});
