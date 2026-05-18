import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isJobFailureExplanation } from './job-failure.ts';
import type { WebJob, WebJobEvent, WebJobStatus } from './jobs.ts';

interface StoredWebJobHistory {
  version: 1;
  jobs: WebJob[];
}

const defaultLimit = 50;

export function webJobHistoryPath(root: string): string {
  return join(root, '.authoros/web/jobs.json');
}

export function loadWebJobHistory(root: string): WebJob[] {
  try {
    const raw = JSON.parse(readFileSync(webJobHistoryPath(root), 'utf8')) as unknown;
    return parseHistory(raw).jobs;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return [];
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid web job history JSON: ${webJobHistoryPath(root)}`);
    }
    throw error;
  }
}

export function saveWebJobHistory(root: string, jobs: readonly WebJob[], limit = defaultLimit): void {
  const sorted = [...jobs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const recent = sorted.slice(Math.max(0, sorted.length - limit));
  const payload: StoredWebJobHistory = {
    version: 1,
    jobs: recent.map(cloneJob),
  };
  const path = webJobHistoryPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function parseHistory(value: unknown): StoredWebJobHistory {
  if (!value || typeof value !== 'object') throw invalidHistory();
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.jobs)) throw invalidHistory();
  return {
    version: 1,
    jobs: record.jobs.map(parseJob),
  };
}

function parseJob(value: unknown): WebJob {
  if (!value || typeof value !== 'object') throw invalidHistory();
  const record = value as Record<string, unknown>;
  const status = parseStatus(record.status);
  const events = record.events;
  if (!Array.isArray(events)) throw invalidHistory();
  const job: WebJob = {
    id: stringField(record, 'id'),
    action: stringField(record, 'action'),
    status,
    createdAt: stringField(record, 'createdAt'),
    updatedAt: stringField(record, 'updatedAt'),
    events: events.map(parseEvent),
  };
  if ('result' in record) job.result = record.result;
  if ('error' in record) {
    if (typeof record.error !== 'string') throw invalidHistory();
    job.error = record.error;
  }
  if ('failure' in record) {
    if (!isJobFailureExplanation(record.failure)) throw invalidHistory();
    job.failure = record.failure;
  }
  return job;
}

function parseEvent(value: unknown): WebJobEvent {
  if (!value || typeof value !== 'object') throw invalidHistory();
  const record = value as Record<string, unknown>;
  const event: WebJobEvent = {
    type: stringField(record, 'type'),
    message: stringField(record, 'message'),
    at: stringField(record, 'at'),
  };
  if ('data' in record) event.data = record.data;
  return event;
}

function parseStatus(value: unknown): WebJobStatus {
  if (value === 'running' || value === 'completed' || value === 'failed') return value;
  throw invalidHistory();
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw invalidHistory();
  return value;
}

function cloneJob(job: WebJob): WebJob {
  return {
    ...job,
    events: job.events.map((event) => ({ ...event })),
  };
}

function invalidHistory(): Error {
  return new Error('Invalid web job history.');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
