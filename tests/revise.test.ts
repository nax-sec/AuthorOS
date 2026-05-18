import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';
import { reviseChapter } from '../src/commands/revise.ts';
import type { LlmClient } from '../src/core/llm.ts';

async function withReviewedChapter(body: (cwd: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-v2-revise-test-'));
  try {
    const io = silentIo();
    assert.equal(await run(['init', 'demo', '--quick'], root, io.io, { env: {} }), 0, io.err.join(''));
    const cwd = join(root, 'demo');
    await writeFile(join(cwd, 'plans/0001.md'), '# 章节 1 计划\n\n## 章节目标\n首次反制。', 'utf8');
    await writeFile(
      join(cwd, 'chapters/0001.md'),
      [
        '# 章节 1',
        '',
        '> generated: 2026-05-11T00:00:00.000Z',
        '> agent: chief-writer',
        '> source: model',
        '',
        '正文第一段。',
        '',
        '正文第二段。',
        '',
        '正文第三段。结尾钩子',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(cwd, 'reviews/0001.internal.md'),
      '# 内部评审\n\n## 编辑决议\n## 已采纳\n- 风格小改\n## 阻塞风险\n- 无',
      'utf8',
    );
    await writeFile(
      join(cwd, 'reviews/0001.reader-sim.md'),
      '# 模拟读者\n\n## 爽点读者\n爽。',
      'utf8',
    );
    await body(cwd);
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

function fakeLlm(reply: string, capture?: (prompt: string) => void): LlmClient {
  return {
    async generate(prompt) {
      capture?.(prompt);
      return reply;
    },
  };
}

test('revise without --model is a no-op scaffold', async () => {
  await withReviewedChapter(async (cwd) => {
    const before = await readFile(join(cwd, 'chapters/0001.md'), 'utf8');
    const io = silentIo();
    assert.equal(await run(['revise', '--chapter', '1', '--write'], cwd, io.io, { env: {} }), 0);
    const after = await readFile(join(cwd, 'chapters/0001.md'), 'utf8');
    assert.equal(after, before);
    assert.match(io.out.join(''), /changed: no/);
    assert.match(io.out.join(''), /source: scaffold/);
    await assert.rejects(() => stat(join(cwd, 'chapters/0001.draft.md')));
  });
});

test('revise --model with NO output leaves chapter intact', async () => {
  await withReviewedChapter(async (cwd) => {
    const before = await readFile(join(cwd, 'chapters/0001.md'), 'utf8');
    let captured = '';
    const llm = fakeLlm(
      'REVISION_NEEDED: no\nrationale:\n所有 advisor 建议都是非阻塞的风格偏好。',
      (p) => { captured = p; },
    );
    const io = silentIo();
    assert.equal(
      await run(['revise', '--chapter', '1', '--model', '--write'], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
      }),
      0,
      io.err.join(''),
    );
    assert.match(captured, /REVISE_CHAPTER/);
    assert.match(captured, /original_chapter:/);
    assert.match(captured, /internal_review:/);
    assert.match(captured, /reader_sim_review:/);
    assert.doesNotMatch(captured, /revision_directive/);
    const after = await readFile(join(cwd, 'chapters/0001.md'), 'utf8');
    assert.equal(after, before);
    assert.match(io.out.join(''), /changed: no/);
    assert.match(io.out.join(''), /所有 advisor 建议都是非阻塞的风格偏好/);
    await assert.rejects(() => stat(join(cwd, 'chapters/0001.draft.md')));
  });
});

test('revise --instruction forces a directive-driven revision', async () => {
  await withReviewedChapter(async (cwd) => {
    let captured = '';
    const llm = fakeLlm([
      'REVISION_NEEDED: yes',
      'rationale:',
      '- 按导演席指令改写代价表达',
      '---',
      '正文第一段。',
      '',
      '正文第二段加入精神焚烧的后果。',
      '',
      '正文第三段。结尾钩子',
    ].join('\n'), (p) => { captured = p; });

    const io = silentIo();
    assert.equal(
      await run([
        'revise',
        '--chapter',
        '1',
        '--model',
        '--write',
        '--instruction',
        '把主角的能力代价从年寿改成精神焚烧',
      ], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
      }),
      0,
      io.err.join(''),
    );

    assert.match(captured, /revision_directive \(override from author console\):/);
    assert.match(captured, /把主角的能力代价从年寿改成精神焚烧/);
    assert.match(captured, /MUST revise the chapter to comply with it/);
    assert.match(captured, /internal_review:/);

    const revised = await readFile(join(cwd, 'chapters/0001.md'), 'utf8');
    assert.match(revised, /精神焚烧/);
    assert.match(io.out.join(''), /changed: yes/);
  });
});

test('revise preview exposes wrapped revised chapter without writing', async () => {
  await withReviewedChapter(async (cwd) => {
    const before = await readFile(join(cwd, 'chapters/0001.md'), 'utf8');
    const reply = [
      'REVISION_NEEDED: yes',
      'rationale:',
      '- 按导演席指令去掉模板腔',
      '---',
      '正文第一段更自然。',
      '',
      '正文第二段保留动作,删掉空泛总结。',
      '',
      '正文第三段。结尾钩子',
    ].join('\n');

    const io = silentIo();
    assert.equal(
      await run([
        'revise',
        '--chapter',
        '1',
        '--model',
        '--instruction',
        '去掉模板腔,保留剧情',
      ], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm: fakeLlm(reply),
      }),
      0,
      io.err.join(''),
    );
    const afterPreviewRun = await readFile(join(cwd, 'chapters/0001.md'), 'utf8');
    assert.equal(afterPreviewRun, before);

    const result = await reviseChapter(cwd, {
      chapter: 1,
      llm: fakeLlm(reply),
      instruction: '去掉模板腔,保留剧情',
      now: new Date('2026-05-18T00:00:00.000Z'),
    });

    assert.equal(result.written, false);
    assert.equal(result.previewContent, [
      '# 章节 1',
      '',
      '> generated: 2026-05-18T00:00:00.000Z',
      '> agent: chief-writer (revise)',
      '> source: model',
      '> rationale_summary: - 按导演席指令去掉模板腔',
      '',
      '正文第一段更自然。',
      '',
      '正文第二段保留动作,删掉空泛总结。',
      '',
      '正文第三段。结尾钩子',
      '',
    ].join('\n'));
    const afterDirectPreview = await readFile(join(cwd, 'chapters/0001.md'), 'utf8');
    assert.equal(afterDirectPreview, before);

    const writtenResult = await reviseChapter(cwd, {
      chapter: 1,
      llm: fakeLlm(reply),
      instruction: '去掉模板腔,保留剧情',
      now: new Date('2026-05-18T00:01:00.000Z'),
      write: true,
    });
    const writtenChapter = await readFile(join(cwd, 'chapters/0001.md'), 'utf8');
    assert.equal(writtenResult.written, true);
    assert.equal(writtenResult.previewContent, writtenChapter);
  });
});

test('revise --model with YES output backs up draft and replaces chapter', async () => {
  await withReviewedChapter(async (cwd) => {
    const before = await readFile(join(cwd, 'chapters/0001.md'), 'utf8');
    const llm = fakeLlm([
      'REVISION_NEEDED: yes',
      'rationale:',
      '- 补完章尾钩子,原版略显仓促',
      '---',
      '正文第一段(微调)。',
      '',
      '正文第二段。',
      '',
      '正文第三段。结尾钩子完整收尾,留下一道悬念。',
    ].join('\n'));

    const io = silentIo();
    assert.equal(
      await run(['revise', '--chapter', '1', '--model', '--write'], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
      }),
      0,
      io.err.join(''),
    );

    const backup = await readFile(join(cwd, 'chapters/0001.draft.md'), 'utf8');
    assert.equal(backup, before);

    const revised = await readFile(join(cwd, 'chapters/0001.md'), 'utf8');
    assert.notEqual(revised, before);
    assert.match(revised, /chief-writer \(revise\)/);
    assert.match(revised, /留下一道悬念/);

    const output = io.out.join('');
    assert.match(output, /changed: yes/);
    assert.match(output, /draft backup: chapters\/0001\.draft\.md/);
  });
});

test('revise twice preserves the original draft backup', async () => {
  await withReviewedChapter(async (cwd) => {
    const originalBefore = await readFile(join(cwd, 'chapters/0001.md'), 'utf8');

    const reply1 = ['REVISION_NEEDED: yes', 'rationale:', '- 修订 1', '---', '修订第 1 版正文。'].join('\n');
    assert.equal(
      await run(['revise', '--chapter', '1', '--model', '--write'], cwd, silentIo().io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm: fakeLlm(reply1),
      }),
      0,
    );

    const backupAfter1 = await readFile(join(cwd, 'chapters/0001.draft.md'), 'utf8');
    assert.equal(backupAfter1, originalBefore);

    const reply2 = ['REVISION_NEEDED: yes', 'rationale:', '- 修订 2', '---', '修订第 2 版正文,完全不同。'].join('\n');
    assert.equal(
      await run(['revise', '--chapter', '1', '--model', '--write'], cwd, silentIo().io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm: fakeLlm(reply2),
      }),
      0,
    );

    const backupAfter2 = await readFile(join(cwd, 'chapters/0001.draft.md'), 'utf8');
    assert.equal(backupAfter2, originalBefore, 'second revise must not overwrite original backup');

    const finalChapter = await readFile(join(cwd, 'chapters/0001.md'), 'utf8');
    assert.match(finalChapter, /修订第 2 版正文,完全不同/);
  });
});

test('revise errors when chapter missing', async () => {
  await withReviewedChapter(async (cwd) => {
    const io = silentIo();
    const exit = await run(['revise', '--chapter', '5'], cwd, io.io, { env: {} });
    assert.equal(exit, 1);
    assert.match(io.err.join(''), /Chapter draft missing/);
  });
});

test('revise errors when internal review missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'authoros-v2-revise-missing-'));
  try {
    const io = silentIo();
    assert.equal(await run(['init', 'demo', '--quick'], root, io.io, { env: {} }), 0);
    const cwd = join(root, 'demo');
    await writeFile(join(cwd, 'plans/0001.md'), 'plan', 'utf8');
    await writeFile(join(cwd, 'chapters/0001.md'), '# 章节 1\n\n正文。', 'utf8');

    const errIo = silentIo();
    const exit = await run(['revise', '--chapter', '1'], cwd, errIo.io, { env: {} });
    assert.equal(exit, 1);
    assert.match(errIo.err.join(''), /Review missing.*internal/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('revise prompt includes length_state and compression rules when over range', async () => {
  await withReviewedChapter(async (cwd) => {
    // Stuff the chapter with many Chinese chars to exceed 3000 * 1.5 = 4500 chars.
    // '正文段落' = 4 CJK chars per repeat (。 is not in [一-鿿]).
    const overBody = '正文段落。'.repeat(1300); // 5200 Chinese chars
    await writeFile(
      join(cwd, 'chapters/0001.md'),
      [
        '# 章节 1',
        '',
        '> generated: 2026-05-11T00:00:00.000Z',
        '> agent: chief-writer',
        '> source: model',
        '',
        overBody,
      ].join('\n'),
      'utf8',
    );

    let captured = '';
    const llm = fakeLlm(
      ['REVISION_NEEDED: yes', 'rationale:', '- 压缩', '---', '正文压缩版。'.repeat(550)].join('\n'),
      (p) => { captured = p; },
    );
    const io = silentIo();
    assert.equal(
      await run(['revise', '--chapter', '1', '--model'], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
      }),
      0,
    );
    assert.match(captured, /length_state:/);
    assert.match(captured, /current_chinese_chars: 5200/);
    assert.match(captured, /status: OVER/);
    assert.match(captured, /reason to set REVISION_NEEDED: yes/);
    assert.match(captured, /compress unnecessary description/);
    assert.match(captured, /Preserve these intact.*plot beats/);
    assert.match(captured, /Compress these first: scene-setting/);
  });
});

test('revise prompt uses within_range rules when chapter is fine', async () => {
  await withReviewedChapter(async (cwd) => {
    // acceptable_range is 2400-3600. Aim for 2800 to be within.
    const okBody = '正文段落。'.repeat(700); // 2800 Chinese chars
    await writeFile(
      join(cwd, 'chapters/0001.md'),
      [
        '# 章节 1',
        '',
        '> generated: 2026-05-11T00:00:00.000Z',
        '> agent: chief-writer',
        '> source: model',
        '',
        okBody,
      ].join('\n'),
      'utf8',
    );

    let captured = '';
    const llm = fakeLlm('REVISION_NEEDED: no\nrationale:\n足够。', (p) => { captured = p; });
    const io = silentIo();
    assert.equal(
      await run(['revise', '--chapter', '1', '--model'], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
      }),
      0,
    );
    assert.match(captured, /status: WITHIN_RANGE/);
    assert.match(captured, /Keep ≥80% of the original prose verbatim/);
    assert.doesNotMatch(captured, /Compress these first: scene-setting/);
  });
});

test('revise rejects model output not starting with REVISION_NEEDED', async () => {
  await withReviewedChapter(async (cwd) => {
    const llm = fakeLlm('正文重写完整内容,但没有 marker');
    const io = silentIo();
    const exit = await run(['revise', '--chapter', '1', '--model', '--write'], cwd, io.io, {
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
    });
    assert.equal(exit, 1);
    assert.match(io.err.join(''), /did not start with "REVISION_NEEDED/);
  });
});

test('revise rejects yes output without --- separator', async () => {
  await withReviewedChapter(async (cwd) => {
    const llm = fakeLlm('REVISION_NEEDED: yes\nrationale:\n- 改 X\n忘了写分隔符,正文直接接');
    const io = silentIo();
    const exit = await run(['revise', '--chapter', '1', '--model', '--write'], cwd, io.io, {
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
    });
    assert.equal(exit, 1);
    assert.match(io.err.join(''), /"---" separator/);
  });
});
