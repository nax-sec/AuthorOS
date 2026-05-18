import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getPrivateStatus, listPrivateBooks, readPrivateChapter, type PrivateBook } from '../commands/private.ts';
import type { ProjectStateResult } from '../commands/state.ts';
import { resolveProjectModelConfig, type EnvLike, type ResolvedProjectModelConfig } from '../core/modelConfig.ts';
import { emptyCockpitAssetOverview, getCockpitAssetOverview, type CockpitAssetOverview } from './assets.ts';
import type { JobStore, WebJob } from './jobs.ts';
import { getQualityOverview, type QualityOverview } from './quality.ts';

export interface CockpitOverview {
  books: Array<Pick<PrivateBook, 'id' | 'title' | 'concept' | 'path' | 'last_active_at'>>;
  current: {
    book: PrivateBook;
    state: ProjectStateResult;
    latestChapter: CockpitLatestChapter | null;
    draftedChapters: CockpitDraftedChapter[];
    pendingFeedback: boolean;
  } | null;
  jobs: WebJob[];
  model: Pick<ResolvedProjectModelConfig, 'apiKeyEnv' | 'apiKeySet' | 'apiKeySource' | 'baseUrl' | 'model'>;
  modelHealth: CockpitModelHealth;
  session: CockpitSessionOverview;
  nextAction: CockpitNextAction;
  quality: QualityOverview | null;
  style: CockpitStyleOverview;
  assets: CockpitAssetOverview;
}

export interface CockpitModelHealth {
  status: 'ready' | 'missing_key' | 'configured_without_key';
  label: string;
  detail: string;
  sourceLabel: string;
  actionLabel: string;
}

export interface CockpitSessionOverview {
  service: { status: 'online'; label: string };
  currentBook: { id?: string; label: string };
  currentTask: CockpitSessionTask | null;
  lastCompleted: CockpitSessionTask | null;
  resume: { label: string; available: boolean };
  daily: CockpitDailySession;
}

export interface CockpitDailySession {
  openedAt: string;
  lastActiveBook: { id?: string; label: string } | null;
  currentTask: CockpitSessionTask | null;
  lastCompleted: CockpitSessionTask | null;
  chaptersTouched: number[];
  nextRecommendedAction: { label: string; message: string };
}

export interface CockpitSessionTask {
  jobId: string;
  action: string;
  label: string;
  status: WebJob['status'];
  detail: string;
  updatedAt: string;
}

export interface CockpitStyleOverview {
  profiles: CockpitStyleProfile[];
  binding: CockpitStyleBinding | null;
  currentProfile: CockpitStyleProfile | null;
  generation: CockpitStyleGenerationStatus | null;
}

export interface CockpitStyleProfile {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
  rules?: {
    antiAiVoice?: string[];
  };
}

export interface CockpitStyleBinding {
  version?: number;
  profileId: string;
  boundAt?: string;
}

export interface CockpitStyleGenerationStatus {
  active: boolean;
  snapshotPresent: boolean;
  matchedBinding: boolean;
  profileId?: string;
  label: string;
  detail: string;
}

export interface CockpitLatestChapter {
  chapter: number;
  path: string;
  excerpt: string;
}

export interface CockpitDraftedChapter {
  chapter: number;
  chapterId: string;
  label: string;
}

export type CockpitNextAction =
  | { kind: 'new_book'; label: string; message: string }
  | { kind: 'apply_feedback'; label: string; message: string }
  | { kind: 'continue_book'; label: string; message: string; chapter: number; styleHint?: string };

export async function getCockpitOverview(
  root: string,
  env: EnvLike,
  jobs: JobStore,
): Promise<CockpitOverview> {
  const shelf = await listPrivateBooks(root);
  const styleProfiles = await listCockpitStyleProfiles(root);
  const jobList = jobs.list();
  if (!shelf.current) {
    const model = await resolveProjectModelConfig(root, env);
    const nextAction: CockpitNextAction = {
      kind: 'new_book',
      label: '开一本新书',
      message: '我想开一本新书',
    };
    return {
      books: shelf.books.map(bookSummary),
      current: null,
      jobs: jobList,
      model: modelSummary(model),
      modelHealth: deriveModelHealth(model),
      session: deriveSessionOverview(null, jobList, nextAction),
      nextAction,
      quality: null,
      style: {
        profiles: styleProfiles,
        binding: null,
        currentProfile: null,
        generation: null,
      },
      assets: emptyCockpitAssetOverview(),
    };
  }

  const status = await getPrivateStatus(root);
  const projectDir = join(root, status.book.path);
  const model = await resolveProjectModelConfig(projectDir, env);
  const latestChapter = await tryLatestChapter(root);
  const pendingFeedback = await fileExists(join(projectDir, '.authoros/private/pending-feedback.json'));
  const style = await getCockpitStyleOverview(root, projectDir, styleProfiles);
  const assets = await getCockpitAssetOverview(projectDir);
  const quality = await getQualityOverview(projectDir, status.state, jobs, {
    binding: style.binding,
    currentProfile: style.currentProfile,
  });
  const nextAction = deriveNextAction(status.state, latestChapter?.chapter ?? null, pendingFeedback, style);
  return {
    books: shelf.books.map(bookSummary),
    current: {
      book: status.book,
      state: status.state,
      latestChapter,
      draftedChapters: draftedChapters(status.state),
      pendingFeedback,
    },
    jobs: jobList,
    model: modelSummary(model),
    modelHealth: deriveModelHealth(model),
    session: deriveSessionOverview(status.book, jobList, nextAction),
    nextAction,
    quality,
    style,
    assets,
  };
}

function bookSummary(book: PrivateBook): CockpitOverview['books'][number] {
  return {
    id: book.id,
    title: book.title,
    concept: book.concept,
    path: book.path,
    last_active_at: book.last_active_at,
  };
}

function draftedChapters(state: ProjectStateResult): CockpitDraftedChapter[] {
  return state.chapters
    .filter((chapter) => chapter.draft)
    .map((chapter) => ({
      chapter: chapter.chapter,
      chapterId: chapter.chapterId,
      label: `第 ${chapter.chapter} 章`,
    }));
}

function deriveSessionOverview(
  book: PrivateBook | null,
  jobs: readonly WebJob[],
  nextAction: CockpitNextAction,
): CockpitSessionOverview {
  const currentTask = jobs.find((job) => job.status === 'running');
  const lastCompleted = jobs.find((job) => job.status === 'completed');
  const currentSessionTask = currentTask ? sessionTask(currentTask) : null;
  const lastCompletedTask = lastCompleted ? sessionTask(lastCompleted) : null;
  return {
    service: { status: 'online', label: '本机服务在线' },
    currentBook: book ? { id: book.id, label: book.title } : { label: '暂无当前书' },
    currentTask: currentSessionTask,
    lastCompleted: lastCompletedTask,
    resume: book
      ? { label: `恢复 ${book.title}`, available: true }
      : { label: '开一本新书后可恢复现场', available: false },
    daily: deriveDailySession(book, jobs, nextAction, currentSessionTask, lastCompletedTask),
  };
}

function deriveDailySession(
  book: PrivateBook | null,
  jobs: readonly WebJob[],
  nextAction: CockpitNextAction,
  currentTask: CockpitSessionTask | null,
  lastCompleted: CockpitSessionTask | null,
): CockpitDailySession {
  const chaptersTouched = [...new Set(jobs.flatMap((job) => {
    const result = isRecord(job.result) ? job.result : {};
    const chapter = result.chapter;
    return Number.isInteger(chapter) ? [chapter] : [];
  }))].slice(0, 5);
  return {
    openedAt: new Date().toISOString(),
    lastActiveBook: book ? { id: book.id, label: book.title } : null,
    currentTask,
    lastCompleted,
    chaptersTouched,
    nextRecommendedAction: { label: nextAction.label, message: nextAction.message },
  };
}

function sessionTask(job: WebJob): CockpitSessionTask {
  const lastEvent = job.events.at(-1);
  return {
    jobId: job.id,
    action: job.action,
    label: jobActionLabel(job.action),
    status: job.status,
    detail: lastEvent?.message ?? '等待事件。',
    updatedAt: job.updatedAt,
  };
}

function jobActionLabel(action: string): string {
  const labels: Record<string, string> = {
    read_chapter: '读取章节',
    continue_book: '继续写作',
    feedback_preview: '生成修改预览',
    feedback_apply: '应用修改',
    style_rewrite_preview: '生成文风改写预览',
    style_rewrite_apply: '应用文风修改',
    internal_review: '生成内评',
    reader_sim_review: '生成读者模拟',
    chapter_decision: '生成创作决策',
    memory_update: '生成记忆更新',
    new_book_confirmed: '创建新书',
    create_book_and_continue: '创建并续写',
    download_current_chapter: '下载当前章',
    download_all_chapters: '下载全部章节',
  };
  return labels[action] ?? action;
}

function modelSummary(model: ResolvedProjectModelConfig): CockpitOverview['model'] {
  return {
    apiKeyEnv: model.apiKeyEnv,
    apiKeySet: model.apiKeySet,
    apiKeySource: model.apiKeySource,
    baseUrl: model.baseUrl,
    model: model.model,
  };
}

function deriveModelHealth(
  model: Pick<ResolvedProjectModelConfig, 'apiKeySet' | 'apiKeySource' | 'baseUrl' | 'model'>,
): CockpitModelHealth {
  const sourceLabel = model.apiKeySource === 'env'
    ? '环境变量'
    : model.apiKeySource === 'local'
      ? '本地保存'
      : '未设置';
  const modelLabel = model.model || '未设置模型';
  const baseUrlLabel = model.baseUrl || '默认 Base URL';
  if (model.apiKeySet) {
    return {
      status: 'ready',
      label: '模型可用',
      detail: `${modelLabel} / ${baseUrlLabel}`,
      sourceLabel,
      actionLabel: '检查配置',
    };
  }
  return {
    status: model.model || model.baseUrl ? 'configured_without_key' : 'missing_key',
    label: '需要配置 API Key',
    detail: `${modelLabel} / ${baseUrlLabel}`,
    sourceLabel,
    actionLabel: '保存 Key',
  };
}

async function tryLatestChapter(root: string): Promise<CockpitLatestChapter | null> {
  try {
    const latest = await readPrivateChapter(root, { chapter: 'latest' });
    return {
      chapter: latest.chapter,
      path: latest.path,
      excerpt: latest.content.trim().slice(0, 800),
    };
  } catch (error) {
    if (error instanceof Error && /No drafted chapters yet/.test(error.message)) return null;
    throw error;
  }
}

function deriveNextAction(
  state: ProjectStateResult,
  latestChapter: number | null,
  pendingFeedback: boolean,
  style?: CockpitStyleOverview,
): CockpitNextAction {
  if (pendingFeedback) {
    return {
      kind: 'apply_feedback',
      label: '处理待确认修改',
      message: '确认应用修改',
    };
  }
  const styleHint = style?.generation?.active && style.currentProfile
    ? `下一章将使用文风：${style.currentProfile.name}`
    : undefined;
  if (latestChapter !== null) {
    const next = state.nextDraftChapter;
    return {
      kind: 'continue_book',
      label: `继续写第 ${next} 章`,
      message: '继续写',
      chapter: next,
      styleHint,
    };
  }
  return {
    kind: 'continue_book',
    label: '写第 1 章',
    message: '继续写',
    chapter: 1,
    styleHint,
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function getCockpitStyleOverview(
  root: string,
  projectDir: string,
  profiles: CockpitStyleProfile[],
): Promise<CockpitStyleOverview> {
  const bindingResult = await readCockpitStyleBinding(root, projectDir);
  const generation = await getCockpitStyleGeneration(projectDir, bindingResult?.binding ?? null);
  return {
    profiles,
    binding: bindingResult?.binding ?? null,
    currentProfile: bindingResult?.profile ?? null,
    generation,
  };
}

async function listCockpitStyleProfiles(root: string): Promise<CockpitStyleProfile[]> {
  const commands = await loadStyleCommands();
  if (!commands) return [];
  return (await commands.listStyleProfiles(root)).map(normalizeStyleProfile).filter(isStyleProfile);
}

async function readCockpitStyleBinding(
  root: string,
  projectDir: string,
): Promise<{ binding: CockpitStyleBinding; profile: CockpitStyleProfile } | null> {
  const commands = await loadStyleCommands();
  if (!commands) return null;
  const result = await commands.readStyleBinding(root, projectDir);
  if (!result) return null;
  const binding = normalizeStyleBinding(result.binding);
  const profile = normalizeStyleProfile(result.profile);
  if (!binding || !profile) return null;
  return { binding, profile };
}

async function getCockpitStyleGeneration(
  projectDir: string,
  binding: CockpitStyleBinding | null,
): Promise<CockpitStyleGenerationStatus> {
  if (!binding) {
    return {
      active: false,
      snapshotPresent: false,
      matchedBinding: false,
      label: '尚未绑定文风',
      detail: '绑定文风后，下一章生成才会收到文风档案。',
    };
  }

  const snapshot = await readCockpitBookStyleProfile(projectDir);
  if (!snapshot) {
    return {
      active: false,
      snapshotPresent: false,
      matchedBinding: false,
      profileId: binding.profileId,
      label: '需要同步文风快照',
      detail: '重新绑定或同步当前文风后，下一章生成会读取文风档案。',
    };
  }

  const matchedBinding = snapshot.id === binding.profileId;
  return {
    active: matchedBinding,
    snapshotPresent: true,
    matchedBinding,
    profileId: snapshot.id,
    label: matchedBinding ? '已接入章节生成' : '文风快照与绑定不一致',
    detail: matchedBinding
      ? '下一章生成会读取当前文风档案。'
      : '请重新同步文风快照，避免生成时使用旧档案。',
  };
}

async function readCockpitBookStyleProfile(projectDir: string): Promise<CockpitStyleProfile | null> {
  const commands = await loadStyleCommands();
  if (!commands?.readBookStyleProfile) return null;
  const profile = await commands.readBookStyleProfile(projectDir);
  return normalizeStyleProfile(profile);
}

interface StyleCommands {
  listStyleProfiles(root: string): Promise<unknown[]>;
  readStyleBinding(root: string, projectDir: string): Promise<{ binding: unknown; profile: unknown } | null>;
  readBookStyleProfile?(projectDir: string): Promise<unknown | null>;
}

async function loadStyleCommands(): Promise<StyleCommands | null> {
  try {
    const mod = await import('../commands/style.ts');
    if (
      typeof mod.listStyleProfiles !== 'function'
      || typeof mod.readStyleBinding !== 'function'
    ) {
      return null;
    }
    return {
      listStyleProfiles: mod.listStyleProfiles as StyleCommands['listStyleProfiles'],
      readStyleBinding: mod.readStyleBinding as StyleCommands['readStyleBinding'],
      readBookStyleProfile: typeof mod.readBookStyleProfile === 'function'
        ? mod.readBookStyleProfile as StyleCommands['readBookStyleProfile']
        : undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('/commands/style.ts')) return null;
    throw error;
  }
}

function normalizeStyleProfile(value: unknown): CockpitStyleProfile | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  const profile: CockpitStyleProfile = {
    id: value.id,
    name: value.name,
  };
  if (typeof value.description === 'string') profile.description = value.description;
  if (typeof value.createdAt === 'string') profile.createdAt = value.createdAt;
  if (isRecord(value.rules)) {
    const antiAiVoice = Array.isArray(value.rules.antiAiVoice)
      ? value.rules.antiAiVoice.filter((item): item is string => typeof item === 'string')
      : undefined;
    profile.rules = antiAiVoice ? { antiAiVoice } : {};
  }
  return profile;
}

function normalizeStyleBinding(value: unknown): CockpitStyleBinding | null {
  if (!isRecord(value) || typeof value.profileId !== 'string') return null;
  const binding: CockpitStyleBinding = { profileId: value.profileId };
  if (typeof value.version === 'number') binding.version = value.version;
  if (typeof value.boundAt === 'string') binding.boundAt = value.boundAt;
  return binding;
}

function isStyleProfile(value: CockpitStyleProfile | null): value is CockpitStyleProfile {
  return value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
