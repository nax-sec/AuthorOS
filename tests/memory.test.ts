import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';
import type { LlmClient } from '../src/core/llm.ts';

async function withChapterAndDecision(body: (cwd: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-v2-memory-test-'));
  try {
    const io = silentIo();
    assert.equal(await run(['init', 'demo', '--quick'], root, io.io, { env: {} }), 0);
    const cwd = join(root, 'demo');
    await writeFile(join(cwd, 'chapters/0001.md'), '# 章节 1\n\n正文。', 'utf8');
    await writeFile(join(cwd, 'decisions/0001.md'), '# 决策\n\n## 需要更新的记忆\n- canon: 能力代价\n', 'utf8');
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

test('memory update errors when chapter draft missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'authoros-v2-memory-error-'));
  try {
    const io = silentIo();
    assert.equal(await run(['init', 'demo', '--quick'], root, io.io, { env: {} }), 0);
    const cwd = join(root, 'demo');

    const errIo = silentIo();
    const exit = await run(['memory', 'update', '--chapter', '1'], cwd, errIo.io, { env: {} });
    assert.equal(exit, 1);
    assert.match(errIo.err.join(''), /missing required context/);
    assert.match(errIo.err.join(''), /chapters\/0001\.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('memory update errors when decision missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'authoros-v2-memory-error2-'));
  try {
    const io = silentIo();
    assert.equal(await run(['init', 'demo', '--quick'], root, io.io, { env: {} }), 0);
    const cwd = join(root, 'demo');
    await writeFile(join(cwd, 'chapters/0001.md'), 'draft', 'utf8');

    const errIo = silentIo();
    const exit = await run(['memory', 'update', '--chapter', '1'], cwd, errIo.io, { env: {} });
    assert.equal(exit, 1);
    assert.match(errIo.err.join(''), /decisions\/0001\.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('memory update scaffold writes typed delta sections', async () => {
  await withChapterAndDecision(async (cwd) => {
    const io = silentIo();
    assert.equal(
      await run(['memory', 'update', '--chapter', '1', '--write'], cwd, io.io, { env: {} }),
      0,
      io.err.join(''),
    );
    const stored = await readFile(join(cwd, 'memory/chapter-0001.delta.md'), 'utf8');
    assert.match(stored, /# 章节 1 记忆更新建议/);
    assert.match(stored, /## canon \(新增 \/ 变更\)/);
    assert.match(stored, /## foreshadowing/);
    assert.match(stored, /## plot_threads/);
    assert.match(stored, /## character_state/);
    assert.match(stored, /## style/);
    assert.match(stored, /source: scaffold/);
    assert.match(stored, /delta proposal only/);
  });
});

test('memory update does not auto-edit memory files in v1', async () => {
  await withChapterAndDecision(async (cwd) => {
    const beforeCanon = await readFile(join(cwd, 'memory/canon.md'), 'utf8');
    const beforeFore = await readFile(join(cwd, 'memory/foreshadowing.yaml'), 'utf8');
    assert.equal(
      await run(['memory', 'update', '--chapter', '1', '--write'], cwd, silentIo().io, { env: {} }),
      0,
    );
    const afterCanon = await readFile(join(cwd, 'memory/canon.md'), 'utf8');
    const afterFore = await readFile(join(cwd, 'memory/foreshadowing.yaml'), 'utf8');
    assert.equal(afterCanon, beforeCanon);
    assert.equal(afterFore, beforeFore);
  });
});

test('memory update --model captures chapter + decision + all memory in prompt', async () => {
  await withChapterAndDecision(async (cwd) => {
    let captured = '';
    const llm: LlmClient = {
      async generate(prompt) {
        captured = prompt;
        return [
          '## canon (新增 / 变更)',
          '- 能力代价已确认',
          '## foreshadowing (新增 / 推进 / 回收)',
          '- 推进: H001 status -> introduced',
          '## plot_threads (状态推进)',
          '- T001.current_stage -> 初次觉醒',
          '## character_state (变化)',
          '- protagonist.ability_state -> 初次觉醒',
          '## style (规则增 / 禁)',
          '- 无',
        ].join('\n');
      },
    };

    const io = silentIo();
    assert.equal(
      await run(['memory', 'update', '--chapter', '1', '--model', '--write'], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
      }),
      0,
    );

    assert.match(captured, /MEMORY_UPDATE/);
    assert.match(captured, /\[chapters\/0001\.md\]/);
    assert.match(captured, /\[decisions\/0001\.md\]/);
    assert.match(captured, /\[memory\/canon\.md\]/);
    assert.match(captured, /\[memory\/foreshadowing\.yaml\]/);
    assert.match(captured, /\[memory\/plot_threads\.yaml\]/);
    assert.match(captured, /\[memory\/character_state\.yaml\]/);
    assert.match(captured, /\[memory\/style\.md\]/);

    const stored = await readFile(join(cwd, 'memory/chapter-0001.delta.md'), 'utf8');
    assert.match(stored, /能力代价已确认/);
    assert.match(stored, /protagonist\.ability_state -> 初次觉醒/);
    assert.match(stored, /source: model/);
  });
});
