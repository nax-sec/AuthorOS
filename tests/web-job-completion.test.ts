import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withJobCompletion } from '../src/web/job-completion.ts';

test('withJobCompletion explains book creation and first chapter completion', () => {
  const result = withJobCompletion('new_book_and_continue', {
    book: { title: 'Demo Book' },
    chapter: 1,
  });

  assert.equal(result.completion.title, '《Demo Book》已建好，第 1 章已写好。');
  assert.match(result.completion.detail, /最新章节已经载入工作区/);
  assert.match(result.completion.next, /读最新章/);
  assert.match(result.completion.next, /继续写/);
});

test('withJobCompletion keeps style previews explicitly preview-first', () => {
  const result = withJobCompletion('style_rewrite', {
    chapter: 2,
    pending: 'pending-style.json',
  });

  assert.equal(result.completion.title, '第 2 章文风改写预览已生成。');
  assert.match(result.completion.detail, /正文还没有被覆盖/);
  assert.match(result.completion.next, /应用文风修改/);
});

test('withJobCompletion points quality jobs to the opened artifact panel', () => {
  const review = withJobCompletion('reader_sim_review', {
    chapter: 1,
    artifacts: ['reviews/0001.reader-sim.md'],
  });
  const memory = withJobCompletion('memory_update', {
    chapter: 1,
    path: 'memory/chapter-0001.delta.md',
  });

  assert.match(review.completion.detail, /质量产物面板/);
  assert.match(review.completion.next, /查看产物/);
  assert.match(memory.completion.detail, /记忆更新面板/);
  assert.match(memory.completion.next, /审阅记忆更新/);
});
