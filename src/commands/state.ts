import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface ChapterStageFlags {
  plan: boolean;
  draft: boolean;
  internalReview: boolean;
  readerSimReview: boolean;
  feedbackRaw: boolean;
  feedbackAnalysis: boolean;
  decision: boolean;
}

export interface ChapterState extends ChapterStageFlags {
  chapter: number;
  chapterId: string;
}

export interface ProjectStateResult {
  chapters: ChapterState[];
  nextPlanChapter: number;
  nextDraftChapter: number;
  nextDecisionChapter: number;
}

interface StageScan {
  key: keyof ChapterStageFlags;
  dir: string;
  pattern: RegExp;
}

const stageScans: readonly StageScan[] = [
  { key: 'plan', dir: 'plans', pattern: /^(\d{4})\.md$/ },
  { key: 'draft', dir: 'chapters', pattern: /^(\d{4})\.md$/ },
  { key: 'internalReview', dir: 'reviews', pattern: /^(\d{4})\.internal\.md$/ },
  { key: 'readerSimReview', dir: 'reviews', pattern: /^(\d{4})\.reader-sim\.md$/ },
  { key: 'feedbackRaw', dir: 'feedback', pattern: /^(\d{4})\.raw\.jsonl$/ },
  { key: 'feedbackAnalysis', dir: 'feedback', pattern: /^(\d{4})\.analysis\.md$/ },
  { key: 'decision', dir: 'decisions', pattern: /^(\d{4})\.md$/ },
];

export async function getProjectState(projectDir: string): Promise<ProjectStateResult> {
  const flagsByChapter = new Map<number, ChapterStageFlags>();
  const ensure = (chapter: number): ChapterStageFlags => {
    let entry = flagsByChapter.get(chapter);
    if (!entry) {
      entry = {
        plan: false,
        draft: false,
        internalReview: false,
        readerSimReview: false,
        feedbackRaw: false,
        feedbackAnalysis: false,
        decision: false,
      };
      flagsByChapter.set(chapter, entry);
    }
    return entry;
  };

  for (const scan of stageScans) {
    const entries = await readDirSafe(join(projectDir, scan.dir));
    for (const entry of entries) {
      const match = entry.match(scan.pattern);
      if (!match) continue;
      const chapter = Number.parseInt(match[1], 10);
      ensure(chapter)[scan.key] = true;
    }
  }

  const chapters: ChapterState[] = [...flagsByChapter.entries()]
    .map(([chapter, flags]) => ({
      chapter,
      chapterId: String(chapter).padStart(4, '0'),
      ...flags,
    }))
    .sort((a, b) => a.chapter - b.chapter);

  return {
    chapters,
    nextPlanChapter: nextWithout(chapters, 'plan'),
    nextDraftChapter: nextWithout(chapters, 'draft'),
    nextDecisionChapter: nextWithout(chapters, 'decision'),
  };
}

export function renderProjectState(result: ProjectStateResult): string {
  const lines = ['AuthorOS state', ''];

  if (result.chapters.length === 0) {
    lines.push('no chapter artifacts yet');
  } else {
    for (const chapter of result.chapters) {
      const stages = [
        `plan ${mark(chapter.plan)}`,
        `draft ${mark(chapter.draft)}`,
        `internal ${mark(chapter.internalReview)}`,
        `reader-sim ${mark(chapter.readerSimReview)}`,
        `feedback ${mark(chapter.feedbackRaw)}`,
        `analysis ${mark(chapter.feedbackAnalysis)}`,
        `decision ${mark(chapter.decision)}`,
      ].join(' | ');
      lines.push(`chapter ${chapter.chapter}: ${stages}`);
    }
  }

  lines.push('');
  lines.push(`next plan:     ${result.nextPlanChapter}`);
  lines.push(`next draft:    ${result.nextDraftChapter}`);
  lines.push(`next decision: ${result.nextDecisionChapter}`);
  lines.push('');
  return lines.join('\n');
}

function mark(present: boolean): string {
  return present ? 'OK' : '--';
}

function nextWithout(chapters: readonly ChapterState[], key: keyof ChapterStageFlags): number {
  let candidate = 1;
  for (const chapter of chapters) {
    if (chapter.chapter !== candidate) {
      break;
    }
    if (!chapter[key]) {
      return candidate;
    }
    candidate += 1;
  }
  return candidate;
}

async function readDirSafe(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
