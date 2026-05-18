import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getPrivateStatus, listPrivateBooks, readPrivateChapter, type PrivateBook } from '../commands/private.ts';
import type { ProjectStateResult } from '../commands/state.ts';
import { resolveProjectModelConfig, type EnvLike, type ResolvedProjectModelConfig } from '../core/modelConfig.ts';
import type { JobStore, WebJob } from './jobs.ts';
import { getQualityOverview, type QualityOverview } from './quality.ts';

export interface CockpitOverview {
  books: Array<Pick<PrivateBook, 'id' | 'title' | 'concept' | 'path' | 'last_active_at'>>;
  current: {
    book: PrivateBook;
    state: ProjectStateResult;
    latestChapter: CockpitLatestChapter | null;
    pendingFeedback: boolean;
  } | null;
  jobs: WebJob[];
  model: Pick<ResolvedProjectModelConfig, 'apiKeyEnv' | 'apiKeySet' | 'baseUrl' | 'model'>;
  nextAction: CockpitNextAction;
  quality: QualityOverview | null;
  style: CockpitStyleOverview;
}

export interface CockpitStyleOverview {
  profiles: CockpitStyleProfile[];
  binding: CockpitStyleBinding | null;
  currentProfile: CockpitStyleProfile | null;
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

export interface CockpitLatestChapter {
  chapter: number;
  path: string;
  excerpt: string;
}

export type CockpitNextAction =
  | { kind: 'new_book'; label: string; message: string }
  | { kind: 'apply_feedback'; label: string; message: string }
  | { kind: 'continue_book'; label: string; message: string; chapter: number };

export async function getCockpitOverview(
  root: string,
  env: EnvLike,
  jobs: JobStore,
): Promise<CockpitOverview> {
  const shelf = await listPrivateBooks(root);
  const styleProfiles = await listCockpitStyleProfiles(root);
  if (!shelf.current) {
    const model = await resolveProjectModelConfig(root, env);
    return {
      books: shelf.books.map(bookSummary),
      current: null,
      jobs: jobs.list(),
      model: modelSummary(model),
      nextAction: {
        kind: 'new_book',
        label: '开一本新书',
        message: '我想开一本新书',
      },
      quality: null,
      style: {
        profiles: styleProfiles,
        binding: null,
        currentProfile: null,
      },
    };
  }

  const status = await getPrivateStatus(root);
  const projectDir = join(root, status.book.path);
  const model = await resolveProjectModelConfig(projectDir, env);
  const latestChapter = await tryLatestChapter(root);
  const pendingFeedback = await fileExists(join(projectDir, '.authoros/private/pending-feedback.json'));
  const style = await getCockpitStyleOverview(root, projectDir, styleProfiles);
  const quality = await getQualityOverview(projectDir, status.state, jobs, {
    binding: style.binding,
    currentProfile: style.currentProfile,
  });
  return {
    books: shelf.books.map(bookSummary),
    current: {
      book: status.book,
      state: status.state,
      latestChapter,
      pendingFeedback,
    },
    jobs: jobs.list(),
    model: modelSummary(model),
    nextAction: deriveNextAction(status.state, latestChapter?.chapter ?? null, pendingFeedback),
    quality,
    style,
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

function modelSummary(model: ResolvedProjectModelConfig): CockpitOverview['model'] {
  return {
    apiKeyEnv: model.apiKeyEnv,
    apiKeySet: model.apiKeySet,
    baseUrl: model.baseUrl,
    model: model.model,
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
): CockpitNextAction {
  if (pendingFeedback) {
    return {
      kind: 'apply_feedback',
      label: '处理待确认修改',
      message: '确认应用修改',
    };
  }
  if (latestChapter !== null) {
    const next = state.nextDraftChapter;
    return {
      kind: 'continue_book',
      label: `继续写第 ${next} 章`,
      message: '继续写',
      chapter: next,
    };
  }
  return {
    kind: 'continue_book',
    label: '写第 1 章',
    message: '继续写',
    chapter: 1,
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
  return {
    profiles,
    binding: bindingResult?.binding ?? null,
    currentProfile: bindingResult?.profile ?? null,
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

interface StyleCommands {
  listStyleProfiles(root: string): Promise<unknown[]>;
  readStyleBinding(root: string, projectDir: string): Promise<{ binding: unknown; profile: unknown } | null>;
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
