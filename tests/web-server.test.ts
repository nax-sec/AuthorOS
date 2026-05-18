import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebServer } from '../src/web/server.ts';
import { saveWebJobHistory } from '../src/web/job-persistence.ts';
import type { WebJob } from '../src/web/jobs.ts';
import { run } from '../src/cli.ts';

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
    assert.match(body.message, /先确认几个开书问题/);
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

    const jobs = await server.fetch(new Request('http://local/api/jobs'));
    const body = await jobs.json();

    assert.equal(jobs.status, 200);
    assert.equal(body.jobs.length, 1);
    assert.equal(body.jobs[0].action, 'read_chapter');
  });
});

test('web server persists job history across server instances', async () => {
  await withTempRoot(async (root) => {
    const first = createWebServer({ root, agentMode: 'rule', env: {} });
    await first.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '继续写' }),
    }));

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
