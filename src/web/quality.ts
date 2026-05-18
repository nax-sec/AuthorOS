import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listMemoryDeltas, type PendingMemoryDelta } from '../commands/memory.ts';
import type { ChapterState, ProjectStateResult } from '../commands/state.ts';
import type { JobStore, WebJob } from './jobs.ts';

export type QualityStageStatus = 'done' | 'next' | 'missing' | 'optional';
export type QualitySignalKind = 'ok' | 'warning' | 'danger';

export interface QualityStage {
  key: keyof Omit<ChapterState, 'chapter' | 'chapterId'> | 'memoryDelta';
  label: string;
  status: QualityStageStatus;
}

export interface QualityChapter {
  chapter: number;
  chapterId: string;
  stages: QualityStage[];
}

export interface QualityNextChapterCard {
  chapter: number;
  state: 'needs_plan' | 'ready_to_draft' | 'ready_to_review';
  label: string;
  message: string;
  blockers: string[];
  stages: QualityStage[];
}

export interface QualityPendingPreview {
  kind: 'feedback';
  chapter: number;
  text: string;
  instruction: string;
  createdAt: string;
  path: string;
}

export interface QualityRecovery {
  jobId: string;
  action: string;
  failedPhase: string;
  message: string;
  suggestion: string;
}

export interface QualitySignal {
  kind: QualitySignalKind;
  label: string;
}

export interface QualityStyleStatus {
  binding: { profileId: string } | null;
  currentProfile: { name: string } | null;
}

export interface QualityOverview {
  nextChapter: QualityNextChapterCard;
  chapters: QualityChapter[];
  pendingPreview: QualityPendingPreview | null;
  memoryDeltas: PendingMemoryDelta[];
  recovery: QualityRecovery | null;
  signals: QualitySignal[];
}

const stageLabels: Record<QualityStage['key'], string> = {
  plan: '计划',
  draft: '正文',
  internalReview: '内评',
  readerSimReview: '读者模拟',
  feedbackRaw: '真实反馈',
  feedbackAnalysis: '反馈分析',
  decision: '决策',
  memoryDelta: '记忆',
};

export async function getQualityOverview(
  projectDir: string,
  state: ProjectStateResult,
  jobs: JobStore,
  style?: QualityStyleStatus,
): Promise<QualityOverview> {
  const pendingPreview = await readPendingFeedback(projectDir);
  const memoryDeltas = await listMemoryDeltas(projectDir);
  const chapters = state.chapters.map((chapter) => renderChapter(chapter, state, memoryDeltas));
  const nextChapter = deriveNextChapter(state, memoryDeltas);
  const recovery = deriveRecovery(jobs.list());

  return {
    nextChapter,
    chapters,
    pendingPreview,
    memoryDeltas,
    recovery,
    signals: deriveSignals({ pendingPreview, memoryDeltas, recovery, style }),
  };
}

function renderChapter(
  chapter: ChapterState,
  state: ProjectStateResult,
  memoryDeltas: readonly PendingMemoryDelta[],
): QualityChapter {
  const memoryPending = memoryDeltas.some((delta) => delta.name === `chapter-${chapter.chapterId}.delta.md`);
  return {
    chapter: chapter.chapter,
    chapterId: chapter.chapterId,
    stages: [
      stage('plan', chapter.plan ? 'done' : chapter.chapter === state.nextPlanChapter ? 'next' : 'missing'),
      stage('draft', chapter.draft ? 'done' : chapter.chapter === state.nextDraftChapter ? 'next' : 'missing'),
      stage('internalReview', chapter.internalReview ? 'done' : chapter.draft ? 'missing' : 'optional'),
      stage('readerSimReview', chapter.readerSimReview ? 'done' : chapter.draft ? 'missing' : 'optional'),
      stage('decision', chapter.decision ? 'done' : chapter.chapter === state.nextDecisionChapter && chapter.draft ? 'next' : 'missing'),
      stage('memoryDelta', memoryPending ? 'next' : chapter.decision ? 'missing' : 'optional'),
    ],
  };
}

function deriveNextChapter(
  state: ProjectStateResult,
  memoryDeltas: readonly PendingMemoryDelta[],
): QualityNextChapterCard {
  const hasPlanGap = state.nextPlanChapter < state.nextDraftChapter;
  const chapter = hasPlanGap ? state.nextPlanChapter : state.nextDraftChapter;
  const existing = state.chapters.find((item) => item.chapter === chapter);
  const stages = existing
    ? renderChapter(existing, state, memoryDeltas).stages
    : [
        stage('plan', chapter === state.nextPlanChapter ? 'next' : 'done'),
        stage('draft', 'next'),
        stage('internalReview', 'optional'),
        stage('readerSimReview', 'optional'),
        stage('decision', 'optional'),
        stage('memoryDelta', 'optional'),
      ];
  const blockers = hasPlanGap || (existing?.plan === false && chapter !== state.nextPlanChapter)
    ? [`第 ${chapter} 章缺少计划`]
    : [];

  return {
    chapter,
    state: hasPlanGap || !existing?.plan ? 'needs_plan' : existing.draft ? 'ready_to_review' : 'ready_to_draft',
    label: `第 ${chapter} 章生产线`,
    message: '继续写',
    blockers,
    stages,
  };
}

function deriveRecovery(jobs: readonly WebJob[]): QualityRecovery | null {
  const failed = jobs
    .filter((job) => job.status === 'failed')
    .sort(compareJobsNewestFirst)[0];
  if (!failed) return null;
  const lastPhase = [...failed.events].reverse().find((event) => event.type !== 'failed');

  return {
    jobId: failed.id,
    action: failed.action,
    failedPhase: lastPhase?.type ?? failed.action,
    message: failed.error ?? '任务失败',
    suggestion: recoverySuggestion(failed.action),
  };
}

function compareJobsNewestFirst(a: WebJob, b: WebJob): number {
  const byCreatedAt = b.createdAt.localeCompare(a.createdAt);
  if (byCreatedAt !== 0) return byCreatedAt;

  const aSequence = jobSequence(a.id);
  const bSequence = jobSequence(b.id);
  if (aSequence !== undefined && bSequence !== undefined) {
    return bSequence - aSequence;
  }

  return b.id.localeCompare(a.id);
}

function jobSequence(id: string): number | undefined {
  const match = id.match(/^job-(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

function recoverySuggestion(action: string): string {
  if (action === 'continue_book') return '检查模型配置后，可以再次发送“继续写”。';
  if (action === 'feedback_preview') return '确认当前章存在后，可以重新发送修改意见。';
  if (action === 'feedback_apply') return '确认待应用修改仍存在后，再发送“确认应用修改”。';
  if (action === 'read_chapter') return '确认已有正文后，再读取最新章。';
  return '查看失败原因后，重新执行上一步。';
}

function deriveSignals(input: {
  pendingPreview: QualityPendingPreview | null;
  memoryDeltas: readonly PendingMemoryDelta[];
  recovery: QualityRecovery | null;
  style?: QualityStyleStatus;
}): QualitySignal[] {
  const signals: QualitySignal[] = [];
  if (input.recovery) signals.push({ kind: 'danger', label: `上次任务失败：${input.recovery.failedPhase}` });
  if (input.pendingPreview) signals.push({ kind: 'warning', label: `第 ${input.pendingPreview.chapter} 章有修改预览待确认` });
  if (input.memoryDeltas.length > 0) signals.push({ kind: 'warning', label: `记忆更新待审阅：${input.memoryDeltas.length} 个` });
  if (input.style) {
    if (input.style.binding && input.style.currentProfile) {
      signals.push({ kind: 'ok', label: `已绑定文风：${input.style.currentProfile.name}` });
    } else {
      signals.push({ kind: 'warning', label: '尚未绑定文风' });
    }
  }
  if (signals.length === 0) signals.push({ kind: 'ok', label: '质量环路暂无阻塞' });
  return signals;
}

function stage(key: QualityStage['key'], status: QualityStageStatus): QualityStage {
  return { key, label: stageLabels[key], status };
}

async function readPendingFeedback(projectDir: string): Promise<QualityPendingPreview | null> {
  const path = join(projectDir, '.authoros/private/pending-feedback.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid pending private feedback JSON.');
  }

  if (
    !isRecord(parsed)
    || !Number.isInteger(parsed.chapter)
    || parsed.chapter < 1
    || typeof parsed.text !== 'string'
    || typeof parsed.instruction !== 'string'
    || typeof parsed.created_at !== 'string'
  ) {
    throw new Error('Invalid pending private feedback.');
  }

  return {
    kind: 'feedback',
    chapter: parsed.chapter,
    text: parsed.text,
    instruction: parsed.instruction,
    createdAt: parsed.created_at,
    path: '.authoros/private/pending-feedback.json',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
