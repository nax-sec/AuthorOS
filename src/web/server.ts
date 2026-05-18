import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWebAgentSession, handleAgentMessage, type WebAgentCommand } from './agent.ts';
import { emptyCockpitAssetOverview, getCockpitAssetOverview, readCockpitAsset } from './assets.ts';
import { createJobStore, type WebJob } from './jobs.ts';
import { loadWebJobHistory, saveWebJobHistory } from './job-persistence.ts';
import { withJobCompletion, type CompletedCommandType } from './job-completion.ts';
import { explainJobFailure } from './job-failure.ts';
import { isAuthorized } from './auth.ts';
import { getCockpitOverview } from './cockpit.ts';
import { getCurrentPreviewComparison } from './quality.ts';
import { buildChaptersZip, readChapterDownload, type DownloadResult } from './downloads.ts';
import { handleAgentMessageWithLlm, type WebAgentMode } from './agent-llm.ts';
import {
  applyPrivateFeedback,
  applyPrivateStyleRewrite,
  continuePrivateBook,
  createPrivateBook,
  getCurrentPrivateBook,
  getPrivateStatus,
  listPrivateBooks,
  previewPrivateFeedback,
  previewPrivateStyleRewrite,
  readPrivateChapter,
  switchPrivateBook,
  type PrivateShelf,
} from '../commands/private.ts';
import { bindStyleProfile, createStyleProfileFromText, saveStyleProfile, type StyleProfile } from '../commands/style.ts';
import {
  clearModelConfig,
  getModelConfig,
  getModelDoctor,
  updateModelConfig,
  type ModelConfigView,
  type ModelDoctorResult,
} from '../commands/model.ts';
import { createChapterReview } from '../commands/review.ts';
import { createChapterDecision } from '../commands/decide.ts';
import { createMemoryUpdate, markMemoryDeltaReviewed, mergeMemoryDelta, previewMemoryDeltaMerge, showMemoryDelta } from '../commands/memory.ts';
import { createOpenAiCompatibleClientFromProject, type LlmClient } from '../core/llm.ts';
import {
  resetProjectModelApiKey,
  setProjectModelApiKey,
  type EnvLike,
  type ProjectModelConfigPatch,
} from '../core/modelConfig.ts';

export interface PrivateWebApi {
  listBooks?: (root: string) => Promise<PrivateShelf>;
}

export interface CreateWebServerOptions {
  root: string;
  token?: string;
  env?: EnvLike;
  privateApi?: PrivateWebApi;
  agentMode?: WebAgentMode;
  agentLlm?: LlmClient;
  writingLlm?: LlmClient;
}

interface WebRoom {
  id: string;
  token: string;
  root: string;
}

interface WebRuntime {
  session: ReturnType<typeof createWebAgentSession>;
  jobs: ReturnType<typeof createJobStore>;
}

interface WebModelDoctorResult {
  scope:
    | { kind: 'private_root'; label: string; path: string }
    | { kind: 'current_book'; label: string; bookId: string; path: string };
  doctor: ModelDoctorResult;
}

interface WebModelConfigResult {
  scope:
    | { kind: 'private_root'; label: string; path: string }
    | { kind: 'current_book'; label: string; bookId: string; path: string };
  config: ModelConfigView;
}

export interface AuthorWebServer {
  fetch(request: Request): Promise<Response>;
  listen(port: number, host?: string): Promise<{ close: () => Promise<void> }>;
}

const appHtmlUrl = new URL('./public/app.html', import.meta.url);

export function createWebServer(options: CreateWebServerOptions): AuthorWebServer {
  const env = options.env ?? process.env;
  const rooms = parseRooms(options.root, env.AUTHOROS_WEB_ROOMS);
  let singleRuntime: WebRuntime | undefined;
  const roomRuntimes = new Map<string, WebRuntime>();

  async function fetchHandler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return html(await readFile(fileURLToPath(appHtmlUrl), 'utf8'));
      }
      if (url.pathname === '/api/session') {
        return json({ tokenRequired: Boolean(options.token) || rooms.length > 0, rooms: rooms.length > 0 });
      }
      if (url.pathname === '/api/login' && request.method === 'POST') {
        if (rooms.length === 0) return json({ ok: true, roomPath: '/' });
        const body = await request.json() as { token?: string };
        const room = rooms.find((candidate) => candidate.token === (body.token ?? '').trim());
        if (!room) return json({ error: 'invalid access code' }, 401);
        return json({ ok: true, roomId: room.id, roomPath: `/room/${room.id}` });
      }
      const roomRoute = resolveRoomRoute(url.pathname, rooms);
      if (roomRoute?.page) {
        return html(await readFile(fileURLToPath(appHtmlUrl), 'utf8'));
      }
      if (rooms.length > 0 && !roomRoute && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/download/') || url.pathname.startsWith('/room/'))) {
        return json({ error: 'room required' }, 404);
      }
      const routePath = roomRoute?.path ?? url.pathname;
      const root = roomRoute?.room.root ?? options.root;
      const token = roomRoute?.room.token ?? options.token;
      if ((routePath.startsWith('/api/') || routePath.startsWith('/download/')) && !isAuthorized(request, token)) {
        return json({ error: 'access token required' }, 401);
      }
      if (routePath === '/api/books' && request.method === 'GET') {
        return json(await webListBooks({ ...options, root }));
      }
      if (routePath === '/api/status' && request.method === 'GET') {
        return json(await getPrivateStatus(root));
      }
      if (routePath === '/api/cockpit' && request.method === 'GET') {
        const runtime = runtimeForRoute(roomRoute, () => singleRuntime ??= createRuntimeForRoot(options.root), roomRuntimes);
        return json(await getCockpitOverview(root, env, runtime.jobs));
      }
      if (routePath === '/api/jobs' && request.method === 'GET') {
        const runtime = runtimeForRoute(roomRoute, () => singleRuntime ??= createRuntimeForRoot(options.root), roomRuntimes);
        return json({ jobs: runtime.jobs.list() });
      }
      if (routePath === '/api/previews/current' && request.method === 'GET') {
        const target = await getWebModelTarget(root);
        if (target.scope.kind !== 'current_book') return json({ comparison: null });
        return json({ comparison: await getCurrentPreviewComparison(target.projectDir) });
      }
      if (routePath === '/api/assets' && request.method === 'GET') {
        const target = await getWebModelTarget(root);
        if (target.scope.kind !== 'current_book') return json({ assets: emptyCockpitAssetOverview() });
        return json({ assets: await getCockpitAssetOverview(target.projectDir) });
      }
      const assetMatch = routePath.match(/^\/api\/assets\/([a-z0-9_-]+)$/);
      if (assetMatch?.[1] && request.method === 'GET') {
        const target = await getWebModelTarget(root);
        if (target.scope.kind !== 'current_book') return json({ error: 'no current book' }, 404);
        const asset = await readCockpitAsset(target.projectDir, assetMatch[1]);
        return asset ? json({ asset }) : json({ error: 'asset not found' }, 404);
      }
      if (routePath === '/api/model/doctor' && request.method === 'GET') {
        return json(await getWebModelDoctor(root, env));
      }
      if (routePath === '/api/model/config' && request.method === 'GET') {
        return json(await getWebModelConfig(root, env));
      }
      if (routePath === '/api/model/config' && request.method === 'POST') {
        const body = await request.json() as {
          apiKeyEnv?: unknown;
          baseUrl?: unknown;
          model?: unknown;
          apiKey?: unknown;
          clearApiKey?: unknown;
        };
        const target = await getWebModelTarget(root);
        const patch = modelConfigPatchFromBody(body);
        if (Object.keys(patch).length > 0) {
          await updateModelConfig(target.projectDir, patch);
        }
        if (body.clearApiKey === true) {
          await resetProjectModelApiKey(target.projectDir);
        } else if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
          await setProjectModelApiKey(target.projectDir, body.apiKey);
        }
        return json({ ok: true, ...await getWebModelConfig(root, env) });
      }
      if (routePath === '/api/model/config/reset' && request.method === 'POST') {
        const target = await getWebModelTarget(root);
        await clearModelConfig(target.projectDir);
        await resetProjectModelApiKey(target.projectDir);
        return json({ ok: true, ...await getWebModelConfig(root, env) });
      }
      const memoryDeltaReviewedMatch = routePath.match(/^\/api\/memory\/deltas\/([^/]+)\/reviewed$/);
      if (memoryDeltaReviewedMatch?.[1] && request.method === 'POST') {
        const book = await getCurrentPrivateBook(root);
        const result = await markMemoryDeltaReviewed(join(root, book.path), decodeURIComponent(memoryDeltaReviewedMatch[1]));
        return json({ ok: true, ...result });
      }
      const memoryDeltaMergeMatch = routePath.match(/^\/api\/memory\/deltas\/([^/]+)\/merge$/);
      if (memoryDeltaMergeMatch?.[1] && request.method === 'POST') {
        const book = await getCurrentPrivateBook(root);
        const result = await mergeMemoryDelta(join(root, book.path), decodeURIComponent(memoryDeltaMergeMatch[1]));
        return json({ ok: true, ...result });
      }
      const memoryDeltaMergePreviewMatch = routePath.match(/^\/api\/memory\/deltas\/([^/]+)\/merge-preview$/);
      if (memoryDeltaMergePreviewMatch?.[1] && request.method === 'GET') {
        const book = await getCurrentPrivateBook(root);
        const result = await previewMemoryDeltaMerge(join(root, book.path), decodeURIComponent(memoryDeltaMergePreviewMatch[1]));
        return json({ ok: true, ...result });
      }
      const memoryDeltaMatch = routePath.match(/^\/api\/memory\/deltas\/([^/]+)$/);
      if (memoryDeltaMatch?.[1] && request.method === 'GET') {
        const book = await getCurrentPrivateBook(root);
        const name = decodeURIComponent(memoryDeltaMatch[1]);
        return json({
          name,
          content: await showMemoryDelta(join(root, book.path), name),
        });
      }
      const qualityArtifactMatch = routePath.match(/^\/api\/quality\/artifacts\/([^/]+)\/(\d+)$/);
      if (qualityArtifactMatch?.[1] && qualityArtifactMatch?.[2] && request.method === 'GET') {
        const artifact = qualityArtifactPath(qualityArtifactMatch[1], Number(qualityArtifactMatch[2]));
        if (!artifact) return json({ error: 'invalid quality artifact' }, 400);
        const book = await getCurrentPrivateBook(root);
        const content = await readFile(join(root, book.path, artifact.path), 'utf8');
        return json({
          type: artifact.type,
          chapter: artifact.chapter,
          path: artifact.path,
          content: content.endsWith('\n') ? content : `${content}\n`,
        });
      }
      if (routePath === '/api/style/bind' && request.method === 'POST') {
        const body = await request.json() as { profileId?: unknown };
        const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : '';
        if (!profileId) return json({ error: 'profileId is required' }, 400);
        const book = await getCurrentPrivateBook(root);
        const binding = await bindStyleProfile(root, join(root, book.path), profileId);
        return json({ ok: true, binding });
      }
      if (routePath === '/api/style/extract' && request.method === 'POST') {
        const body = await request.json() as { name?: unknown; text?: unknown; bind?: unknown };
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const text = typeof body.text === 'string' ? body.text : '';
        const shouldBind = body.bind === true;
        if (!name) return json({ error: 'name is required' }, 400);
        if (!text.trim()) return json({ error: 'text is required' }, 400);
        const profile = createStyleProfileFromText(root, {
          name,
          text,
          sourceNote: 'web cockpit sample',
        });
        const path = await saveStyleProfile(root, profile);
        let binding = null;
        if (shouldBind) {
          try {
            const book = await getCurrentPrivateBook(root);
            binding = await bindStyleProfile(root, join(root, book.path), profile.id);
          } catch (error) {
            if (!(error instanceof Error && /No current private book/.test(error.message))) throw error;
          }
        }
        return json({ ok: true, profile, summary: summarizeStyleProfile(profile), path, binding });
      }
      if (routePath === '/api/chat' && request.method === 'POST') {
        const runtime = runtimeForRoute(roomRoute, () => singleRuntime ??= createRuntimeForRoot(options.root), roomRuntimes);
        const body = await request.json() as { message?: string };
        const result = await resolveAgentMessage({ ...options, root }, runtime.session, body.message ?? '', env);
        if (result.kind === 'reply') return json(result);
        const job = runtime.jobs.createJob(result.action, result.message);
        void runCommandJob(root, result.command, runtime.jobs, job.id, env, options.writingLlm);
        return json({ ...result, jobId: job.id });
      }
      const jobEventsMatch = routePath.match(/^\/api\/jobs\/([^/]+)\/events$/);
      if (jobEventsMatch?.[1] && request.method === 'GET') {
        const runtime = runtimeForRoute(roomRoute, () => singleRuntime ??= createRuntimeForRoot(options.root), roomRuntimes);
        return sseStream(runtime.jobs, jobEventsMatch[1], request.signal);
      }
      const chapterMatch = routePath.match(/^\/api\/chapters\/([^/]+)$/);
      if (chapterMatch?.[1] && request.method === 'GET') {
        const chapter = chapterMatch[1] === 'latest' ? 'latest' : Number(chapterMatch[1]);
        if (chapter !== 'latest' && !Number.isInteger(chapter)) return json({ error: 'invalid chapter' }, 400);
        return json(await readPrivateChapter(root, { chapter }));
      }
      const downloadChapterMatch = routePath.match(/^\/download\/chapter\/([^/]+)$/);
      if (downloadChapterMatch?.[1] && request.method === 'GET') {
        const chapter = downloadChapterMatch[1];
        const result = chapter === 'latest'
          ? await latestChapterDownload(root)
          : await currentBookChapterDownload(root, Number(chapter));
        return download(result);
      }
      if (routePath === '/download/chapters.zip' && request.method === 'GET') {
        const book = await getCurrentPrivateBook(root);
        return download(await buildChaptersZip(join(root, book.path)));
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

function parseRooms(root: string, value: string | undefined): WebRoom[] {
  if (!value?.trim()) return [];
  return value.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [rawId, rawToken] = part.includes(':') ? part.split(':', 2) : [`room${part}`, part];
      const id = safeRoomId(rawId.trim());
      const token = (rawToken ?? '').trim();
      if (!id || !token) throw new Error(`invalid room config entry: ${part}`);
      return { id, token, root: join(root, 'rooms', id) };
    });
}

function safeRoomId(value: string): string {
  return /^[a-zA-Z0-9_-]+$/.test(value) ? value : '';
}

function resolveRoomRoute(pathname: string, rooms: WebRoom[]): { room: WebRoom; path: string; page: boolean } | undefined {
  if (rooms.length === 0) return undefined;
  const match = pathname.match(/^\/room\/([^/]+)(\/.*)?$/);
  if (!match?.[1]) return undefined;
  const room = rooms.find((candidate) => candidate.id === match[1]);
  if (!room) return undefined;
  const rest = match[2] ?? '/';
  return { room, path: rest === '/index.html' ? '/' : rest, page: rest === '/' || rest === '/index.html' };
}

function createRuntimeForRoot(root: string): WebRuntime {
  const recovered = recoverInterruptedJobs(loadWebJobHistory(root));
  if (recovered.changed) saveWebJobHistory(root, recovered.jobs);
  return {
    session: createWebAgentSession(),
    jobs: createJobStore({
      initialJobs: recovered.jobs,
      onChange: (jobs) => saveWebJobHistory(root, jobs),
    }),
  };
}

function qualityArtifactPath(
  type: string,
  chapter: number,
): { type: string; chapter: number; path: string } | null {
  if (!Number.isInteger(chapter) || chapter < 1) return null;
  const chapterId = String(chapter).padStart(4, '0');
  if (type === 'internal_review') return { type, chapter, path: `reviews/${chapterId}.internal.md` };
  if (type === 'reader_sim_review') return { type, chapter, path: `reviews/${chapterId}.reader-sim.md` };
  if (type === 'chapter_decision') return { type, chapter, path: `decisions/${chapterId}.md` };
  return null;
}

function recoverInterruptedJobs(jobs: WebJob[]): { jobs: WebJob[]; changed: boolean } {
  const at = new Date().toISOString();
  let changed = false;
  const recovered = jobs.map((job) => {
    if (job.status !== 'running') return job;
    changed = true;
    return {
      ...job,
      status: 'failed' as const,
      updatedAt: at,
      error: 'interrupted: service restarted',
      events: [
        ...job.events,
        { type: 'interrupted', message: '服务重启，任务已中断。', at },
      ],
    };
  });
  return { jobs: recovered, changed };
}

function runtimeForRoute(
  route: { room: WebRoom } | undefined,
  single: () => WebRuntime,
  runtimes: Map<string, WebRuntime>,
): WebRuntime {
  return route?.room ? runtimeForRoom(runtimes, route.room) : single();
}

function runtimeForRoom(runtimes: Map<string, WebRuntime>, room: WebRoom): WebRuntime {
  const existing = runtimes.get(room.id);
  if (existing) return existing;
  const runtime = createRuntimeForRoot(room.root);
  runtimes.set(room.id, runtime);
  return runtime;
}

async function resolveAgentMessage(
  options: CreateWebServerOptions,
  session: ReturnType<typeof createWebAgentSession>,
  message: string,
  env: EnvLike,
) {
  const mode = options.agentMode ?? optionalAgentMode(env.AUTHOROS_WEB_AGENT) ?? 'hybrid';
  if (mode === 'rule') return handleAgentMessage(session, message);
  try {
    const llm = options.agentLlm ?? await createAgentClient(options.root, env);
    return await handleAgentMessageWithLlm(session, message, { mode, llm });
  } catch {
    return handleAgentMessage(session, message);
  }
}

async function webListBooks(options: CreateWebServerOptions): Promise<PrivateShelf> {
  if (options.privateApi?.listBooks) return await options.privateApi.listBooks(options.root);
  return await listPrivateBooks(options.root);
}

async function getWebModelDoctor(root: string, env: EnvLike): Promise<WebModelDoctorResult> {
  const target = await getWebModelTarget(root);
  return {
    scope: target.scope,
    doctor: await getModelDoctor(target.projectDir, env),
  };
}

async function getWebModelConfig(root: string, env: EnvLike): Promise<WebModelConfigResult> {
  const target = await getWebModelTarget(root);
  return {
    scope: target.scope,
    config: await getModelConfig(target.projectDir, env),
  };
}

async function getWebModelTarget(root: string): Promise<{
  projectDir: string;
  scope: WebModelConfigResult['scope'];
}> {
  const shelf = await listPrivateBooks(root);
  const current = shelf.current ? shelf.books.find((book) => book.id === shelf.current) : null;
  if (current) {
    return {
      projectDir: join(root, current.path),
      scope: {
        kind: 'current_book',
        label: current.title,
        bookId: current.id,
        path: current.path,
      },
    };
  }

  return {
    projectDir: root,
    scope: {
      kind: 'private_root',
      label: '个人根目录',
      path: '.',
    },
  };
}

function modelConfigPatchFromBody(body: {
  apiKeyEnv?: unknown;
  baseUrl?: unknown;
  model?: unknown;
}): ProjectModelConfigPatch {
  const patch: ProjectModelConfigPatch = {};
  if (typeof body.apiKeyEnv === 'string' && body.apiKeyEnv.trim()) patch.apiKeyEnv = body.apiKeyEnv;
  if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) patch.baseUrl = body.baseUrl;
  if (typeof body.model === 'string' && body.model.trim()) patch.model = body.model;
  return patch;
}

async function runCommandJob(
  root: string,
  command: WebAgentCommand,
  jobs: ReturnType<typeof createJobStore>,
  jobId: string,
  env: EnvLike,
  writingLlm?: LlmClient,
): Promise<void> {
  try {
    if (command.type === 'new_book') {
      jobs.append(jobId, 'setup', '正在生成作品定位、世界观、人物和大纲');
      const llm = await createClient(root, env);
      const result = await createPrivateBook({ root, concept: command.concept, title: command.title, llm });
      completeCommandJob(jobs, jobId, command.type, { book: result.book });
      return;
    }
    if (command.type === 'new_book_and_continue') {
      jobs.append(jobId, 'setup', '正在建立作品设定。完成后会直接开始第 1 章。');
      const setupLlm = await createClient(root, env);
      const setup = await createPrivateBook({ root, concept: command.concept, title: command.title, llm: setupLlm });
      jobs.append(jobId, 'planning', '作品已建好，正在规划第 1 章。');
      const writeLlm = await createClientForCurrentBook(root, env);
      const result = await continuePrivateBook(root, { llm: writeLlm });
      completeCommandJob(jobs, jobId, command.type, { book: setup.book, chapter: result.write.chapter });
      return;
    }
    if (command.type === 'continue') {
      jobs.append(jobId, 'planning', '正在规划下一章');
      const llm = await createClientForCurrentBook(root, env);
      const result = await continuePrivateBook(root, { llm });
      completeCommandJob(jobs, jobId, command.type, { book: result.book, chapter: result.write.chapter });
      return;
    }
    if (command.type === 'feedback') {
      jobs.append(jobId, 'revision_preview', '正在生成修改预览');
      const llm = writingLlm ?? await createClientForCurrentBook(root, env);
      const result = await previewPrivateFeedback(root, { chapter: command.chapter, text: command.text, llm });
      completeCommandJob(jobs, jobId, command.type, { book: result.book, chapter: result.chapter, pending: result.pendingPath });
      return;
    }
    if (command.type === 'apply') {
      jobs.append(jobId, 'applying', '正在应用待确认修改');
      const result = await applyPrivateFeedback(root, {
        llm: writingLlm,
        getLlm: () => createClientForCurrentBook(root, env),
      });
      completeCommandJob(jobs, jobId, command.type, { book: result.book, chapter: result.chapter });
      return;
    }
    if (command.type === 'style_rewrite') {
      jobs.append(jobId, 'style_check', '正在生成文风改写预览');
      const llm = writingLlm ?? await createClientForCurrentBook(root, env);
      const result = await previewPrivateStyleRewrite(root, {
        chapter: command.chapter,
        intent: command.intent,
        text: command.text,
        llm,
      });
      completeCommandJob(jobs, jobId, command.type, { book: result.book, chapter: result.chapter, pending: result.pendingPath, profile: result.profile.id });
      return;
    }
    if (command.type === 'style_apply') {
      jobs.append(jobId, 'style_apply', '正在应用文风改写预览');
      const result = await applyPrivateStyleRewrite(root);
      completeCommandJob(jobs, jobId, command.type, { book: result.book, chapter: result.chapter, profile: result.profileId });
      return;
    }
    if (command.type === 'review') {
      const phase = command.mode === 'internal' ? 'internal_review' : 'reader_sim_review';
      jobs.append(jobId, phase, `正在生成第 ${command.chapter} 章${command.mode === 'internal' ? '内评' : '读者模拟'}`);
      const book = await getCurrentPrivateBook(root);
      const llm = writingLlm ?? await createClientForCurrentBook(root, env);
      const result = await createChapterReview(join(root, book.path), {
        chapter: command.chapter,
        mode: command.mode,
        llm,
        write: true,
      });
      completeCommandJob(jobs, jobId, phase, { book, chapter: result.chapter, artifacts: result.artifacts.map((artifact) => artifact.path) });
      return;
    }
    if (command.type === 'decide') {
      jobs.append(jobId, 'chapter_decision', `正在生成第 ${command.chapter} 章创作决策`);
      const book = await getCurrentPrivateBook(root);
      const llm = writingLlm ?? await createClientForCurrentBook(root, env);
      const result = await createChapterDecision(join(root, book.path), {
        chapter: command.chapter,
        llm,
        write: true,
      });
      completeCommandJob(jobs, jobId, 'chapter_decision', { book, chapter: result.chapter, path: result.path });
      return;
    }
    if (command.type === 'memory_update') {
      jobs.append(jobId, 'memory_update', `正在生成第 ${command.chapter} 章记忆更新`);
      const book = await getCurrentPrivateBook(root);
      const llm = writingLlm ?? await createClientForCurrentBook(root, env);
      const result = await createMemoryUpdate(join(root, book.path), {
        chapter: command.chapter,
        llm,
        write: true,
      });
      completeCommandJob(jobs, jobId, 'memory_update', { book, chapter: result.chapter, path: result.path });
      return;
    }
    if (command.type === 'read') {
      const result = await readPrivateChapter(root, { chapter: command.chapter });
      completeCommandJob(jobs, jobId, command.type, result);
      return;
    }
    if (command.type === 'download_chapter' || command.type === 'download_all' || command.type === 'status') {
      completeCommandJob(jobs, jobId, command.type, { ok: true });
      return;
    }
  } catch (error) {
    const failure = explainJobFailure(error);
    jobs.fail(jobId, failure.title, failure);
  }
}

function completeCommandJob(
  jobs: ReturnType<typeof createJobStore>,
  jobId: string,
  command: CompletedCommandType,
  result: Record<string, unknown>,
): void {
  jobs.complete(jobId, withJobCompletion(command, result));
}

function summarizeStyleProfile(profile: StyleProfile): {
  id: string;
  name: string;
  description: string;
  rulesPreview: string[];
} {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    rulesPreview: [
      ...profile.rules.antiAiVoice,
      ...profile.rules.avoid,
    ].slice(0, 3),
  };
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
