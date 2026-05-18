import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listMemoryDeltas, type PendingMemoryDelta } from '../commands/memory.ts';
import type { ChapterState, ProjectStateResult } from '../commands/state.ts';
import type { JobFailureExplanation } from './job-failure.ts';
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

export interface QualityProductionLineItem {
  chapter: number;
  chapterId: string;
  label: string;
  stages: QualityStage[];
  nextStage: QualityStage;
  blocker: string | null;
  primaryAction: QualityAction | null;
  flags: Array<{ kind: 'pending_feedback' | 'pending_style' | 'memory_delta'; label: string }>;
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
  previewContent?: string;
  instruction: string;
  createdAt: string;
  rationale?: string;
  originalCharCount?: number;
  revisedCharCount?: number | null;
  path: string;
}

export type QualityStyleRewriteIntent = 'imitate_style' | 'remove_ai_voice' | 'style_polish';

export interface QualityStyleRewritePreview {
  kind: 'style_rewrite';
  chapter: number;
  profileId: string;
  profileName: string;
  intent: QualityStyleRewriteIntent;
  text: string;
  previewContent: string;
  instruction: string;
  createdAt: string;
  rationale: string;
  originalCharCount: number;
  revisedCharCount: number | null;
  path: string;
}

export interface QualityRecovery {
  jobId: string;
  action: string;
  failedPhase: string;
  message: string;
  suggestion: string;
  actions: QualityRecoveryAction[];
  failure?: JobFailureExplanation;
}

export type QualityRecoveryActionType = 'send' | 'model_config' | 'read_latest' | 'resume';

export interface QualityRecoveryAction {
  type: QualityRecoveryActionType;
  label: string;
  message?: string;
  primary?: boolean;
}

export type QualityActionType = 'internal_review' | 'reader_sim_review' | 'chapter_decision' | 'memory_update';

export interface QualityAction {
  type: QualityActionType;
  label: string;
  message: string;
  chapter: number;
  primary?: boolean;
}

export type QualityArtifactType = 'internal_review' | 'reader_sim_review' | 'chapter_decision';

export interface QualityArtifact {
  type: QualityArtifactType;
  label: string;
  chapter: number;
  path: string;
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
  productionLine: QualityProductionLineItem[];
  pendingPreview: QualityPendingPreview | null;
  styleRewritePreview: QualityStyleRewritePreview | null;
  memoryDeltas: PendingMemoryDelta[];
  recovery: QualityRecovery | null;
  signals: QualitySignal[];
  actions: QualityAction[];
  artifacts: QualityArtifact[];
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
  const styleRewritePreview = await readPendingStyleRewrite(projectDir);
  const memoryDeltas = await listMemoryDeltas(projectDir);
  const chapters = state.chapters.map((chapter) => renderChapter(chapter, state, memoryDeltas));
  const nextChapter = deriveNextChapter(state, memoryDeltas);
  const recovery = deriveRecovery(jobs.list());
  const actions = deriveQualityActions(state, memoryDeltas);
  const artifacts = deriveQualityArtifacts(state);
  const productionLine = deriveProductionLine({
    chapters,
    actions,
    pendingPreview,
    styleRewritePreview,
    memoryDeltas,
  });

  return {
    nextChapter,
    chapters,
    productionLine,
    pendingPreview,
    styleRewritePreview,
    memoryDeltas,
    recovery,
    signals: deriveSignals({ pendingPreview, styleRewritePreview, memoryDeltas, recovery, style }),
    actions,
    artifacts,
  };
}

function deriveProductionLine(input: {
  chapters: QualityChapter[];
  actions: readonly QualityAction[];
  pendingPreview: QualityPendingPreview | null;
  styleRewritePreview: QualityStyleRewritePreview | null;
  memoryDeltas: readonly PendingMemoryDelta[];
}): QualityProductionLineItem[] {
  return input.chapters.map((chapter) => {
    const primaryAction = input.actions.find((action) => action.chapter === chapter.chapter) ?? null;
    const actionStageKey = primaryAction ? stageKeyForAction(primaryAction.type) : null;
    const actionStage = actionStageKey ? chapter.stages.find((item) => item.key === actionStageKey) : undefined;
    const next = chapter.stages.find((item) => item.status === 'next');
    const missing = chapter.stages.find((item) => item.status === 'missing');
    const nextStage = actionStage ?? next ?? missing ?? chapter.stages.at(-1)!;
    const flags: QualityProductionLineItem['flags'] = [];
    if (input.pendingPreview?.chapter === chapter.chapter) {
      flags.push({ kind: 'pending_feedback', label: '修改预览待确认' });
    }
    if (input.styleRewritePreview?.chapter === chapter.chapter) {
      flags.push({ kind: 'pending_style', label: '文风预览待确认' });
    }
    if (input.memoryDeltas.some((delta) => delta.name === `chapter-${chapter.chapterId}.delta.md`)) {
      flags.push({ kind: 'memory_delta', label: '记忆更新待合并' });
    }
    return {
      chapter: chapter.chapter,
      chapterId: chapter.chapterId,
      label: `第 ${chapter.chapter} 章`,
      stages: chapter.stages,
      nextStage,
      blocker: primaryAction ? null : productionBlocker(nextStage),
      primaryAction,
      flags,
    };
  });
}

function stageKeyForAction(type: QualityActionType): QualityStage['key'] {
  if (type === 'internal_review') return 'internalReview';
  if (type === 'reader_sim_review') return 'readerSimReview';
  if (type === 'chapter_decision') return 'decision';
  return 'memoryDelta';
}

function productionBlocker(stage: QualityStage): string | null {
  if (stage.status === 'done') return null;
  const blockers: Partial<Record<QualityStage['key'], string>> = {
    plan: '缺少章节计划',
    draft: '缺少章节正文',
    internalReview: '等待内评',
    readerSimReview: '等待读者模拟',
    decision: '等待创作决策',
    memoryDelta: '等待记忆更新',
  };
  return blockers[stage.key] ?? `${stage.label}待补齐`;
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

function deriveQualityActions(
  state: ProjectStateResult,
  memoryDeltas: readonly PendingMemoryDelta[],
): QualityAction[] {
  const actions: QualityAction[] = [];
  for (const chapter of state.chapters) {
    if (!chapter.draft) continue;
    if (!chapter.internalReview) {
      actions.push(qualityAction('internal_review', '生成内评', chapter.chapter, actions.length === 0));
    }
    if (!chapter.readerSimReview) {
      actions.push(qualityAction('reader_sim_review', '生成读者模拟', chapter.chapter, actions.length === 0));
    }
    if (chapter.internalReview && chapter.readerSimReview && !chapter.decision) {
      actions.push(qualityAction('chapter_decision', '生成决策', chapter.chapter, actions.length === 0));
    }
    const memoryDeltaPending = memoryDeltas.some((delta) => delta.name === `chapter-${chapter.chapterId}.delta.md`);
    if (chapter.decision && !memoryDeltaPending) {
      actions.push(qualityAction('memory_update', '生成记忆更新', chapter.chapter, actions.length === 0));
    }
  }
  return actions.slice(0, 8);
}

function deriveQualityArtifacts(state: ProjectStateResult): QualityArtifact[] {
  const artifacts: QualityArtifact[] = [];
  for (const chapter of state.chapters) {
    if (chapter.internalReview) {
      artifacts.push(qualityArtifact('internal_review', '内评', chapter));
    }
    if (chapter.readerSimReview) {
      artifacts.push(qualityArtifact('reader_sim_review', '读者模拟', chapter));
    }
    if (chapter.decision) {
      artifacts.push(qualityArtifact('chapter_decision', '决策', chapter));
    }
  }
  return artifacts;
}

function qualityArtifact(
  type: QualityArtifactType,
  label: string,
  chapter: ChapterState,
): QualityArtifact {
  return {
    type,
    label: `第 ${chapter.chapter} 章${label}`,
    chapter: chapter.chapter,
    path: qualityArtifactPath(type, chapter.chapterId),
  };
}

function qualityArtifactPath(type: QualityArtifactType, chapterId: string): string {
  if (type === 'internal_review') return `reviews/${chapterId}.internal.md`;
  if (type === 'reader_sim_review') return `reviews/${chapterId}.reader-sim.md`;
  return `decisions/${chapterId}.md`;
}

function qualityAction(
  type: QualityActionType,
  label: string,
  chapter: number,
  primary: boolean,
): QualityAction {
  return {
    type,
    label,
    message: `生成第 ${chapter} 章${label.replace(/^生成/, '')}`,
    chapter,
    primary: primary || undefined,
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
    message: failed.failure?.title ?? failed.error ?? '任务失败',
    suggestion: failed.failure?.next ?? recoverySuggestion(failed.action),
    actions: recoveryActions(failed.action, failed.failure),
    failure: failed.failure,
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

function recoveryActions(action: string, failure?: JobFailureExplanation): QualityRecoveryAction[] {
  const actions: QualityRecoveryAction[] = [];
  const retryMessage = recoveryRetryMessage(action);
  if (retryMessage) {
    actions.push({ type: 'send', label: '一键重试', message: retryMessage, primary: true });
  }
  if (shouldShowModelConfigAction(failure)) actions.push({ type: 'model_config', label: '检查模型配置' });
  actions.push({ type: 'read_latest', label: '读最新章' });
  actions.push({ type: 'resume', label: '回到当前书' });
  return actions;
}

function recoveryRetryMessage(action: string): string {
  const messages: Record<string, string> = {
    continue_book: '继续写',
    read_chapter: '读最新章',
    feedback_apply: '确认应用修改',
    style_rewrite_preview: '帮这一章去 AI 味',
    style_rewrite_apply: '应用文风修改',
    download_current_chapter: '下载这一章',
    download_all_chapters: '下载全部章节',
    status: '检查状态',
  };
  return messages[action] ?? '';
}

function shouldShowModelConfigAction(failure?: JobFailureExplanation): boolean {
  if (!failure) return true;
  return failure.kind === 'model_config'
    || failure.kind === 'network'
    || failure.kind === 'model_timeout'
    || failure.kind === 'model_length'
    || failure.kind === 'unknown';
}

function deriveSignals(input: {
  pendingPreview: QualityPendingPreview | null;
  styleRewritePreview: QualityStyleRewritePreview | null;
  memoryDeltas: readonly PendingMemoryDelta[];
  recovery: QualityRecovery | null;
  style?: QualityStyleStatus;
}): QualitySignal[] {
  const signals: QualitySignal[] = [];
  if (input.recovery) signals.push({ kind: 'danger', label: `上次任务失败：${input.recovery.failedPhase}` });
  if (input.pendingPreview) signals.push({ kind: 'warning', label: `第 ${input.pendingPreview.chapter} 章有修改预览待确认` });
  if (input.styleRewritePreview) signals.push({ kind: 'warning', label: `第 ${input.styleRewritePreview.chapter} 章有文风改写预览待确认` });
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

  const preview: QualityPendingPreview = {
    kind: 'feedback',
    chapter: parsed.chapter,
    text: parsed.text,
    instruction: parsed.instruction,
    createdAt: parsed.created_at,
    path: '.authoros/private/pending-feedback.json',
  };
  if (typeof parsed.preview_content === 'string') {
    preview.previewContent = parsed.preview_content;
    if (typeof parsed.rationale === 'string') preview.rationale = parsed.rationale;
    if (Number.isInteger(parsed.original_char_count)) preview.originalCharCount = parsed.original_char_count;
    if (parsed.revised_char_count === null || Number.isInteger(parsed.revised_char_count)) {
      preview.revisedCharCount = parsed.revised_char_count as number | null;
    }
  }
  return preview;
}

async function readPendingStyleRewrite(projectDir: string): Promise<QualityStyleRewritePreview | null> {
  const path = join(projectDir, '.authoros/private/pending-style-rewrite.json');
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
    throw new Error('Invalid pending style rewrite JSON.');
  }

  if (
    !isRecord(parsed)
    || parsed.version !== 1
    || !Number.isInteger(parsed.chapter)
    || parsed.chapter < 1
    || typeof parsed.profile_id !== 'string'
    || typeof parsed.profile_name !== 'string'
    || !isStyleRewriteIntent(parsed.intent)
    || typeof parsed.text !== 'string'
    || typeof parsed.preview_content !== 'string'
    || typeof parsed.instruction !== 'string'
    || typeof parsed.created_at !== 'string'
    || typeof parsed.rationale !== 'string'
    || !Number.isInteger(parsed.original_char_count)
    || parsed.original_char_count < 0
    || !(parsed.revised_char_count === null || (Number.isInteger(parsed.revised_char_count) && parsed.revised_char_count >= 0))
  ) {
    throw new Error('Invalid pending style rewrite.');
  }

  return {
    kind: 'style_rewrite',
    chapter: parsed.chapter,
    profileId: parsed.profile_id,
    profileName: parsed.profile_name,
    intent: parsed.intent,
    text: parsed.text,
    previewContent: parsed.preview_content,
    instruction: parsed.instruction,
    createdAt: parsed.created_at,
    rationale: parsed.rationale,
    originalCharCount: parsed.original_char_count,
    revisedCharCount: parsed.revised_char_count,
    path: '.authoros/private/pending-style-rewrite.json',
  };
}

function isStyleRewriteIntent(value: unknown): value is QualityStyleRewriteIntent {
  return value === 'imitate_style' || value === 'remove_ai_voice' || value === 'style_polish';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
