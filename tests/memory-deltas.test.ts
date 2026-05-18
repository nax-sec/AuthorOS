import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { run } from '../src/cli.ts';
import { listMemoryDeltas, markMemoryDeltaReviewed, mergeMemoryDelta, previewMemoryDeltaMerge } from '../src/commands/memory.ts';

async function withBook(body: (bookDir: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-memory-deltas-'));
  try {
    const init = silentIo();
    assert.equal(await run(['init', 'demo', '--quick'], root, init.io, { env: {} }), 0, init.err.join(''));
    await body(join(root, 'demo'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function silentIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (message: string) => out.push(message),
      stderr: (message: string) => err.push(message),
    },
    out,
    err,
  };
}

test('memory deltas lists console deltas and unmerged chapter deltas', async () => {
  await withBook(async (bookDir) => {
    await mkdir(join(bookDir, 'memory'), { recursive: true });
    await writeFile(join(bookDir, 'memory/console-2026-05-13T151819.delta.md'), '# Console Delta\n\ncanon proposal\n', 'utf8');
    await writeFile(join(bookDir, 'memory/chapter-0001.delta.md'), '# Chapter 1 Delta\n', 'utf8');
    await writeFile(join(bookDir, 'memory/chapter-0002.delta.md'), '# Chapter 2 Delta\n', 'utf8');
    await writeFile(join(bookDir, 'memory/canon.md'), '# 正史设定\n\n## 变更记录\n\n- merged: chapter-0001.delta.md\n', 'utf8');

    const io = silentIo();
    const exit = await run(['memory', 'deltas'], bookDir, io.io, { env: {} });

    assert.equal(exit, 0, io.err.join(''));
    const output = io.out.join('');
    assert.match(output, /Pending memory deltas:/);
    assert.match(output, /console-2026-05-13T151819\.delta\.md\s+\(created from console session, scope: book\)/);
    assert.doesNotMatch(output, /chapter-0001\.delta\.md/);
    assert.match(output, /chapter-0002\.delta\.md\s+\(chapter 2 memory delta, not yet merged\)/);
    assert.match(output, /Merge instructions:/);
    assert.match(output, /author memory deltas show <name>/);
  });
});

test('memory deltas show prints the requested delta file', async () => {
  await withBook(async (bookDir) => {
    await mkdir(join(bookDir, 'memory'), { recursive: true });
    await writeFile(join(bookDir, 'memory/console-2026-05-13T151819.delta.md'), '# Console Delta\n\ncanon proposal\n', 'utf8');

    const io = silentIo();
    const exit = await run(['memory', 'deltas', 'show', 'console-2026-05-13T151819.delta.md'], bookDir, io.io, { env: {} });

    assert.equal(exit, 0, io.err.join(''));
    assert.match(io.out.join(''), /# Console Delta[\s\S]*canon proposal/);
  });
});

test('memory deltas show reports missing delta names clearly', async () => {
  await withBook(async (bookDir) => {
    const io = silentIo();
    const exit = await run(['memory', 'deltas', 'show', 'console-missing.delta.md'], bookDir, io.io, { env: {} });

    assert.equal(exit, 1);
    assert.match(io.err.join(''), /memory delta not found: console-missing\.delta\.md/);
  });
});

test('marking a memory delta reviewed archives its content and removes it from pending list', async () => {
  await withBook(async (bookDir) => {
    await mkdir(join(bookDir, 'memory'), { recursive: true });
    await writeFile(
      join(bookDir, 'memory/chapter-0001.delta.md'),
      '# Chapter 1 Delta\n\n- canon: 能力代价已确认\n',
      'utf8',
    );

    const result = await markMemoryDeltaReviewed(bookDir, 'chapter-0001.delta.md', {
      now: new Date('2026-05-19T09:30:00Z'),
    });
    const pending = await listMemoryDeltas(bookDir);
    const canon = await readFile(join(bookDir, 'memory/canon.md'), 'utf8');

    assert.equal(result.name, 'chapter-0001.delta.md');
    assert.equal(result.alreadyReviewed, false);
    assert.match(canon, /## 已审阅记忆增量/);
    assert.match(canon, /### chapter-0001\.delta\.md/);
    assert.match(canon, /reviewed: chapter-0001\.delta\.md/);
    assert.match(canon, /2026-05-19T09:30:00\.000Z/);
    assert.match(canon, /```markdown\n# Chapter 1 Delta\n\n- canon: 能力代价已确认\n```/);
    assert.equal(pending.some((delta) => delta.name === 'chapter-0001.delta.md'), false);

    const second = await markMemoryDeltaReviewed(bookDir, 'chapter-0001.delta.md', {
      now: new Date('2026-05-19T09:31:00Z'),
    });
    const canonAfterSecondMark = await readFile(join(bookDir, 'memory/canon.md'), 'utf8');

    assert.equal(second.alreadyReviewed, true);
    assert.equal((canonAfterSecondMark.match(/### chapter-0001\.delta\.md/g) ?? []).length, 1);
    assert.equal((canonAfterSecondMark.match(/reviewed: chapter-0001\.delta\.md/g) ?? []).length, 1);
  });
});

test('merging a memory delta splits sections into memory files and archives the source', async () => {
  await withBook(async (bookDir) => {
    await mkdir(join(bookDir, 'memory'), { recursive: true });
    await writeFile(join(bookDir, 'memory/chapter-0001.delta.md'), [
      '# 章节 1 记忆更新建议',
      '',
      '## canon (新增 / 变更)',
      '- 能力代价已确认',
      '',
      '## foreshadowing (新增 / 推进 / 回收)',
      '- H001.status -> advanced',
      '',
      '## plot_threads (状态推进)',
      '- T001.current_stage -> 初次觉醒',
      '',
      '## character_state (变化)',
      '- protagonist.ability_state -> 初次觉醒',
      '',
      '## style (规则增 / 禁)',
      '- 避免章尾总结式抒情',
      '',
    ].join('\n'), 'utf8');

    const result = await mergeMemoryDelta(bookDir, 'chapter-0001.delta.md', {
      now: new Date('2026-05-19T10:00:00Z'),
    });
    const canon = await readFile(join(bookDir, 'memory/canon.md'), 'utf8');
    const foreshadowing = await readFile(join(bookDir, 'memory/foreshadowing.yaml'), 'utf8');
    const plotThreads = await readFile(join(bookDir, 'memory/plot_threads.yaml'), 'utf8');
    const characterState = await readFile(join(bookDir, 'memory/character_state.yaml'), 'utf8');
    const style = await readFile(join(bookDir, 'memory/style.md'), 'utf8');
    const pending = await listMemoryDeltas(bookDir);
    const foreshadowingDoc = parseYaml(foreshadowing) as { hooks: Array<{ id: string; status: string }> };
    const plotThreadsDoc = parseYaml(plotThreads) as { threads: Array<{ id: string; current_stage: string }> };
    const characterStateDoc = parseYaml(characterState) as { protagonist: { ability_state: string } };

    assert.equal(result.alreadyMerged, false);
    assert.deepEqual(result.changedFiles, [
      'memory/canon.md',
      'memory/foreshadowing.yaml',
      'memory/plot_threads.yaml',
      'memory/character_state.yaml',
      'memory/style.md',
    ]);
    assert.deepEqual(result.appliedSections, {
      canon: ['能力代价已确认'],
      foreshadowing: ['H001.status -> advanced'],
      plot_threads: ['T001.current_stage -> 初次觉醒'],
      character_state: ['protagonist.ability_state -> 初次觉醒'],
      style: ['避免章尾总结式抒情'],
    });
    assert.match(canon, /## 已确认设定[\s\S]*- 能力代价已确认[\s\S]*## 待确认设定/);
    assert.match(canon, /## 变更记录[\s\S]*- merged: chapter-0001\.delta\.md at 2026-05-19T10:00:00\.000Z/);
    assert.match(canon, /### chapter-0001\.delta\.md[\s\S]*```markdown[\s\S]*## character_state \(变化\)/);
    assert.equal(foreshadowingDoc.hooks.find((hook) => hook.id === 'H001')?.status, 'advanced');
    assert.equal(plotThreadsDoc.threads.find((thread) => thread.id === 'T001')?.current_stage, '初次觉醒');
    assert.equal(characterStateDoc.protagonist.ability_state, '初次觉醒');
    assert.doesNotMatch(foreshadowing, /# - H001\.status -> advanced/);
    assert.doesNotMatch(plotThreads, /# - T001\.current_stage -> 初次觉醒/);
    assert.doesNotMatch(characterState, /# - protagonist\.ability_state -> 初次觉醒/);
    assert.match(style, /## 变更记录[\s\S]*- merged: chapter-0001\.delta\.md at 2026-05-19T10:00:00\.000Z[\s\S]*  - 避免章尾总结式抒情/);
    assert.equal(pending.some((delta) => delta.name === 'chapter-0001.delta.md'), false);

    const second = await mergeMemoryDelta(bookDir, 'chapter-0001.delta.md', {
      now: new Date('2026-05-19T10:01:00Z'),
    });
    const canonAfterSecondMerge = await readFile(join(bookDir, 'memory/canon.md'), 'utf8');

    assert.equal(second.alreadyMerged, true);
    assert.equal((canonAfterSecondMerge.match(/- merged: chapter-0001\.delta\.md/g) ?? []).length, 1);
  });
});

test('merging a memory delta keeps unsupported YAML updates as comments', async () => {
  await withBook(async (bookDir) => {
    await mkdir(join(bookDir, 'memory'), { recursive: true });
    await writeFile(join(bookDir, 'memory/chapter-0001.delta.md'), [
      '# 章节 1 记忆更新建议',
      '',
      '## foreshadowing (新增 / 推进 / 回收)',
      '- H999.status -> missing hook',
      '- 新增一个尚未结构化的伏笔',
      '',
    ].join('\n'), 'utf8');

    await mergeMemoryDelta(bookDir, 'chapter-0001.delta.md', {
      now: new Date('2026-05-19T10:05:00Z'),
    });
    const foreshadowing = await readFile(join(bookDir, 'memory/foreshadowing.yaml'), 'utf8');
    const foreshadowingDoc = parseYaml(foreshadowing) as { hooks: Array<{ id: string; status: string }> };

    assert.equal(foreshadowingDoc.hooks.find((hook) => hook.id === 'H001')?.status, 'open');
    assert.match(foreshadowing, /# - H999\.status -> missing hook/);
    assert.match(foreshadowing, /# - 新增一个尚未结构化的伏笔/);
  });
});

test('previewing a memory delta merge reports planned writes without changing memory files', async () => {
  await withBook(async (bookDir) => {
    await mkdir(join(bookDir, 'memory'), { recursive: true });
    await writeFile(join(bookDir, 'memory/chapter-0001.delta.md'), [
      '# 章节 1 记忆更新建议',
      '',
      '## canon (新增 / 变更)',
      '- 预览正史条目',
      '',
      '## foreshadowing (新增 / 推进 / 回收)',
      '- H001.status -> previewed',
      '',
      '## style (规则增 / 禁)',
      '- 预览风格条目',
      '',
    ].join('\n'), 'utf8');
    const beforeCanon = await readFile(join(bookDir, 'memory/canon.md'), 'utf8');
    const beforeForeshadowing = await readFile(join(bookDir, 'memory/foreshadowing.yaml'), 'utf8');
    const beforeStyle = await readFile(join(bookDir, 'memory/style.md'), 'utf8');

    const preview = await previewMemoryDeltaMerge(bookDir, 'chapter-0001.delta.md');
    const afterCanon = await readFile(join(bookDir, 'memory/canon.md'), 'utf8');
    const afterForeshadowing = await readFile(join(bookDir, 'memory/foreshadowing.yaml'), 'utf8');
    const afterStyle = await readFile(join(bookDir, 'memory/style.md'), 'utf8');
    const pending = await listMemoryDeltas(bookDir);

    assert.equal(preview.name, 'chapter-0001.delta.md');
    assert.equal(preview.alreadyMerged, false);
    assert.deepEqual(preview.changedFiles, [
      'memory/canon.md',
      'memory/foreshadowing.yaml',
      'memory/style.md',
    ]);
    assert.deepEqual(preview.targetFiles, [
      { path: 'memory/canon.md', section: 'canon', items: ['预览正史条目'] },
      { path: 'memory/foreshadowing.yaml', section: 'foreshadowing', items: ['H001.status -> previewed'] },
      { path: 'memory/style.md', section: 'style', items: ['预览风格条目'] },
    ]);
    assert.equal(afterCanon, beforeCanon);
    assert.equal(afterForeshadowing, beforeForeshadowing);
    assert.equal(afterStyle, beforeStyle);
    assert.equal(pending.some((delta) => delta.name === 'chapter-0001.delta.md'), true);
  });
});
