import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEditOps, parseEditsBlock } from '../src/core/editOps.ts';

async function withTempDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'authoros-edit-ops-'));
  try {
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('parseEditsBlock accepts YAML array edit ops with block scalars', () => {
  const edits = parseEditsBlock([
    '- file: review_rules.md',
    '  op: append-after-heading',
    '  anchor: "## 必查项"',
    '  content: |',
    '    - **地理与街区使用**',
    '        - 测试条目。',
    '',
  ].join('\n'));

  assert.equal(edits.length, 1);
  assert.equal(edits[0]?.file, 'review_rules.md');
  assert.equal(edits[0]?.op, 'append-after-heading');
  assert.match(String(edits[0]?.content), /地理与街区使用/);
});

test('parseEditsBlock accepts literal blocks containing markdown bullets and blank lines', () => {
  const edits = parseEditsBlock([
    '- file: review_rules.md',
    '  op: replace-text',
    '  find: |',
    '    - 过度揭示或停滞不前的情况是否会导致剧情动力丧失。',
    '  replace: |',
    '    - 过度揭示或停滞不前的情况是否会导致剧情动力丧失。',
    '',
    '    - **地理与街区使用**',
    '        - 香港真实地理框架要服务调查。',
    '        - 场景所在地段要符合阶层映射。',
    '',
  ].join('\n'));

  assert.equal(edits[0]?.op, 'replace-text');
  assert.match(String(edits[0]?.replace), /地理与街区使用/);
  assert.match(String(edits[0]?.replace), /香港真实地理框架/);
});

test('parseEditsBlock accepts folded block scalars', () => {
  const edits = parseEditsBlock([
    '- file: product.md',
    '  op: replace-text',
    '  find: 旧定位',
    '  replace: >',
    '    新定位第一句',
    '    新定位第二句',
    '',
  ].join('\n'));

  assert.equal(edits[0]?.op, 'replace-text');
  assert.match(String(edits[0]?.replace), /新定位第一句 新定位第二句/);
});

test('parseEditsBlock accepts inline maps and arrays', () => {
  const edits = parseEditsBlock([
    '- file: characters.yaml',
    '  op: append-yaml-array-item',
    '  key: major',
    '  item: {id: M003, name: "周临"}',
    '- file: characters.yaml',
    '  op: set-yaml-key',
    '  key: antagonists',
    '  value: []',
    '',
  ].join('\n'));

  assert.equal(edits.length, 2);
  assert.deepEqual(edits[0]?.item, { id: 'M003', name: '周临' });
  assert.deepEqual(edits[1]?.value, []);
});

test('parseEditsBlock rejects non-array YAML roots', () => {
  assert.throws(
    () => parseEditsBlock('file: outline.md\nop: replace-text\n'),
    /must be a YAML array/,
  );
});

test('append-after-heading appends to the target section end', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'review_rules.md'), '# 章节评审规则\n\n## 必查项\n\n- 原项\n\n## 风险分级\n\n- 高: 断裂\n', 'utf8');
    await applyEditOps({
      baseDir: dir,
      scope: 'book',
      edits: parseEditsBlock('- file: review_rules.md\n  op: append-after-heading\n  anchor: "## 必查项"\n  content: |\n    - 新项\n'),
    });

    const text = await readFile(join(dir, 'review_rules.md'), 'utf8');
    assert.match(text, /## 必查项[\s\S]*- 原项[\s\S]*- 新项[\s\S]*## 风险分级/);
  });
});

test('prepend-before-heading inserts before the target heading', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'outline.md'), '# 主线大纲\n\n## 主线阶段\n\n旧\n', 'utf8');
    await applyEditOps({
      baseDir: dir,
      scope: 'book',
      edits: parseEditsBlock('- file: outline.md\n  op: prepend-before-heading\n  anchor: "## 主线阶段"\n  content: |\n    ## 节奏规则\n    每章推进一个证据。\n'),
    });

    assert.match(await readFile(join(dir, 'outline.md'), 'utf8'), /## 节奏规则[\s\S]*## 主线阶段/);
  });
});

test('replace-section replaces section body but keeps the heading', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'outline.md'), '# 主线大纲\n\n## 主线阶段\n\n旧阶段\n\n## 待规划章节\n\n旧章节\n', 'utf8');
    await applyEditOps({
      baseDir: dir,
      scope: 'book',
      edits: parseEditsBlock('- file: outline.md\n  op: replace-section\n  anchor: "## 主线阶段"\n  content: |\n    - 新阶段\n'),
    });

    const text = await readFile(join(dir, 'outline.md'), 'utf8');
    assert.match(text, /## 主线阶段\n\n- 新阶段\n\n## 待规划章节/);
    assert.doesNotMatch(text, /旧阶段/);
  });
});

test('replace-text replaces a unique text block', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'outline.md'), '# 主线大纲\n\n新港 重工\n旧线索\n', 'utf8');
    await applyEditOps({
      baseDir: dir,
      scope: 'book',
      edits: parseEditsBlock('- file: outline.md\n  op: replace-text\n  find: |\n    新港 重工\n    旧线索\n  replace: |\n    鼎新重工\n    新线索\n'),
    });

    assert.match(await readFile(join(dir, 'outline.md'), 'utf8'), /鼎新重工\n新线索/);
  });
});

test('create-file and append-to-file write console delta files with generated timestamp', async () => {
  await withTempDir(async (dir) => {
    const now = new Date('2026-05-13T06:00:00Z');
    await applyEditOps({
      baseDir: dir,
      scope: 'book',
      now,
      edits: parseEditsBlock('- file: memory/console-*.delta.md\n  op: create-file\n  content: |\n    # Console Delta\n'),
    });
    await applyEditOps({
      baseDir: dir,
      scope: 'book',
      now,
      edits: parseEditsBlock('- file: memory/console-*.delta.md\n  op: append-to-file\n  content: |\n    suggestion: 加重雨描写\n'),
    });

    const file = join(dir, 'memory/console-2026-05-13T060000.delta.md');
    assert.ok((await stat(file)).isFile());
    assert.match(await readFile(file, 'utf8'), /Console Delta[\s\S]*suggestion/);
  });
});

test('yaml edit ops update keys and array items', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'characters.yaml'), 'protagonist:\n  name: "顾衡"\n  desire: "破解密电"\nmajor:\n  - id: M001\n    name: "陆曼"\nantagonists: []\n', 'utf8');
    await applyEditOps({
      baseDir: dir,
      scope: 'book',
      edits: parseEditsBlock([
        '- file: characters.yaml',
        '  op: set-yaml-key',
        '  key: protagonist.name',
        '  value: "顾行"',
        '- file: characters.yaml',
        '  op: append-yaml-array-item',
        '  key: major',
        '  item:',
        '    id: M002',
        '    name: "新角色"',
        '- file: characters.yaml',
        '  op: delete-yaml-array-item',
        '  key: major',
        '  predicate: {id: M001}',
      ].join('\n')),
    });

    const text = await readFile(join(dir, 'characters.yaml'), 'utf8');
    assert.match(text, /name: "顾行"/);
    assert.match(text, /id: M002/);
    assert.doesNotMatch(text, /M001/);
  });
});

test('unknown op is rejected', () => {
  assert.throws(
    () => parseEditsBlock('- file: outline.md\n  op: rewrite-everything\n'),
    /unknown edit op/,
  );
});
