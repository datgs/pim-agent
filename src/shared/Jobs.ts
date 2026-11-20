export type JobKind = "bash" | "subagent";
export type JobStatus = "running" | "completed" | "failed" | "cancelled";

export type JobOutput = {
  readonly stdout?: {
    readonly totalBytes: number;
    readonly path: string | null;
  };
  readonly stderr?: {
    readonly totalBytes: number;
    readonly path: string | null;
  };
  readonly text?: string;
};

export type Job = {
  readonly id: string;
  readonly kind: JobKind;
  readonly title: string;
  readonly status: JobStatus;
  readonly createdAt: number;
  readonly endedAt: number | null;
  readonly exitCode: number | null;
  readonly error: string | null;
  readonly output: JobOutput;
};

export type JobListener = (job: Job) => void;

type CreateInput = {
  readonly kind: JobKind;
  readonly title: string;
  readonly onCancel?: () => void;
};

type Entry = {
  readonly job: Job;
  readonly seq: number;
  readonly onCancel: (() => void) | undefined;
};

const MAX_ACTIVE = 16;
const RETAINED_FINISHED = 30;

/**
 * Process-local registry for backgrounded work (timed-out shell jobs,
 * background subagents). Jobs do not survive process exit — callers that
 * need durability must persist elsewhere and reconcile on startup.
 */
export class Jobs {
  private static jobs = new Map<string, Entry>();
  private static listeners = new Set<JobListener>();
  private static seq = 0;

  public static create(input: CreateInput): Job {
    const active = Jobs.count((j) => j.status === "running");
    if (active >= MAX_ACTIVE) {
      throw new Error(
        `too many background jobs (${active} running, max ${MAX_ACTIVE})`
      );
    }
    const seq = ++Jobs.seq;
    const job: Job = {
      id: `${input.kind}-${seq}`,
      kind: input.kind,
      title: input.title,
      status: "running",
      createdAt: Date.now(),
      endedAt: null,
      exitCode: null,
      error: null,
      output: {},
    };
    Jobs.jobs.set(job.id, { job, seq, onCancel: input.onCancel });
    Jobs.emit(job);
    return job;
  }

  public static get(id: string): Job | undefined {
    return Jobs.jobs.get(id)?.job;
  }

  public static list(): readonly Job[] {
    // seq breaks createdAt millisecond ties so ordering is always newest-first.
    return [...Jobs.jobs.values()]
      .sort((a, b) => b.seq - a.seq)
      .map((e) => e.job);
  }

  /** No-op when the job is already settled — late completions must not
   * overwrite an earlier cancel/terminal state. */
  public static setStatus(
    id: string,
    status: Exclude<JobStatus, "running">,
    fields?: {
      readonly exitCode?: number | null;
      readonly error?: string | null;
      readonly output?: JobOutput;
    }
  ): Job | undefined {
    const entry = Jobs.jobs.get(id);
    if (!entry || entry.job.status !== "running") {
      return entry?.job;
    }
    const job: Job = {
      ...entry.job,
      status,
      endedAt: Date.now(),
      exitCode: fields?.exitCode ?? entry.job.exitCode,
      error: fields?.error ?? entry.job.error,
      output: fields?.output ?? entry.job.output,
    };
    Jobs.jobs.set(id, { ...entry, job });
    Jobs.prune();
    Jobs.emit(job);
    return job;
  }

  /** Asks the job to stop. Returns true when the job was running and a
   * cancel hook accepted the request. */
  public static cancel(id: string): boolean {
    const entry = Jobs.jobs.get(id);
    if (!entry || entry.job.status !== "running") {
      return false;
    }
    try {
      entry.onCancel?.();
    } catch {
      // a cancel hook that throws still counts as attempted
    }
    Jobs.setStatus(id, "cancelled");
    return true;
  }

  public static subscribe(listener: JobListener): () => void {
    Jobs.listeners.add(listener);
    return () => {
      Jobs.listeners.delete(listener);
    };
  }

  /** Test support: reset registry state. */
  public static resetForTests(): void {
    Jobs.jobs.clear();
    Jobs.listeners.clear();
    Jobs.seq = 0;
  }

  private static emit(job: Job): void {
    for (const listener of Jobs.listeners) {
      try {
        listener(job);
      } catch {
        // listener failures must not break job lifecycle
      }
    }
  }

  private static count(match: (job: Job) => boolean): number {
    let n = 0;
    for (const { job } of Jobs.jobs.values()) {
      if (match(job)) {
        n++;
      }
    }
    return n;
  }

  private static prune(): void {
    const finished = [...Jobs.jobs.values()].filter(
      (e) => e.job.status !== "running"
    );
    if (finished.length <= RETAINED_FINISHED) {
      return;
    }
    finished
      .sort((a, b) => a.seq - b.seq)
      .slice(0, finished.length - RETAINED_FINISHED)
      .forEach((e) => Jobs.jobs.delete(e.job.id));
  }
}
