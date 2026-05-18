export type WebJobStatus = 'running' | 'completed' | 'failed';

export interface WebJobEvent {
  type: string;
  message: string;
  at: string;
  data?: unknown;
}

export interface WebJob {
  id: string;
  action: string;
  status: WebJobStatus;
  createdAt: string;
  updatedAt: string;
  events: WebJobEvent[];
  result?: unknown;
  error?: string;
}

export interface JobStore {
  createJob(action: string, message: string): WebJob;
  append(id: string, type: string, message: string, data?: unknown): WebJob;
  complete(id: string, result?: unknown): WebJob;
  fail(id: string, message: string): WebJob;
  get(id: string): WebJob | undefined;
  list(): WebJob[];
  listEvents(id: string, after?: number): WebJobEvent[];
  subscribe(id: string, listener: (event: WebJobEvent) => void): () => void;
}

export interface CreateJobStoreOptions {
  now?: () => Date;
  initialJobs?: WebJob[];
  onChange?: (jobs: WebJob[]) => void;
}

export function createJobStore(opts: CreateJobStoreOptions = {}): JobStore {
  const now = opts.now ?? (() => new Date());
  const jobs = new Map<string, WebJob>();
  const listeners = new Map<string, Set<(event: WebJobEvent) => void>>();
  let nextId = 1;

  for (const job of opts.initialJobs ?? []) {
    jobs.set(job.id, cloneJob(job));
    const match = job.id.match(/^job-(\d+)$/);
    if (match) nextId = Math.max(nextId, Number(match[1]) + 1);
  }

  function timestamp(): string {
    return now().toISOString();
  }

  function requireJob(id: string): WebJob {
    const job = jobs.get(id);
    if (!job) throw new Error(`Unknown web job: ${id}`);
    return job;
  }

  function push(job: WebJob, type: string, message: string, data?: unknown): WebJob {
    const at = timestamp();
    job.updatedAt = at;
    const event: WebJobEvent = { type, message, at };
    if (data !== undefined) event.data = data;
    job.events.push(event);
    for (const listener of listeners.get(job.id) ?? []) listener(event);
    return job;
  }

  function snapshot(): WebJob[] {
    return [...jobs.values()].map(cloneJob);
  }

  function notifyChange(): void {
    opts.onChange?.(snapshot());
  }

  return {
    createJob(action, message) {
      const at = timestamp();
      const job: WebJob = {
        id: `job-${nextId++}`,
        action,
        status: 'running',
        createdAt: at,
        updatedAt: at,
        events: [],
      };
      jobs.set(job.id, job);
      push(job, 'received', message);
      notifyChange();
      return cloneJob(job);
    },
    append(id, type, message, data) {
      const job = push(requireJob(id), type, message, data);
      notifyChange();
      return cloneJob(job);
    },
    complete(id, result) {
      const job = requireJob(id);
      job.status = 'completed';
      job.result = result;
      push(job, 'completed', '完成', result);
      notifyChange();
      return cloneJob(job);
    },
    fail(id, message) {
      const job = requireJob(id);
      job.status = 'failed';
      job.error = message;
      push(job, 'failed', message);
      notifyChange();
      return cloneJob(job);
    },
    get(id) {
      const job = jobs.get(id);
      return job ? cloneJob(job) : undefined;
    },
    list() {
      return snapshot().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    listEvents(id, after = 0) {
      return requireJob(id).events.slice(after);
    },
    subscribe(id, listener) {
      requireJob(id);
      const set = listeners.get(id) ?? new Set<(event: WebJobEvent) => void>();
      set.add(listener);
      listeners.set(id, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(id);
      };
    },
  };
}

function cloneJob(job: WebJob): WebJob {
  return {
    ...job,
    events: job.events.map((event) => ({ ...event })),
  };
}
