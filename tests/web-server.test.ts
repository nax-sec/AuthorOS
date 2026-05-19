import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { createWebServer } from '../src/web/server.ts';
import { saveWebJobHistory } from '../src/web/job-persistence.ts';
import type { WebJob } from '../src/web/jobs.ts';
import { run } from '../src/cli.ts';
import { bindStyleProfile, createStyleProfileFromText, saveStyleProfile } from '../src/commands/style.ts';
import type { LlmClient } from '../src/core/llm.ts';

async function withTempRoot(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-web-server-'));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeInvalidJobHistory(root: string): Promise<void> {
  const dir = join(root, '.authoros', 'web');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'jobs.json'), '{ invalid json', 'utf8');
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

function fakeStyleRewriteLlm(): LlmClient {
  return {
    async generate(prompt) {
      if (!prompt.includes('REVISE_CHAPTER')) throw new Error(`unexpected prompt: ${prompt.slice(0, 80)}`);
      return [
        'REVISION_NEEDED: yes',
        'rationale:',
        '- 去掉平滑总结,保留案卷冷幽默',
        '---',
        '陆漪坐在旧木桌前,闻到羊皮纸和冷茶混在一起。',
        '',
        '她翻到表格第十七页,发现茶杯竟然要签署自愿繁殖声明。',
        '',
        '她没有笑,只把那枚未登记签名圈了起来。',
      ].join('\n');
    },
  };
}

function fakeQualityLlm(): LlmClient {
  return {
    async generate(prompt) {
      if (prompt.includes('READER_SIM_REVIEW')) {
        return [
          '## 模拟读者反应',
          '- 节奏清楚，愿意继续读。',
          '## 流失风险',
          '- 暂无。',
        ].join('\n');
      }
      if (prompt.includes('INTERNAL_REVIEW')) {
        return [
          '## 评审意见',
          '- 本章方向可继续。',
          '## 风险',
          '- 暂无阻塞。',
        ].join('\n');
      }
      if (prompt.includes('DECIDE')) {
        return [
          '## 决策摘要',
          '继续沿用当前线索。',
          '',
          '## 决策依据',
          '### 作者长期规划',
          '保持主线。',
          '### 内部评审',
          '无阻塞。',
          '### 模拟读者',
          '可读。',
          '### 真实读者反馈',
          '未参与。本章暂无真实反馈,不进行模拟补权。',
          '',
          '## 采纳的反馈',
          '- 强化线索。',
          '## 不采纳及原因',
          '- 无。',
          '## 下一章策略',
          '- 推进调查。',
          '## 需要更新的记忆',
          '- canon: 茶杯案继续推进',
          '## 风险提醒',
          '- 避免解释过多。',
        ].join('\n');
      }
      if (prompt.includes('MEMORY_UPDATE')) {
        return [
          '## canon (新增 / 变更)',
          '- 茶杯案继续推进',
          '',
          '## foreshadowing (新增 / 推进 / 回收)',
          '- 无',
          '',
          '## plot_threads (状态推进)',
          '- tea_case: active',
          '',
          '## character_state (变化)',
          '- 陆漪: 更警觉',
          '',
          '## style (规则增 / 禁)',
          '- 保持案卷冷幽默',
        ].join('\n');
      }
      throw new Error(`unexpected prompt: ${prompt.slice(0, 80)}`);
    },
  };
}

async function writeStyleReadyBook(root: string): Promise<void> {
  const io = silentIo();
  assert.equal(await run(['init', 'Demo Book', '--quick', '--dir', join(root, 'books/demo')], root, io.io, { env: {} }), 0, io.err.join(''));
  await writeFile(join(root, 'bookshelf.json'), JSON.stringify({
    version: 1,
    current: 'demo',
    books: [{
      id: 'demo',
      title: 'Demo Book',
      concept: 'style rewrite server test',
      path: 'books/demo',
      created_at: '2026-05-18T00:00:00.000Z',
      last_active_at: '2026-05-18T00:00:00.000Z',
    }],
  }, null, 2), 'utf8');
  await writeFile(join(root, 'books/demo/plans/0001.md'), '# 章节计划\n\n第 1 章。', 'utf8');
  await writeFile(join(root, 'books/demo/chapters/0001.md'), [
    '# 章节 1',
    '',
    '> generated: 2026-05-18T00:00:00.000Z',
    '> agent: chief-writer',
    '> source: model',
    '',
    '陆漪坐在旧木桌前,闻到羊皮纸和冷茶的味道。',
    '',
    '她翻开自动繁殖茶杯案,很快看见频率记录和魔力枯竭曲线对不上。',
    '',
    '她没有立刻指出问题,只是把那枚未登记签名圈了起来。',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'books/demo/reviews/0001.internal.md'), '# 内部评审\n\n## 编辑决议\n可按文风润色。', 'utf8');
  const profile = createStyleProfileFromText(root, {
    name: '雨夜冷调',
    text: [
      '雨从旧楼的檐角垂下来，像一串没说完的话。林岚把伞收在门外，先听见楼道深处的水声，然后才看见门缝里透出的灯。',
      '她没有立刻敲门。她习惯先把现场的呼吸数一遍：电梯停在三楼，窗台上有半枚烟灰，墙面新刷过，却盖不住潮气。',
      '“你迟到了。”门内的人说。',
      '“我在等你决定要不要撒谎。”林岚回答。她的语气很轻，像把刀背放在桌上，没有声响，却让人知道刀还在那里。',
      '房间里没有多余的家具。一张桌，一盏灯，一只杯口裂开的白瓷杯。她闻到冷茶、灰尘和某种廉价香水混在一起。',
    ].join('\n\n'),
  });
  await saveStyleProfile(root, profile);
  await bindStyleProfile(root, join(root, 'books/demo'), profile.id, new Date('2026-05-18T01:00:00Z'));
}

function referenceStyleText(): string {
  return [
    '雨从旧楼的檐角垂下来，像一串没说完的话。林岚把伞收在门外，先听见楼道深处的水声，然后才看见门缝里透出的灯。',
    '她没有立刻敲门。她习惯先把现场的呼吸数一遍：电梯停在三楼，窗台上有半枚烟灰，墙面新刷过，却盖不住潮气。',
    '“你迟到了。”门内的人说。',
    '“我在等你决定要不要撒谎。”林岚回答。她的语气很轻，像把刀背放在桌上，没有声响，却让人知道刀还在那里。',
    '房间里没有多余的家具。一张桌，一盏灯，一只杯口裂开的白瓷杯。她闻到冷茶、灰尘和某种廉价香水混在一起。',
    '每个段落都往前挪一点，不急着解释，也不急着审判。人物先观察，再开口；线索先落地，再变成判断。',
  ].join('\n\n');
}

async function waitForJob(
  server: ReturnType<typeof createWebServer>,
  url: string,
  headers?: HeadersInit,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await server.fetch(new Request(url, { headers }));
    const body = await response.json();
    const job = body.jobs?.[0];
    if (job?.status === 'completed' || job?.status === 'failed') return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`job did not finish: ${url}`);
}

test('web server blocks API requests when token is configured', async () => {
  const server = createWebServer({ root: 'D:\\tmp\\missing', token: 'secret' });

  const response = await server.fetch(new Request('http://local/api/books'));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'access token required' });
});

test('web server accepts bearer token for API requests', async () => {
  const server = createWebServer({
    root: 'D:\\tmp\\missing',
    token: 'secret',
    privateApi: {
      listBooks: async () => ({ version: 1, current: null, books: [] }),
    },
  });

  const response = await server.fetch(new Request('http://local/api/books', {
    headers: { authorization: 'Bearer secret' },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { version: 1, current: null, books: [] });
});

test('web server serves the browser shell', async () => {
  const server = createWebServer({ root: 'D:\\tmp\\missing' });

  const response = await server.fetch(new Request('http://local/'));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  assert.match(html, /AuthorOS Private Web/);
});

test('web server chat returns immediate agent reply for new book intake', async () => {
  await withTempRoot(async (root) => {
    const server = createWebServer({ root });

    const response = await server.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '我想看一本赛博香港侦探小说' }),
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.action, 'new_book_intake');
    assert.match(body.message, /方向钉稳/);
  });
});

test('web server defaults to rule agent without llm receptionist', async () => {
  await withTempRoot(async (root) => {
    let called = false;
    const server = createWebServer({
      root,
      agentLlm: {
        async generate() {
          called = true;
          return JSON.stringify({
            action: 'unknown',
            message: 'LLM 接待不应该默认接管。',
          });
        },
      },
    });

    const response = await server.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '我想看一本赛博香港侦探小说' }),
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(called, false);
    assert.equal(body.action, 'new_book_intake');
    assert.match(body.message, /方向钉稳/);
  });
});

test('web server can use llm agent mode for vague messages', async () => {
  await withTempRoot(async (root) => {
    const server = createWebServer({
      root,
      agentMode: 'llm',
      agentLlm: {
        async generate() {
          return JSON.stringify({
            action: 'feedback_preview',
            message: '收到，我先生成修改预览。',
            text: '这一章节奏有点散，需要更集中。',
          });
        },
      },
    });

    const response = await server.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '感觉这章有点散' }),
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.action, 'feedback_preview');
    assert.equal(body.command.type, 'feedback');
    if (body.jobId) await waitForJob(server, 'http://local/api/jobs');
  });
});

test('web server hybrid mode calls receptionist before rule routing', async () => {
  await withTempRoot(async (root) => {
    let called = false;
    const server = createWebServer({
      root,
      agentMode: 'hybrid',
      agentLlm: {
        async generate() {
          called = true;
          return JSON.stringify({
            action: 'new_book_intake',
            message: '我先接待，再决定是否建书。',
          });
        },
      },
    });

    const response = await server.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '我也不知道写什么，你随便写一本书' }),
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(called, true);
    assert.equal(body.action, 'new_book_intake');
    assert.equal(body.message, '我先接待，再决定是否建书。');
    if (body.jobId) await waitForJob(server, 'http://local/api/jobs');
  });
});

test('web server hybrid mode keeps pending new book confirmation in session', async () => {
  await withTempRoot(async (root) => {
    let called = 0;
    const server = createWebServer({
      root,
      agentMode: 'hybrid',
      agentLlm: {
        async generate() {
          called += 1;
          return JSON.stringify({
            action: 'new_book_intake',
            message: '我先问几个问题，再建书。',
          });
        },
      },
    });

    const intake = await server.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '我想开一本新书' }),
    }));
    const intakeBody = await intake.json();

    const brief = await server.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '主角是刘新弟，舔狗重生虐恋，文笔和感情要细腻' }),
    }));
    const briefBody = await brief.json();

    const confirm = await server.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '确认' }),
    }));
    const confirmBody = await confirm.json();

    assert.equal(intakeBody.action, 'new_book_intake');
    assert.equal(briefBody.action, 'new_book_confirm');
    assert.match(briefBody.message, /开书承诺/);
    assert.equal(confirmBody.action, 'new_book_confirmed');
    assert.equal(confirmBody.command.type, 'new_book');
    assert.match(confirmBody.command.concept, /刘新弟/);
    assert.equal(called, 1);
  });
});

test('web server hybrid chat falls back to rules when receptionist client is unavailable', async () => {
  await withTempRoot(async (root) => {
    const server = createWebServer({
      root,
      agentMode: 'hybrid',
      env: {},
    });

    const response = await server.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '继续写' }),
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.action, 'continue_book');
    assert.equal(body.command.type, 'continue');
    await waitForJob(server, 'http://local/api/jobs');
  });
});

test('web server hybrid chat falls back to rules when receptionist model is unavailable', async () => {
  await withTempRoot(async (root) => {
    const server = createWebServer({
      root,
      agentMode: 'hybrid',
      env: {},
    });

    const response = await server.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '继续写' }),
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.action, 'continue_book');
    assert.equal(body.command.type, 'continue');
    await waitForJob(server, 'http://local/api/jobs');
  });
});

test('web server maps access codes to fixed room URLs', async () => {
  const server = createWebServer({
    root: 'D:\\Books\\authoros-web',
    env: { AUTHOROS_WEB_ROOMS: '1,2,3,4,999' },
  });

  const session = await server.fetch(new Request('http://local/api/session'));
  assert.deepEqual(await session.json(), { tokenRequired: true, rooms: true });

  const response = await server.fetch(new Request('http://local/api/login', {
    method: 'POST',
    body: JSON.stringify({ token: '999' }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, roomId: 'room999', roomPath: '/room/room999' });
});

test('web server isolates room roots and tokens', async () => {
  const seenRoots: string[] = [];
  const server = createWebServer({
    root: 'D:\\Books\\authoros-web',
    env: { AUTHOROS_WEB_ROOMS: '1,2,3,4,999' },
    privateApi: {
      async listBooks(root) {
        seenRoots.push(root);
        return { version: 1, current: null, books: [{ id: 'book', title: root, path: 'books/book' }] };
      },
    },
  });

  const ok = await server.fetch(new Request('http://local/room/room1/api/books', {
    headers: { authorization: 'Bearer 1' },
  }));
  assert.equal(ok.status, 200);
  assert.match(seenRoots[0] ?? '', /rooms[\\/]room1$/);

  const wrongToken = await server.fetch(new Request('http://local/room/room2/api/books', {
    headers: { authorization: 'Bearer 1' },
  }));
  assert.equal(wrongToken.status, 401);

  const unscoped = await server.fetch(new Request('http://local/api/books', {
    headers: { authorization: 'Bearer 1' },
  }));
  assert.equal(unscoped.status, 404);
  assert.deepEqual(await unscoped.json(), { error: 'room required' });
});

test('web command help is available from the CLI', async () => {
  const out: string[] = [];
  const err: string[] = [];

  const code = await run(['web', '--help'], 'D:\\tmp', {
    stdout: (message) => out.push(message),
    stderr: (message) => err.push(message),
  }, { env: {} });

  assert.equal(code, 0, err.join(''));
  assert.match(out.join(''), /author web/);
  assert.match(out.join(''), /--port/);
});

test('web server exposes job history', async () => {
  await withTempRoot(async (root) => {
    await mkdir(join(root, 'books/demo/chapters'), { recursive: true });
    await writeFile(join(root, 'bookshelf.json'), JSON.stringify({
      version: 1,
      current: 'demo',
      books: [{
        id: 'demo',
        title: 'Demo Book',
        concept: 'job history test',
        path: 'books/demo',
        created_at: '2026-05-18T00:00:00.000Z',
        last_active_at: '2026-05-18T00:00:00.000Z',
      }],
    }, null, 2), 'utf8');
    await writeFile(join(root, 'books/demo/chapters/0001.md'), 'chapter one body', 'utf8');
    const server = createWebServer({
      root,
      agentMode: 'rule',
      env: {},
    });

    const chat = await server.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '读最新章' }),
    }));
    assert.equal(chat.status, 200);
    await waitForJob(server, 'http://local/api/jobs');

    const jobs = await server.fetch(new Request('http://local/api/jobs'));
    const body = await jobs.json();

    assert.equal(jobs.status, 200);
    assert.equal(body.jobs.length, 1);
    assert.equal(body.jobs[0].action, 'read_chapter');
    assert.equal(body.jobs[0].result.completion.title, '已读取第 1 章。');
    assert.match(body.jobs[0].result.completion.next, /继续写/);
  });
});

test('web server runs style rewrite preview and apply jobs', async () => {
  await withTempRoot(async (root) => {
    await writeStyleReadyBook(root);
    const server = createWebServer({
      root,
      agentMode: 'rule',
      writingLlm: fakeStyleRewriteLlm(),
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
    });

    const preview = await server.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '去 AI 味，保留案卷冷幽默' }),
    }));
    const previewBody = await preview.json();

    assert.equal(preview.status, 200);
    assert.equal(previewBody.action, 'style_rewrite_preview');
    assert.equal(previewBody.command.type, 'style_rewrite');
    await waitForJob(server, 'http://local/api/jobs');
    await stat(join(root, 'books/demo/.authoros/private/pending-style-rewrite.json'));

    let jobsResponse = await server.fetch(new Request('http://local/api/jobs'));
    let jobs = await jobsResponse.json();
    assert.equal(jobs.jobs[0].status, 'completed');
    assert.equal(jobs.jobs[0].events.some((event: { type: string }) => event.type === 'style_check'), true);

    const apply = await server.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '应用文风修改' }),
    }));
    const applyBody = await apply.json();

    assert.equal(apply.status, 200);
    assert.equal(applyBody.action, 'style_rewrite_apply');
    assert.equal(applyBody.command.type, 'style_apply');
    await waitForJob(server, 'http://local/api/jobs');

    jobsResponse = await server.fetch(new Request('http://local/api/jobs'));
    jobs = await jobsResponse.json();
    assert.equal(jobs.jobs[0].status, 'completed');
    assert.equal(jobs.jobs[0].events.some((event: { type: string }) => event.type === 'style_apply'), true);
    const chapter = await readFile(join(root, 'books/demo/chapters/0001.md'), 'utf8');
    assert.match(chapter, /自愿繁殖声明/);
    await assert.rejects(() => stat(join(root, 'books/demo/.authoros/private/pending-style-rewrite.json')));
  });
});

test('web server runs quality loop review, decision, and memory jobs', async () => {
  await withTempRoot(async (root) => {
    await writeStyleReadyBook(root);
    const server = createWebServer({
      root,
      agentMode: 'rule',
      writingLlm: fakeQualityLlm(),
      env: { OPENAI_API_KEY: 'k', AUTHOROS_MODEL: 'm' },
    });

    const reader = await server.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '生成第 1 章读者模拟' }),
    }));
    const readerBody = await reader.json();

    assert.equal(reader.status, 200);
    assert.equal(readerBody.action, 'reader_sim_review');
    assert.equal(readerBody.command.type, 'review');
    await waitForJob(server, 'http://local/api/jobs');
    await stat(join(root, 'books/demo/reviews/0001.reader-sim.md'));

    let jobsResponse = await server.fetch(new Request('http://local/api/jobs'));
    let jobs = await jobsResponse.json();
    assert.equal(jobs.jobs[0].status, 'completed');
    assert.equal(jobs.jobs[0].events.some((event: { type: string }) => event.type === 'reader_sim_review'), true);
    assert.match(jobs.jobs[0].result.completion.title, /读者模拟/);

    const decision = await server.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '生成第 1 章决策' }),
    }));
    const decisionBody = await decision.json();

    assert.equal(decision.status, 200);
    assert.equal(decisionBody.action, 'chapter_decision');
    assert.equal(decisionBody.command.type, 'decide');
    await waitForJob(server, 'http://local/api/jobs');
    await stat(join(root, 'books/demo/decisions/0001.md'));

    const memory = await server.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '生成第 1 章记忆更新' }),
    }));
    const memoryBody = await memory.json();

    assert.equal(memory.status, 200);
    assert.equal(memoryBody.action, 'memory_update');
    assert.equal(memoryBody.command.type, 'memory_update');
    await waitForJob(server, 'http://local/api/jobs');
    await stat(join(root, 'books/demo/memory/chapter-0001.delta.md'));

    jobsResponse = await server.fetch(new Request('http://local/api/jobs'));
    jobs = await jobsResponse.json();
    assert.equal(jobs.jobs[0].status, 'completed');
    assert.equal(jobs.jobs[0].events.some((event: { type: string }) => event.type === 'memory_update'), true);
    assert.match(jobs.jobs[0].result.completion.next, /审阅记忆更新/);
  });
});

test('web server exposes pending memory delta content for cockpit review', async () => {
  await withTempRoot(async (root) => {
    await writeStyleReadyBook(root);
    await writeFile(join(root, 'books/demo/memory/chapter-0001.delta.md'), [
      '# 章节 1 记忆更新建议',
      '',
      '## canon (新增 / 变更)',
      '- 茶杯案进入第二阶段',
    ].join('\n'), 'utf8');
    const server = createWebServer({ root, env: {} });

    const response = await server.fetch(new Request('http://local/api/memory/deltas/chapter-0001.delta.md'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.name, 'chapter-0001.delta.md');
    assert.match(body.content, /茶杯案进入第二阶段/);
  });
});

test('web server marks a pending memory delta as reviewed', async () => {
  await withTempRoot(async (root) => {
    await writeStyleReadyBook(root);
    await writeFile(join(root, 'books/demo/memory/chapter-0001.delta.md'), '# delta\n\n- 已合并内容', 'utf8');
    const server = createWebServer({ root, env: {} });

    const response = await server.fetch(new Request('http://local/api/memory/deltas/chapter-0001.delta.md/reviewed', {
      method: 'POST',
    }));
    const body = await response.json();
    const cockpit = await server.fetch(new Request('http://local/api/cockpit'));
    const cockpitBody = await cockpit.json();
    const canon = await readFile(join(root, 'books/demo/memory/canon.md'), 'utf8');

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.name, 'chapter-0001.delta.md');
    assert.equal(body.alreadyReviewed, false);
    assert.match(canon, /### chapter-0001\.delta\.md/);
    assert.match(canon, /reviewed: chapter-0001\.delta\.md/);
    assert.match(canon, /```markdown\n# delta\n\n- 已合并内容\n```/);
    assert.equal(cockpitBody.quality.memoryDeltas.some((delta: { name: string }) => delta.name === 'chapter-0001.delta.md'), false);
  });
});

test('web server merges a pending memory delta into memory files', async () => {
  await withTempRoot(async (root) => {
    await writeStyleReadyBook(root);
    await writeFile(join(root, 'books/demo/memory/chapter-0001.delta.md'), [
      '# delta',
      '',
      '## canon (新增 / 变更)',
      '- 茶杯案确认进入第二阶段',
      '',
      '## foreshadowing (新增 / 推进 / 回收)',
      '- H001.status -> advanced',
      '',
      '## plot_threads (状态推进)',
      '- T001.current_stage -> 追查茶杯',
      '',
      '## character_state (变化)',
      '- protagonist.known_information += 茶杯线索',
      '',
      '## style (规则增 / 禁)',
      '- 保持案卷冷幽默',
    ].join('\n'), 'utf8');
    const server = createWebServer({ root, env: {} });

    const response = await server.fetch(new Request('http://local/api/memory/deltas/chapter-0001.delta.md/merge', {
      method: 'POST',
    }));
    const body = await response.json();
    const cockpit = await server.fetch(new Request('http://local/api/cockpit'));
    const cockpitBody = await cockpit.json();
    const canon = await readFile(join(root, 'books/demo/memory/canon.md'), 'utf8');
    const foreshadowing = await readFile(join(root, 'books/demo/memory/foreshadowing.yaml'), 'utf8');
    const plotThreads = await readFile(join(root, 'books/demo/memory/plot_threads.yaml'), 'utf8');
    const characterState = await readFile(join(root, 'books/demo/memory/character_state.yaml'), 'utf8');
    const style = await readFile(join(root, 'books/demo/memory/style.md'), 'utf8');
    const foreshadowingDoc = parseYaml(foreshadowing) as { hooks: Array<{ id: string; status: string }> };
    const plotThreadsDoc = parseYaml(plotThreads) as { threads: Array<{ id: string; current_stage: string }> };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.name, 'chapter-0001.delta.md');
    assert.equal(body.alreadyMerged, false);
    assert.deepEqual(body.changedFiles, [
      'memory/canon.md',
      'memory/foreshadowing.yaml',
      'memory/plot_threads.yaml',
      'memory/character_state.yaml',
      'memory/style.md',
    ]);
    assert.match(canon, /- 茶杯案确认进入第二阶段/);
    assert.match(canon, /- merged: chapter-0001\.delta\.md/);
    assert.equal(foreshadowingDoc.hooks.find((hook) => hook.id === 'H001')?.status, 'advanced');
    assert.equal(plotThreadsDoc.threads.find((thread) => thread.id === 'T001')?.current_stage, '追查茶杯');
    assert.match(characterState, /# - protagonist\.known_information \+= 茶杯线索/);
    assert.match(style, /  - 保持案卷冷幽默/);
    assert.equal(cockpitBody.quality.memoryDeltas.some((delta: { name: string }) => delta.name === 'chapter-0001.delta.md'), false);
  });
});

test('web server previews a pending memory delta merge without writing memory files', async () => {
  await withTempRoot(async (root) => {
    await writeStyleReadyBook(root);
    await writeFile(join(root, 'books/demo/memory/chapter-0001.delta.md'), [
      '# delta',
      '',
      '## canon (新增 / 变更)',
      '- 预览茶杯案正史',
      '',
      '## foreshadowing (新增 / 推进 / 回收)',
      '- H001.status -> previewed',
      '- H999.status -> missing preview hook',
      '',
      '## style (规则增 / 禁)',
      '- 预览冷幽默',
    ].join('\n'), 'utf8');
    const beforeCanon = await readFile(join(root, 'books/demo/memory/canon.md'), 'utf8');
    const beforeForeshadowing = await readFile(join(root, 'books/demo/memory/foreshadowing.yaml'), 'utf8');
    const server = createWebServer({ root, env: {} });

    const response = await server.fetch(new Request('http://local/api/memory/deltas/chapter-0001.delta.md/merge-preview'));
    const body = await response.json();
    const cockpit = await server.fetch(new Request('http://local/api/cockpit'));
    const cockpitBody = await cockpit.json();
    const afterCanon = await readFile(join(root, 'books/demo/memory/canon.md'), 'utf8');
    const afterForeshadowing = await readFile(join(root, 'books/demo/memory/foreshadowing.yaml'), 'utf8');

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.name, 'chapter-0001.delta.md');
    assert.equal(body.alreadyMerged, false);
    assert.deepEqual(body.changedFiles, [
      'memory/canon.md',
      'memory/foreshadowing.yaml',
      'memory/style.md',
    ]);
    assert.deepEqual(body.targetFiles, [
      {
        path: 'memory/canon.md',
        section: 'canon',
        items: ['预览茶杯案正史'],
        plans: [{ item: '预览茶杯案正史', action: 'append', detail: '追加到 memory/canon.md' }],
      },
      {
        path: 'memory/foreshadowing.yaml',
        section: 'foreshadowing',
        items: ['H001.status -> previewed', 'H999.status -> missing preview hook'],
        plans: [
          { item: 'H001.status -> previewed', action: 'structured', detail: '更新 hooks[id=H001].status' },
          { item: 'H999.status -> missing preview hook', action: 'comment', detail: '找不到可安全更新的 YAML 目标，改为注释保底' },
        ],
      },
      {
        path: 'memory/style.md',
        section: 'style',
        items: ['预览冷幽默'],
        plans: [{ item: '预览冷幽默', action: 'append', detail: '追加到 memory/style.md' }],
      },
    ]);
    assert.equal(afterCanon, beforeCanon);
    assert.equal(afterForeshadowing, beforeForeshadowing);
    assert.equal(cockpitBody.quality.memoryDeltas.some((delta: { name: string }) => delta.name === 'chapter-0001.delta.md'), true);
  });
});

test('web server exposes readable quality artifact content', async () => {
  await withTempRoot(async (root) => {
    await writeStyleReadyBook(root);
    await writeFile(join(root, 'books/demo/reviews/0001.reader-sim.md'), '# 读者模拟\n\n愿意继续读。', 'utf8');
    const server = createWebServer({ root, env: {} });

    const response = await server.fetch(new Request('http://local/api/quality/artifacts/reader_sim_review/1'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.type, 'reader_sim_review');
    assert.equal(body.chapter, 1);
    assert.equal(body.path, 'reviews/0001.reader-sim.md');
    assert.match(body.content, /愿意继续读/);
  });
});

test('web server explains failed model jobs with readable failure details', async () => {
  await withTempRoot(async (root) => {
    await writeStyleReadyBook(root);
    const server = createWebServer({
      root,
      writingLlm: {
        async generate() {
          throw new Error('OpenAI-compatible response did not include message content (finish_reason: length).');
        },
      },
    });

    const preview = await server.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '去 AI 味' }),
    }));
    assert.equal(preview.status, 200);
    await waitForJob(server, 'http://local/api/jobs');

    const jobsResponse = await server.fetch(new Request('http://local/api/jobs'));
    const jobs = await jobsResponse.json();
    const failed = jobs.jobs[0];

    assert.equal(failed.status, 'failed');
    assert.equal(failed.failure.kind, 'model_length');
    assert.equal(failed.error, '模型输出被截断。');
    assert.equal(failed.events.at(-1).data.kind, 'model_length');
  });
});

test('web server binds a style profile and refreshes the book generation snapshot', async () => {
  await withTempRoot(async (root) => {
    await writeStyleReadyBook(root);
    const existing = JSON.parse(await readFile(join(root, 'books/demo/.authoros/private/style-binding.json'), 'utf8'));
    const server = createWebServer({
      root,
      env: {},
    });

    const response = await server.fetch(new Request('http://local/api/style/bind', {
      method: 'POST',
      body: JSON.stringify({ profileId: existing.profileId }),
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.binding.profileId, existing.profileId);
    const binding = JSON.parse(await readFile(join(root, 'books/demo/.authoros/private/style-binding.json'), 'utf8'));
    assert.equal(binding.profileId, existing.profileId);
    assert.equal(binding.profile.name, '雨夜冷调');
  });
});

test('web server extracts a style profile from pasted prose and binds it to the current book', async () => {
  await withTempRoot(async (root) => {
    await writeStyleReadyBook(root);
    const server = createWebServer({
      root,
      env: {},
    });

    const response = await server.fetch(new Request('http://local/api/style/extract', {
      method: 'POST',
      body: JSON.stringify({
        name: '雨夜提炼',
        text: referenceStyleText(),
        bind: true,
      }),
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.profile.name, '雨夜提炼');
    assert.equal(body.summary.name, '雨夜提炼');
    assert.match(body.summary.description, /paragraphs/);
    assert.equal(body.summary.rulesPreview.length > 0, true);
    assert.match(body.summary.rulesPreview.join('\n'), /Do not copy|Preserve|Avoid/);
    assert.equal(body.binding.profileId, body.profile.id);
    await stat(join(root, '.authoros/styles/profiles', `${body.profile.id}.json`));
    const binding = JSON.parse(await readFile(join(root, 'books/demo/.authoros/private/style-binding.json'), 'utf8'));
    assert.equal(binding.profileId, body.profile.id);
    assert.equal(binding.profile.name, '雨夜提炼');
  });
});

test('web server rejects style extraction without a name', async () => {
  await withTempRoot(async (root) => {
    const server = createWebServer({ root, env: {} });

    const response = await server.fetch(new Request('http://local/api/style/extract', {
      method: 'POST',
      body: JSON.stringify({ name: ' ', text: referenceStyleText() }),
    }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /name is required/);
  });
});

test('web server exposes cockpit overview', async () => {
  await withTempRoot(async (root) => {
    const server = createWebServer({
      root,
      env: { OPENAI_API_KEY: 'key', AUTHOROS_MODEL: 'gpt-test' },
    });

    const response = await server.fetch(new Request('http://local/api/cockpit'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.current, null);
    assert.equal(body.nextAction.kind, 'new_book');
    assert.equal(body.model.apiKeySet, true);
    assert.equal(body.model.model, 'gpt-test');
  });
});

test('web server exposes model doctor for recovery checks', async () => {
  await withTempRoot(async (root) => {
    const server = createWebServer({ root, env: {} });

    const response = await server.fetch(new Request('http://local/api/model/doctor'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.scope.kind, 'private_root');
    assert.equal(body.doctor.ready, false);
    assert.equal(body.doctor.apiKeyEnv, 'OPENAI_API_KEY');
    assert.equal(body.doctor.apiKeySet, false);
    assert.equal(body.doctor.model, undefined);
    assert.equal(body.doctor.blockers.includes('API key env OPENAI_API_KEY is not set'), true);
    assert.equal(body.doctor.blockers.includes('model is not set (use --model, AUTHOROS_MODEL, or OPENAI_MODEL)'), true);
  });
});

test('web server model doctor checks the current private book config when available', async () => {
  await withTempRoot(async (root) => {
    await mkdir(join(root, 'books/demo/.authoros'), { recursive: true });
    await writeFile(join(root, 'books/demo/.authoros/model.json'), JSON.stringify({
      provider: 'openai_compatible',
      apiKeyEnv: 'BOOK_KEY',
      baseUrl: 'https://models.example/v1',
      model: 'book-model',
    }), 'utf8');
    await writeFile(join(root, 'bookshelf.json'), JSON.stringify({
      version: 1,
      current: 'demo',
      books: [{
        id: 'demo',
        title: 'Demo Book',
        concept: 'model doctor scope',
        path: 'books/demo',
        created_at: '2026-05-18T00:00:00.000Z',
        last_active_at: '2026-05-18T00:00:00.000Z',
      }],
    }), 'utf8');
    const server = createWebServer({ root, env: { BOOK_KEY: 'secret' } });

    const response = await server.fetch(new Request('http://local/api/model/doctor'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.scope.kind, 'current_book');
    assert.equal(body.scope.bookId, 'demo');
    assert.equal(body.scope.label, 'Demo Book');
    assert.equal(body.doctor.ready, true);
    assert.equal(body.doctor.apiKeyEnv, 'BOOK_KEY');
    assert.equal(body.doctor.apiKeySet, true);
    assert.equal(body.doctor.baseUrl, 'https://models.example/v1');
    assert.equal(body.doctor.model, 'book-model');
    assert.deepEqual(body.doctor.blockers, []);
  });
});

test('web server saves current book model config and local api key without returning the key', async () => {
  await withTempRoot(async (root) => {
    await mkdir(join(root, 'books/demo/.authoros'), { recursive: true });
    await writeFile(join(root, 'bookshelf.json'), JSON.stringify({
      version: 1,
      current: 'demo',
      books: [{
        id: 'demo',
        title: 'Demo Book',
        concept: 'model config save',
        path: 'books/demo',
        created_at: '2026-05-18T00:00:00.000Z',
        last_active_at: '2026-05-18T00:00:00.000Z',
      }],
    }), 'utf8');
    const server = createWebServer({ root, env: {} });

    const response = await server.fetch(new Request('http://local/api/model/config', {
      method: 'POST',
      body: JSON.stringify({
        apiKeyEnv: 'WEB_KEY',
        baseUrl: 'https://models.example/v1/',
        model: 'web-model',
        apiKey: 'sk-local-web-test-key',
      }),
    }));
    const body = await response.json();
    const stored = JSON.parse(await readFile(join(root, 'books/demo/.authoros/model.json'), 'utf8'));
    const secret = JSON.parse(await readFile(join(root, 'books/demo/.authoros/model.secret.json'), 'utf8'));
    const doctorResponse = await server.fetch(new Request('http://local/api/model/doctor'));
    const doctorBody = await doctorResponse.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.scope.kind, 'current_book');
    assert.equal(body.config.apiKeySet, true);
    assert.equal(body.config.apiKeySource, 'local');
    assert.equal(body.config.baseUrl, 'https://models.example/v1');
    assert.equal(body.config.model, 'web-model');
    assert.equal(JSON.stringify(body).includes('sk-local-web-test-key'), false);
    assert.equal(stored.apiKey, undefined);
    assert.equal(stored.apiKeyEnv, 'WEB_KEY');
    assert.equal(stored.baseUrl, 'https://models.example/v1');
    assert.equal(stored.model, 'web-model');
    assert.equal(secret.apiKey, 'sk-local-web-test-key');
    assert.equal(doctorBody.doctor.ready, true);
    assert.equal(doctorBody.doctor.apiKeySet, true);
    assert.equal(doctorBody.doctor.apiKeySource, 'local');
  });
});

test('web server returns current preview comparison', async () => {
  await withTempRoot(async (root) => {
    await mkdir(join(root, 'books/demo/chapters'), { recursive: true });
    await mkdir(join(root, 'books/demo/plans'), { recursive: true });
    await mkdir(join(root, 'books/demo/.authoros/private'), { recursive: true });
    await writeFile(join(root, 'bookshelf.json'), JSON.stringify({
      version: 1,
      current: 'demo',
      books: [{
        id: 'demo',
        title: 'Demo Book',
        concept: 'preview comparison',
        path: 'books/demo',
        created_at: '2026-05-19T00:00:00.000Z',
        last_active_at: '2026-05-19T00:00:00.000Z',
      }],
    }, null, 2), 'utf8');
    await writeFile(join(root, 'books/demo/plans/0001.md'), 'plan one', 'utf8');
    await writeFile(join(root, 'books/demo/chapters/0001.md'), '当前正文', 'utf8');
    await writeFile(join(root, 'books/demo/.authoros/private/pending-feedback.json'), JSON.stringify({
      chapter: 1,
      text: '去掉解释',
      instruction: '按反馈修改',
      preview_content: '预览正文',
      rationale: '减少解释',
      created_at: '2026-05-19T09:10:00.000Z',
      original_char_count: 4,
      revised_char_count: 4,
    }), 'utf8');
    const server = createWebServer({ root });

    const response = await server.fetch(new Request('http://local/api/previews/current'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.comparison.current.content, '当前正文');
    assert.equal(body.comparison.preview.content, '预览正文');
  });
});

test('web server reads current book assets without exposing files outside the book', async () => {
  await withTempRoot(async (root) => {
    await mkdir(join(root, 'books/demo'), { recursive: true });
    await writeFile(join(root, 'bookshelf.json'), JSON.stringify({
      version: 1,
      current: 'demo',
      books: [{
        id: 'demo',
        title: 'Demo Book',
        concept: 'asset panel',
        path: 'books/demo',
        created_at: '2026-05-19T00:00:00.000Z',
        last_active_at: '2026-05-19T00:00:00.000Z',
      }],
    }, null, 2), 'utf8');
    await writeFile(join(root, 'books/demo/product.md'), '# 产品承诺\n悬疑长篇', 'utf8');
    const server = createWebServer({ root });

    const listResponse = await server.fetch(new Request('http://local/api/assets'));
    const listBody = await listResponse.json();
    const detailResponse = await server.fetch(new Request('http://local/api/assets/product'));
    const detailBody = await detailResponse.json();
    const escapeResponse = await server.fetch(new Request('http://local/api/assets/../../package'));

    assert.equal(listResponse.status, 200);
    assert.equal(listBody.assets.items.find((item) => item.id === 'product').status, 'available');
    assert.equal(detailResponse.status, 200);
    assert.match(detailBody.asset.content, /产品承诺/);
    assert.equal(escapeResponse.status, 404);
  });
});

test('web server keeps room cockpit overview isolated', async () => {
  await withTempRoot(async (root) => {
    const server = createWebServer({
      root,
      env: { AUTHOROS_WEB_ROOMS: '1,2' },
    });

    const ok = await server.fetch(new Request('http://local/room/room1/api/cockpit', {
      headers: { authorization: 'Bearer 1' },
    }));
    const wrongToken = await server.fetch(new Request('http://local/room/room1/api/cockpit', {
      headers: { authorization: 'Bearer 2' },
    }));

    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).nextAction.kind, 'new_book');
    assert.equal(wrongToken.status, 401);
  });
});

test('web server keeps room cockpit jobs isolated', async () => {
  await withTempRoot(async (root) => {
    const server = createWebServer({
      root,
      env: { AUTHOROS_WEB_ROOMS: '1,2' },
      agentMode: 'rule',
    });

    await server.fetch(new Request('http://local/room/room1/api/chat', {
      method: 'POST',
      headers: { authorization: 'Bearer 1' },
      body: JSON.stringify({ message: '读最新章' }),
    }));
    await waitForJob(server, 'http://local/room/room1/api/jobs', { authorization: 'Bearer 1' });

    const room1 = await server.fetch(new Request('http://local/room/room1/api/cockpit', {
      headers: { authorization: 'Bearer 1' },
    }));
    const room2 = await server.fetch(new Request('http://local/room/room2/api/cockpit', {
      headers: { authorization: 'Bearer 2' },
    }));

    assert.equal((await room1.json()).jobs.length, 1);
    assert.equal((await room2.json()).jobs.length, 0);
  });
});

test('web server persists job history across server instances', async () => {
  await withTempRoot(async (root) => {
    const first = createWebServer({ root, agentMode: 'rule', env: {} });
    await first.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '继续写' }),
    }));
    await waitForJob(first, 'http://local/api/jobs');

    const second = createWebServer({ root, agentMode: 'rule', env: {} });
    const response = await second.fetch(new Request('http://local/api/jobs'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.jobs[0].action, 'continue_book');
  });
});

test('web server keeps room job history isolated', async () => {
  await withTempRoot(async (root) => {
    const server = createWebServer({
      root,
      env: { AUTHOROS_WEB_ROOMS: '1,2' },
      agentMode: 'rule',
    });

    await server.fetch(new Request('http://local/room/room1/api/chat', {
      method: 'POST',
      headers: { authorization: 'Bearer 1' },
      body: JSON.stringify({ message: '读最新章' }),
    }));
    await waitForJob(server, 'http://local/room/room1/api/jobs', { authorization: 'Bearer 1' });

    const room1 = await server.fetch(new Request('http://local/room/room1/api/jobs', {
      headers: { authorization: 'Bearer 1' },
    }));
    const room2 = await server.fetch(new Request('http://local/room/room2/api/jobs', {
      headers: { authorization: 'Bearer 2' },
    }));

    assert.equal((await room1.json()).jobs.length, 1);
    assert.equal((await room2.json()).jobs.length, 0);
  });
});

test('web server marks persisted running jobs as interrupted after restart', async () => {
  await withTempRoot(async (root) => {
    const runningJob: WebJob = {
      id: 'job-1',
      action: 'continue_book',
      status: 'running',
      createdAt: '2026-05-18T00:00:00.000Z',
      updatedAt: '2026-05-18T00:00:00.000Z',
      events: [{
        type: 'received',
        message: '继续写',
        at: '2026-05-18T00:00:00.000Z',
      }],
    };
    saveWebJobHistory(root, [runningJob]);

    const server = createWebServer({ root, agentMode: 'rule', env: {} });
    const response = await server.fetch(new Request('http://local/api/jobs'));
    const body = await response.json();
    const job = body.jobs[0];
    const lastEvent = job.events.at(-1);

    assert.equal(response.status, 200);
    assert.equal(job.status, 'failed');
    assert.match(job.error, /interrupted|已中断/);
    assert.match(lastEvent.type, /failed|interrupted/);
  });
});

test('web server checks room auth before loading room job history', async () => {
  await withTempRoot(async (root) => {
    await writeInvalidJobHistory(join(root, 'rooms', 'room1'));
    const server = createWebServer({
      root,
      env: { AUTHOROS_WEB_ROOMS: '1,2' },
      agentMode: 'rule',
    });

    const response = await server.fetch(new Request('http://local/room/room1/api/jobs', {
      headers: { authorization: 'Bearer wrong' },
    }));

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'access token required' });
  });
});

test('web server does not load unscoped root job history for room-only routes', async () => {
  await withTempRoot(async (root) => {
    await writeInvalidJobHistory(root);
    const server = createWebServer({
      root,
      env: { AUTHOROS_WEB_ROOMS: '1,2' },
      agentMode: 'rule',
    });

    const response = await server.fetch(new Request('http://local/api/session'));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { tokenRequired: true, rooms: true });
  });
});
