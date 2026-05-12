import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';
import type { GenerateOptions, LlmClient } from '../src/core/llm.ts';

async function withDraftedChapter(body: (cwd: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-v2-review-test-'));
  try {
    const io = silentIo();
    assert.equal(await run(['init', 'demo', '--quick'], root, io.io, { env: {} }), 0, io.err.join(''));
    const cwd = join(root, 'demo');
    assert.equal(await run(['plan', '--chapter', '1', '--write'], cwd, silentIo().io, { env: {} }), 0);
    await writeFile(join(cwd, 'chapters/0001.md'), '# 章节 1\n\n正文。', 'utf8');
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

function recordingLlm(
  replies: Record<string, string>,
  capture?: (label: string, prompt: string, options: GenerateOptions | undefined) => void,
): LlmClient {
  return {
    async generate(prompt, options) {
      for (const marker of Object.keys(replies)) {
        if (prompt.includes(marker)) {
          capture?.(marker, prompt, options);
          return replies[marker];
        }
      }
      throw new Error(`Unexpected prompt: no reply registered. First 80 chars: ${prompt.slice(0, 80)}`);
    },
  };
}

test('review --mode internal scaffold writes consolidated file', async () => {
  await withDraftedChapter(async (cwd) => {
    const io = silentIo();
    assert.equal(
      await run(['review', '--chapter', '1', '--mode', 'internal', '--write'], cwd, io.io, { env: {} }),
      0,
      io.err.join(''),
    );
    const stored = await readFile(join(cwd, 'reviews/0001.internal.md'), 'utf8');
    assert.match(stored, /# 章节 1 内部评审/);
    assert.match(stored, /## 编辑决议/);
    assert.match(stored, /### 世界顾问 \(world-advisor\)/);
    assert.match(stored, /### 人物顾问 \(character-advisor\)/);
    assert.match(stored, /### 剧情顾问 \(plot-advisor\)/);
    assert.match(stored, /### 风格顾问 \(style-advisor\)/);
    assert.match(stored, /source: scaffold/);
  });
});

test('review --mode internal --model calls 5 agents (4 advisors + editor)', async () => {
  await withDraftedChapter(async (cwd) => {
    const seen: string[] = [];
    const maxTokensByMarker = new Map<string, number | undefined>();
    const llm = recordingLlm({
      INTERNAL_REVIEW_WORLD_ADVISOR: '## blocking\n- 无\n## advisory\n- 世界设定 OK\n## accepted-if-no-change\n- 无',
      INTERNAL_REVIEW_CHARACTER_ADVISOR: '## blocking\n- 无\n## advisory\n- 人物 OK\n## accepted-if-no-change\n- 无',
      INTERNAL_REVIEW_PLOT_ADVISOR: '## blocking\n- 无\n## advisory\n- 剧情 OK\n## accepted-if-no-change\n- 无',
      INTERNAL_REVIEW_STYLE_ADVISOR: '## blocking\n- 无\n## advisory\n- 风格 OK\n## accepted-if-no-change\n- 无',
      INTERNAL_REVIEW_EDITOR: '## 已采纳\n- 风格小改\n## 已拒绝\n- 无\n## 阻塞风险\n- 无\n## 暂缓\n- 无',
    }, (marker, _prompt, options) => {
      seen.push(marker);
      maxTokensByMarker.set(marker, options?.maxTokens);
    });

    const io = silentIo();
    assert.equal(
      await run(['review', '--chapter', '1', '--mode', 'internal', '--model', '--write'], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
      }),
      0,
      io.err.join(''),
    );

    // Advisors run in parallel; editor depends on them and is always last.
    assert.equal(seen.length, 5);
    assert.equal(seen[seen.length - 1], 'INTERNAL_REVIEW_EDITOR');
    const advisorMarkers = new Set(seen.slice(0, 4));
    assert.deepEqual(advisorMarkers, new Set([
      'INTERNAL_REVIEW_WORLD_ADVISOR',
      'INTERNAL_REVIEW_CHARACTER_ADVISOR',
      'INTERNAL_REVIEW_PLOT_ADVISOR',
      'INTERNAL_REVIEW_STYLE_ADVISOR',
    ]));
    assert.equal(maxTokensByMarker.get('INTERNAL_REVIEW_WORLD_ADVISOR'), 6000);
    assert.equal(maxTokensByMarker.get('INTERNAL_REVIEW_PLOT_ADVISOR'), 6000);
    assert.equal(maxTokensByMarker.get('INTERNAL_REVIEW_EDITOR'), 7000);

    const stored = await readFile(join(cwd, 'reviews/0001.internal.md'), 'utf8');
    assert.match(stored, /source: model/);
    assert.match(stored, /风格小改/);
    assert.match(stored, /剧情 OK/);
  });
});

test('review --mode internal runs 4 advisor calls concurrently, editor after', async () => {
  await withDraftedChapter(async (cwd) => {
    let inflight = 0;
    let peakAdvisorInflight = 0;
    let editorStartTime = -1;
    const advisorEndTimes: number[] = [];
    let timeCounter = 0;

    const llm: LlmClient = {
      async generate(prompt) {
        const isEditor = prompt.includes('INTERNAL_REVIEW_EDITOR');
        const myStart = timeCounter++;
        if (isEditor) editorStartTime = myStart;
        inflight += 1;
        if (!isEditor) peakAdvisorInflight = Math.max(peakAdvisorInflight, inflight);
        // Force a microtask gap so other advisor calls can enter inflight.
        await new Promise((resolve) => setImmediate(resolve));
        inflight -= 1;
        if (!isEditor) advisorEndTimes.push(timeCounter++);

        if (prompt.includes('INTERNAL_REVIEW_EDITOR')) {
          return '## 已采纳\n- 无\n## 已拒绝\n- 无\n## 阻塞风险\n- 无\n## 暂缓\n- 无';
        }
        return '## blocking\n- 无\n## advisory\n- 无\n## accepted-if-no-change\n- 无';
      },
    };

    const io = silentIo();
    assert.equal(
      await run(['review', '--chapter', '1', '--mode', 'internal', '--model', '--write'], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
      }),
      0,
      io.err.join(''),
    );

    assert.equal(peakAdvisorInflight, 4, 'all 4 advisors should be in-flight simultaneously');
    assert.ok(editorStartTime > Math.max(...advisorEndTimes), 'editor must start after all advisors finish');
  });
});

test('review --mode reader-sim scaffold lists all 5 personas', async () => {
  await withDraftedChapter(async (cwd) => {
    const io = silentIo();
    assert.equal(
      await run(['review', '--chapter', '1', '--mode', 'reader-sim', '--write'], cwd, io.io, { env: {} }),
      0,
    );
    const stored = await readFile(join(cwd, 'reviews/0001.reader-sim.md'), 'utf8');
    assert.match(stored, /## 爽点读者/);
    assert.match(stored, /## 节奏读者/);
    assert.match(stored, /## 脑洞读者/);
    assert.match(stored, /## 逻辑读者/);
    assert.match(stored, /## 人设读者/);
  });
});

test('review --mode reader-sim --model passes readers.yaml in context', async () => {
  await withDraftedChapter(async (cwd) => {
    let captured = '';
    const llm = recordingLlm({
      READER_SIM_REVIEW: [
        '## 爽点读者', '爽。',
        '## 节奏读者', '稳。',
        '## 脑洞读者', '新。',
        '## 逻辑读者', '通。',
        '## 人设读者', '活。',
      ].join('\n'),
    }, (_marker, prompt, options) => {
      captured = prompt;
      assert.equal(options?.maxTokens, 5000);
    });

    const io = silentIo();
    assert.equal(
      await run(['review', '--chapter', '1', '--mode', 'reader-sim', '--model', '--write'], cwd, io.io, {
        env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' }, llm,
      }),
      0,
    );
    assert.match(captured, /\.authoros\/readers\.yaml/);
    assert.match(captured, /爽点读者, 节奏读者, 脑洞读者, 逻辑读者, 人设读者/);
  });
});

test('review --mode all writes both files', async () => {
  await withDraftedChapter(async (cwd) => {
    const io = silentIo();
    assert.equal(
      await run(['review', '--chapter', '1', '--mode', 'all', '--write'], cwd, io.io, { env: {} }),
      0,
    );
    await stat(join(cwd, 'reviews/0001.internal.md'));
    await stat(join(cwd, 'reviews/0001.reader-sim.md'));
  });
});

test('review errors if chapter draft is missing', async () => {
  await withDraftedChapter(async (cwd) => {
    const io = silentIo();
    const exit = await run(['review', '--chapter', '9', '--mode', 'internal'], cwd, io.io, { env: {} });
    assert.equal(exit, 1);
    assert.match(io.err.join(''), /Chapter draft missing/);
  });
});

test('review rejects unknown --mode value', async () => {
  await withDraftedChapter(async (cwd) => {
    const io = silentIo();
    const exit = await run(['review', '--chapter', '1', '--mode', 'gossip'], cwd, io.io, { env: {} });
    assert.equal(exit, 1);
    assert.match(io.err.join(''), /--mode must be one of/);
  });
});
