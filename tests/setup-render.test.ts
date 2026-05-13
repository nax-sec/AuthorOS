import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSetupResult } from '../src/commands/setup.ts';

test('renderSetupResult labels aborted distill leaks as warning', () => {
  const text = renderSetupResult({
    mode: 'concept',
    files: [
      { file: 'product.md', title: '作品定位', source: 'concept', charCount: 10 },
    ],
    distill: {
      shouldCreate: false,
      reason: 'distill skipped: concrete leak after retry: 新港镇',
      leakedTerms: ['新港镇'],
    },
  });

  assert.match(text, /Distill warning:/);
  assert.doesNotMatch(text, /Distill: no new template needed/);
});

test('renderSetupResult labels skipped distill failures as warning', () => {
  const text = renderSetupResult({
    mode: 'concept',
    files: [
      { file: 'product.md', title: '作品定位', source: 'concept', charCount: 10 },
    ],
    distill: {
      shouldCreate: false,
      reason: 'distill skipped: setup distill returned invalid JSON.',
    },
  });

  assert.match(text, /Distill warning:/);
  assert.doesNotMatch(text, /Distill: no new template needed/);
});
