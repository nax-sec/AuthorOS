import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebServer } from '../src/web/server.ts';
import { run } from '../src/cli.ts';

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
  const server = createWebServer({ root: 'D:\\tmp\\missing' });

  const response = await server.fetch(new Request('http://local/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: '我想看一本赛博香港侦探小说' }),
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.action, 'new_book_intake');
  assert.match(body.message, /先确认几个开书问题/);
});

test('web server can use llm agent mode for vague messages', async () => {
  const server = createWebServer({
    root: 'D:\\tmp\\missing',
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
