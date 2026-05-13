import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('README documents author layer initialization in section 1', async () => {
  const readme = await readFile('README.md', 'utf8');
  assert.match(readme, /v0\.3[\s\S]*作者层/);
  assert.match(readme, /author author init/);
});

test('README documents the three-layer identity model', async () => {
  const readme = await readFile('README.md', 'utf8');
  assert.match(readme, /## 2\.5\./);
  assert.match(readme, /作者层/);
  assert.match(readme, /书层/);
  assert.match(readme, /运行层/);
});

test('README documents author console as section 13', async () => {
  const readme = await readFile('README.md', 'utf8');
  assert.match(readme, /## 13\./);
  assert.match(readme, /author console/);
  assert.match(readme, /\[scope\][\s\S]*\[impact\][\s\S]*\[edits\][\s\S]*\[next\]/);
  assert.match(readme, /--rollback/);
});

test('README documents template management as section 14', async () => {
  const readme = await readFile('README.md', 'utf8');
  assert.match(readme, /## 14\./);
  assert.match(readme, /author template list/);
  assert.match(readme, /author template promote/);
  assert.match(readme, /candidate template/);
});

test('README FAQ explains strategy bleed prevention and candidate templates', async () => {
  const readme = await readFile('README.md', 'utf8');
  assert.match(readme, /为什么我的概念没生成异能内容/);
  assert.match(readme, /Strategy Pass/);
  assert.match(readme, /banned vocabulary/);
  assert.match(readme, /candidate template 是什么/);
});

test('CHANGELOG summarizes v0.3.0', async () => {
  const changelog = await readFile('CHANGELOG.md', 'utf8');
  assert.match(changelog, /## v0\.3\.0/);
  assert.match(changelog, /作者层/);
  assert.match(changelog, /Strategy Pass/);
  assert.match(changelog, /author console/);
  assert.match(changelog, /changes\//);
});
