import { randomBytes } from "node:crypto";
import { Cron } from "croner";

export const MAX_JOBS = 10;
export const MIN_DELAY_MS = 60_000;
// setTimeout fires immediately for delays above 2^31-1 ms (~24.8 days), so longer waits re-arm in chunks.
const MAX_TIMER_MS = 2 ** 31 - 1;
const DURATION_UNITS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Persisted job definition. Recurring jobs have `cron`; one-shot jobs have an absolute `at` (epoch ms). */
export interface Job {
  id: string;
  prompt: string;
  name?: string;
  cron?: string;
  tz?: string;
  maxRuns?: number;
  at?: number;
  runs: number;
}

export interface JobSpec {
  prompt?: string;
  name?: string;
  cron?: string;
  in?: string;
  tz?: string;
  maxRuns?: number;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Real clock; timers are unref'd so a scheduled job never keeps pi alive. */
export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms).unref(),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export interface SchedulerHooks {
  /** Deliver a fire. Throwing reports the error and does not count the run. */
  fire(job: Job, run: number): void;
  error(job: Job, error: unknown): void;
  /**
   * Called after any create, cancel, or wake. `persist` is true when the job set or run counts changed;
   * false when only a next fire time moved (a coalesced match).
   */
  change(persist: boolean): void;
}

interface Entry {
  job: Job;
  cron?: Cron;
  nextAt: number;
  pending: boolean;
  timer?: unknown;
}

export function parseDuration(text: string): number {
  const match = /^(\d+)\s*([smhd])$/i.exec(text.trim());
  const ms = match ? Number(match[1]) * DURATION_UNITS[match[2]!.toLowerCase()]! : NaN;
  if (!Number.isSafeInteger(ms))
    throw new Error(`Invalid duration "${text}". Use a number with s, m, h, or d, e.g. "45m".`);
  if (ms < MIN_DELAY_MS) throw new Error(`Duration "${text}" is below the 1 minute minimum.`);
  return ms;
}

export function describeSchedule(job: Job): string {
  if (job.cron === undefined) return `once at ${new Date(job.at!).toISOString()}`;
  return `cron "${job.cron}"${job.tz ? ` (${job.tz})` : ""}`;
}

export class Scheduler {
  #entries = new Map<string, Entry>();
  #hooks: SchedulerHooks;
  #clock: Clock;

  constructor(hooks: SchedulerHooks, clock: Clock = systemClock) {
    this.#hooks = hooks;
    this.#clock = clock;
  }

  /** Validate and schedule a job. Throws with a user-facing message when the spec is invalid. */
  create(spec: JobSpec): Job {
    if (this.#entries.size >= MAX_JOBS)
      throw new Error(`At most ${MAX_JOBS} jobs per session. Cancel one first.`);
    const prompt = spec.prompt?.trim();
    if (!prompt) throw new Error("prompt is required.");
    if ((spec.cron === undefined) === (spec.in === undefined))
      throw new Error("Provide exactly one of cron or in.");
    const job: Job = { id: this.#newId(), prompt, runs: 0 };
    if (spec.name?.trim()) job.name = spec.name.trim();
    if (spec.cron !== undefined) {
      job.cron = spec.cron.trim();
      if (spec.tz?.trim()) job.tz = spec.tz.trim();
      if (spec.maxRuns !== undefined) {
        if (!Number.isInteger(spec.maxRuns) || spec.maxRuns < 1)
          throw new Error("maxRuns must be a positive integer.");
        job.maxRuns = spec.maxRuns;
      }
    } else {
      if (spec.tz !== undefined || spec.maxRuns !== undefined)
        throw new Error("tz and maxRuns apply only to cron jobs.");
      job.at = this.#clock.now() + parseDuration(spec.in!);
    }
    this.#add(job);
    this.#hooks.change(true);
    return job;
  }

  /** Next `count` fire times (epoch ms) for an active job. */
  upcoming(id: string, count = 2): number[] {
    const entry = this.#entries.get(id);
    if (!entry) return [];
    if (!entry.cron) return [entry.nextAt];
    return entry.cron.nextRuns(count, new Date(entry.nextAt - 1)).map((date) => date.getTime());
  }

  list(): { job: Job; nextAt: number }[] {
    return [...this.#entries.values()].map(({ job, nextAt }) => ({ job, nextAt }));
  }

  cancel(id: string): boolean {
    const entry = this.#entries.get(id);
    if (!entry) return false;
    this.#remove(entry);
    this.#hooks.change(true);
    return true;
  }

  cancelAll(): number {
    const count = this.#entries.size;
    for (const entry of this.#entries.values()) this.#remove(entry);
    if (count) this.#hooks.change(true);
    return count;
  }

  /** Mark a fired message as having reached the transcript, so the job may fire again. */
  delivered(id: string): void {
    const entry = this.#entries.get(id);
    if (entry) entry.pending = false;
  }

  /** Treat every undelivered fire as lost (e.g. dropped by an abort), so each job may fire again. */
  resetPending(): void {
    for (const entry of this.#entries.values()) entry.pending = false;
  }

  snapshot(): Job[] {
    return [...this.#entries.values()].map(({ job }) => ({ ...job }));
  }

  /**
   * Re-arm persisted jobs without catching up missed runs: cron jobs continue at their next match
   * after now. One-shot jobs that are already due, and jobs that no longer validate, are returned
   * as dropped. Does not call the change hook.
   */
  restore(jobs: Job[]): Job[] {
    const dropped: Job[] = [];
    for (const job of jobs) {
      if (
        this.#entries.size >= MAX_JOBS ||
        this.#entries.has(job.id) ||
        (job.at !== undefined && job.at <= this.#clock.now())
      ) {
        dropped.push(job);
        continue;
      }
      try {
        this.#add({ ...job });
      } catch {
        dropped.push(job);
      }
    }
    return dropped;
  }

  /** Clear every timer and forget all jobs, without calling the change hook. */
  stop(): void {
    for (const entry of this.#entries.values()) this.#clock.clearTimeout(entry.timer);
    this.#entries.clear();
  }

  #add(job: Job): void {
    let cron: Cron | undefined;
    let nextAt: number | undefined = job.at;
    if (job.cron !== undefined) {
      try {
        cron = new Cron(job.cron, { mode: "5-part", timezone: job.tz });
        nextAt = cron.nextRun(new Date(this.#clock.now()))?.getTime();
      } catch (error) {
        throw new Error(
          `Invalid cron job: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (nextAt === undefined) throw new Error(`cron "${job.cron}" never matches in the future.`);
    }
    const entry: Entry = { job, cron, nextAt: nextAt!, pending: false };
    this.#entries.set(job.id, entry);
    this.#arm(entry);
  }

  #remove(entry: Entry): void {
    this.#clock.clearTimeout(entry.timer);
    this.#entries.delete(entry.job.id);
  }

  #arm(entry: Entry): void {
    const delay = Math.max(0, entry.nextAt - this.#clock.now());
    entry.timer = this.#clock.setTimeout(() => this.#wake(entry), Math.min(delay, MAX_TIMER_MS));
  }

  #wake(entry: Entry): void {
    if (this.#entries.get(entry.job.id) !== entry) return;
    const now = this.#clock.now();
    if (now < entry.nextAt) return this.#arm(entry);

    const { job } = entry;
    let fired = false;
    // Coalesce: skip this match while the previous fire has not reached the transcript.
    if (!entry.pending) {
      // Set before firing: delivery can be observed synchronously inside fire().
      entry.pending = true;
      try {
        this.#hooks.fire(job, job.runs + 1);
        job.runs++;
        fired = true;
      } catch (error) {
        entry.pending = false;
        this.#hooks.error(job, error);
      }
    }

    const next = entry.cron?.nextRun(new Date(Math.max(now, entry.nextAt)))?.getTime();
    const finished = next === undefined || (job.maxRuns !== undefined && job.runs >= job.maxRuns);
    if (finished) this.#remove(entry);
    else {
      entry.nextAt = next;
      this.#arm(entry);
    }
    this.#hooks.change(fired || finished);
  }

  #newId(): string {
    let id: string;
    do id = randomBytes(2).toString("hex");
    while (this.#entries.has(id));
    return id;
  }
}
