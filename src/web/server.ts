import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWebAgentSession, handleAgentMessage, type WebAgentCommand } from './agent.ts';
import { createJobStore } from './jobs.ts';
import { isAuthorized } from './auth.ts';
import { buildChaptersZip, readChapterDownload, type DownloadResult } from './downloads.ts';
import { handleAgentMessageWithLlm, type WebAgentMode } from './agent-llm.ts';
import {
  applyPrivateFeedback,
  continuePrivateBook,
  createPrivateBook,
  getCurrentPrivateBook,
  getPrivateStatus,
  listPrivateBooks,
  previewPrivateFeedback,
  readPrivateChapter,
  switchPrivateBook,
  type PrivateShelf,
} from '../commands/private.ts';
import { createOpenAiCompatibleClientFromProject, type LlmClient } from '../core/llm.ts';
import type { EnvLike } from '../core/modelConfig.ts';

export interface PrivateWebApi {
  listBooks?: () => Promise<PrivateShelf>;
}

export interface CreateWebServerOptions {
  root: string;
  token?: string;
  env?: EnvLike;
  privateApi?: PrivateWebApi;
  agentMode?: WebAgentMode;
  agentLlm?: LlmClient;
}

export interface AuthorWebServer {
  fetch(request: Request): Promise<Response>;
  listen(port: number, host?: string): Promise<{ close: () => Promise<void> }>;
}

const appHtmlUrl = new URL('./public/app.html', import.meta.url);

export function createWebServer(options: CreateWebServerOptions): AuthorWebServer {
  const session = createWebAgentSession();
  const jobs = createJobStore();
  const env = options.env ?? process.env;

  async function fetchHandler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return html(await readFile(fileURLToPath(appHtmlUrl), 'utf8'));
      }
      if (url.pathname === '/api/session') {
        return json({ tokenRequired: Boolean(options.token) });
      }
      if ((url.pathname.startsWith('/api/') || url.pathname.startsWith('/download/')) && !isAuthorized(request, options.token)) {
        return json({ error: 'access token required' }, 401);
      }
      if (url.pathname === '/api/books' && request.method === 'GET') {
        return json(await webListBooks(options));
      }
      if (url.pathname === '/api/status' && request.method === 'GET') {
        return json(await getPrivateStatus(options.root));
      }
      if (url.pathname === '/api/chat' && request.method === 'POST') {
        const body = await request.json() as { message?: string };
        const result = await resolveAgentMessage(options, session, body.message ?? '', env);
        if (result.kind === 'reply') return json(result);
        const job = jobs.createJob(result.action, result.message);
        void runCommandJob(options.root, result.command, jobs, job.id, env);
        return json({ ...result, jobId: job.id });
      }
      const jobEventsMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);
      if (jobEventsMatch?.[1] && request.method === 'GET') {
        return sseStream(jobs, jobEventsMatch[1], request.signal);
      }
      const chapterMatch = url.pathname.match(/^\/api\/chapters\/([^/]+)$/);
      if (chapterMatch?.[1] && request.method === 'GET') {
        const chapter = chapterMatch[1] === 'latest' ? 'latest' : Number(chapterMatch[1]);
        if (chapter !== 'latest' && !Number.isInteger(chapter)) return json({ error: 'invalid chapter' }, 400);
        return json(await readPrivateChapter(options.root, { chapter }));
      }
      const downloadChapterMatch = url.pathname.match(/^\/download\/chapter\/([^/]+)$/);
      if (downloadChapterMatch?.[1] && request.method === 'GET') {
        const chapter = downloadChapterMatch[1];
        const result = chapter === 'latest'
          ? await latestChapterDownload(options.root)
          : await currentBookChapterDownload(options.root, Number(chapter));
        return download(result);
      }
      if (url.pathname === '/download/chapters.zip' && request.method === 'GET') {
        const book = await getCurrentPrivateBook(options.root);
        return download(await buildChaptersZip(join(options.root, book.path)));
      }
      return json({ error: 'not found' }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  return {
    fetch: fetchHandler,
    async listen(port, host = '127.0.0.1') {
      const server = createServer((req, res) => {
        void toRequest(req, host, port)
          .then(fetchHandler)
          .then((response) => writeResponse(res, response))
          .catch((error: unknown) => writeResponse(res, json({ error: error instanceof Error ? error.message : String(error) }, 500)));
      });
      await new Promise<void>((resolve) => server.listen(port, host, resolve));
      return {
        close: async () => {
          await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        },
      };
    },
  };
}

async function resolveAgentMessage(
  options: CreateWebServerOptions,
  session: ReturnType<typeof createWebAgentSession>,
  message: string,
  env: EnvLike,
) {
  const mode = options.agentMode ?? optionalAgentMode(env.AUTHOROS_WEB_AGENT) ?? 'hybrid';
  if (mode === 'rule') return handleAgentMessage(session, message);
  if (mode === 'hybrid') {
    const ruleResult = handleAgentMessage(session, message);
    if (ruleResult.action !== 'unknown') return ruleResult;
  }
  const llm = options.agentLlm ?? await createAgentClient(options.root, env);
  return await handleAgentMessageWithLlm(session, message, { mode, llm });
}

async function webListBooks(options: CreateWebServerOptions): Promise<PrivateShelf> {
  if (options.privateApi?.listBooks) return await options.privateApi.listBooks();
  return await listPrivateBooks(options.root);
}

async function runCommandJob(
  root: string,
  command: WebAgentCommand,
  jobs: ReturnType<typeof createJobStore>,
  jobId: string,
  env: EnvLike,
): Promise<void> {
  try {
    if (command.type === 'new_book') {
      jobs.append(jobId, 'setup', '正在生成作品定位、世界观、人物和大纲');
      const llm = await createClient(root, env);
      const result = await createPrivateBook({ root, concept: command.concept, title: command.title, llm });
      jobs.complete(jobId, { book: result.book });
      return;
    }
    if (command.type === 'continue') {
      jobs.append(jobId, 'planning', '正在规划下一章');
      const llm = await createClientForCurrentBook(root, env);
      const result = await continuePrivateBook(root, { llm });
      jobs.complete(jobId, { book: result.book, chapter: result.write.chapter });
      return;
    }
    if (command.type === 'feedback') {
      jobs.append(jobId, 'revision_preview', '正在生成修改预览');
      const llm = await createClientForCurrentBook(root, env);
      const result = await previewPrivateFeedback(root, { chapter: command.chapter, text: command.text, llm });
      jobs.complete(jobId, { book: result.book, chapter: result.chapter, pending: result.pendingPath });
      return;
    }
    if (command.type === 'apply') {
      jobs.append(jobId, 'applying', '正在应用待确认修改');
      const llm = await createClientForCurrentBook(root, env);
      const result = await applyPrivateFeedback(root, { llm });
      jobs.complete(jobId, { book: result.book, chapter: result.chapter });
      return;
    }
    if (command.type === 'read') {
      const result = await readPrivateChapter(root, { chapter: command.chapter });
      jobs.complete(jobId, result);
      return;
    }
    if (command.type === 'download_chapter' || command.type === 'download_all' || command.type === 'status') {
      jobs.complete(jobId, { ok: true });
      return;
    }
  } catch (error) {
    jobs.fail(jobId, error instanceof Error ? error.message : String(error));
  }
}

async function createClient(root: string, env: EnvLike): Promise<LlmClient> {
  return await createOpenAiCompatibleClientFromProject(root, env);
}

async function createAgentClient(root: string, env: EnvLike): Promise<LlmClient> {
  return await createOpenAiCompatibleClientFromProject(root, {
    ...env,
    AUTHOROS_MODEL: env.AUTHOROS_WEB_AGENT_MODEL ?? env.AUTHOROS_MODEL,
  });
}

function optionalAgentMode(value: string | undefined): WebAgentMode | undefined {
  if (value === 'rule' || value === 'llm' || value === 'hybrid') return value;
  return undefined;
}

async function createClientForCurrentBook(root: string, env: EnvLike): Promise<LlmClient> {
  const book = await getCurrentPrivateBook(root);
  return await createOpenAiCompatibleClientFromProject(join(root, book.path), env);
}

async function latestChapterDownload(root: string): Promise<DownloadResult> {
  const result = await readPrivateChapter(root, { chapter: 'latest' });
  return {
    filename: `chapter-${String(result.chapter).padStart(4, '0')}.md`,
    contentType: 'text/markdown; charset=utf-8',
    body: Buffer.from(result.content, 'utf8'),
  };
}

async function currentBookChapterDownload(root: string, chapter: number): Promise<DownloadResult> {
  if (!Number.isInteger(chapter) || chapter < 1) throw new Error('invalid chapter');
  const book = await getCurrentPrivateBook(root);
  return await readChapterDownload(join(root, book.path), chapter);
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function html(value: string): Response {
  return new Response(value, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function download(result: DownloadResult): Response {
  return new Response(result.body, {
    headers: {
      'content-type': result.contentType,
      'content-disposition': `attachment; filename="${result.filename}"`,
    },
  });
}

function sseStream(
  jobs: ReturnType<typeof createJobStore>,
  id: string,
  signal: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: { type: string; message: string; at: string; data?: unknown }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        if (event.type === 'completed' || event.type === 'failed') {
          unsubscribe?.();
          controller.close();
        }
      };
      for (const event of jobs.listEvents(id)) send(event);
      const current = jobs.get(id);
      if (current?.status === 'running') {
        unsubscribe = jobs.subscribe(id, send);
      }
      signal.addEventListener('abort', () => {
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }, { once: true });
    },
    cancel() {
      unsubscribe?.();
    },
  });
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
    },
  });
}

async function toRequest(req: IncomingMessage, host: string, port: number): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(', '));
    else if (value !== undefined) headers.set(key, value);
  }
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  const url = `http://${headers.get('host') ?? `${host}:${port}`}${req.url ?? '/'}`;
  return new Request(url, {
    method: req.method ?? 'GET',
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
  });
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}
