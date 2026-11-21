import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Clock, type Job, MAX_JOBS, parseDuration, Scheduler } from "../src/registry.ts";

const MINUTE = 60_000;

class FakeClock implements Clock {
	time: number;
	#timers = new Map<number, { at: number; fn: () => void }>();
	#nextId = 1;

	constructor(iso: string) {
		this.time = Date.parse(iso);
	}
	now = () => this.time;
	setTimeout = (fn: () => void, ms: number) => {
		const id = this.#nextId++;
		this.#timers.set(id, { at: this.time + ms, fn });
		return id;
	};
	clearTimeout = (handle: unknown) => {
		this.#timers.delete(handle as number);
	};
	get pendingTimers() {
		return this.#timers.size;
	}
	/** Advance time, running due timers in order. */
	advance(ms: number) {
		const end = this.time + ms;
		for (;;) {
			const due = [...this.#timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
			if (!due) break;
			this.#timers.delete(due[0]);
			this.time = Math.max(this.time, due[1].at);
			due[1].fn();
		}
		this.time = end;
	}
}

function setup(start = "2026-03-02T10:05:00Z", fireImpl?: (job: Job, run: number) => void) {
	const clock = new FakeClock(start);
	const fires: { id: string; run: number; at: string }[] = [];
	const errors: unknown[] = [];
	let changes = 0;
	const scheduler = new Scheduler(
		{
			fire: (job, run) => {
				fireImpl?.(job, run);
				fires.push({ id: job.id, run, at: new Date(clock.now()).toISOString() });
			},
			error: (_job, error) => errors.push(error),
			change: () => changes++,
		},
		clock,
	);
	return { clock, scheduler, fires, errors, changes: () => changes };
}

describe("validation", () => {
	it("rejects 6- and 7-field patterns, bad syntax, unknown timezones, and never-matching patterns", () => {
		const { scheduler } = setup();
		for (const cron of ["*/5 * * * * *", "0 0 0 1 1 * 2030", "nope"]) {
			assert.throws(() => scheduler.create({ prompt: "p", cron }), /Invalid cron job/);
		}
		assert.throws(() => scheduler.create({ prompt: "p", cron: "0 9 * * *", tz: "Mars/Base" }), /timezone/);
		assert.throws(() => scheduler.create({ prompt: "p", cron: "0 0 30 2 *" }), /never matches/);
		assert.equal(scheduler.list().length, 0);
	});

	it("requires a prompt and exactly one of cron or in", () => {
		const { scheduler } = setup();
		assert.throws(() => scheduler.create({ cron: "* * * * *" }), /prompt is required/);
		assert.throws(() => scheduler.create({ prompt: "p" }), /exactly one/);
		assert.throws(() => scheduler.create({ prompt: "p", cron: "* * * * *", in: "5m" }), /exactly one/);
		assert.throws(() => scheduler.create({ prompt: "p", in: "5m", tz: "UTC" }), /only to cron/);
		assert.throws(() => scheduler.create({ prompt: "p", cron: "* * * * *", maxRuns: 0 }), /maxRuns/);
	});

	it("parses durations with a 1 minute minimum", () => {
		assert.equal(parseDuration("90s"), 90_000);
		assert.equal(parseDuration("20m"), 20 * MINUTE);
		assert.equal(parseDuration("2h"), 120 * MINUTE);
		assert.equal(parseDuration("1d"), 1440 * MINUTE);
		assert.throws(() => parseDuration("30s"), /minimum/);
		assert.throws(() => parseDuration("ten minutes"), /Invalid duration/);
	});

	it("enforces the per-session job limit", () => {
		const { scheduler } = setup();
		for (let i = 0; i < MAX_JOBS; i++) scheduler.create({ prompt: "p", cron: "* * * * *" });
		assert.throws(() => scheduler.create({ prompt: "p", cron: "* * * * *" }), /At most/);
	});
});

describe("schedule", () => {
	it("reports the next two fire times, honoring tz", () => {
		const { scheduler } = setup("2026-03-02T10:05:00Z");
		const every10 = scheduler.create({ prompt: "p", cron: "*/10 * * * *" });
		assert.deepEqual(
			scheduler.upcoming(every10.id).map((t) => new Date(t).toISOString()),
			["2026-03-02T10:10:00.000Z", "2026-03-02T10:20:00.000Z"],
		);
		const weekdays = scheduler.create({ prompt: "p", cron: "0 9 * * 1-5", tz: "America/New_York" });
		assert.deepEqual(
			scheduler.upcoming(weekdays.id).map((t) => new Date(t).toISOString()),
			["2026-03-02T14:00:00.000Z", "2026-03-03T14:00:00.000Z"],
		);
	});

	it("fires on cron matches aligned to the clock, regardless of deliveries", () => {
		const { clock, scheduler, fires } = setup("2026-03-02T10:05:00Z");
		const job = scheduler.create({ prompt: "p", cron: "*/10 * * * *" });
		clock.advance(4 * MINUTE);
		assert.equal(fires.length, 0);
		clock.advance(4 * MINUTE); // fires at 10:10, delivered late at 10:13
		scheduler.delivered(job.id);
		clock.advance(7 * MINUTE + 30_000); // fires at 10:20, delivered at 10:20:30
		scheduler.delivered(job.id);
		clock.advance(10 * MINUTE);
		assert.deepEqual(
			fires.map((f) => [f.run, f.at]),
			[
				[1, "2026-03-02T10:10:00.000Z"],
				[2, "2026-03-02T10:20:00.000Z"],
				[3, "2026-03-02T10:30:00.000Z"],
			],
		);
	});

	it("fires a one-shot once and removes it", () => {
		const { clock, scheduler, fires } = setup();
		scheduler.create({ prompt: "p", in: "45m" });
		clock.advance(44 * MINUTE);
		assert.equal(fires.length, 0);
		clock.advance(1 * MINUTE);
		clock.advance(120 * MINUTE);
		assert.equal(fires.length, 1);
		assert.equal(scheduler.list().length, 0);
	});

	it("stops a cron job at maxRuns", () => {
		const { clock, scheduler, fires } = setup();
		const job = scheduler.create({ prompt: "p", cron: "* * * * *", maxRuns: 2 });
		for (let i = 0; i < 5; i++) {
			clock.advance(MINUTE);
			scheduler.delivered(job.id);
		}
		assert.equal(fires.length, 2);
		assert.equal(scheduler.list().length, 0);
	});

	it("coalesces fires while a previous one is pending, then resumes", () => {
		const { clock, scheduler, fires } = setup("2026-03-02T10:00:30Z");
		const job = scheduler.create({ prompt: "p", cron: "* * * * *" });
		clock.advance(5 * MINUTE);
		assert.equal(fires.length, 1);
		scheduler.delivered(job.id);
		clock.advance(MINUTE);
		assert.deepEqual(
			fires.map((f) => [f.run, f.at]),
			[
				[1, "2026-03-02T10:01:00.000Z"],
				[2, "2026-03-02T10:06:00.000Z"],
			],
		);
	});

	it("does not leave a job pending when delivery is observed during fire", () => {
		let scheduler!: Scheduler;
		const ctx = setup("2026-03-02T10:00:30Z", (job) => scheduler.delivered(job.id));
		scheduler = ctx.scheduler;
		scheduler.create({ prompt: "p", cron: "* * * * *" });
		ctx.clock.advance(3 * MINUTE);
		assert.equal(ctx.fires.length, 3);
	});

	it("reports fire errors without counting the run or blocking the next match", () => {
		let fail = true;
		const ctx = setup("2026-03-02T10:00:30Z", () => {
			if (fail) throw new Error("boom");
		});
		const job = ctx.scheduler.create({ prompt: "p", cron: "* * * * *" });
		ctx.clock.advance(MINUTE);
		assert.equal(ctx.errors.length, 1);
		fail = false;
		ctx.clock.advance(MINUTE);
		assert.deepEqual(ctx.fires.map((f) => f.run), [1]);
		assert.equal(ctx.scheduler.snapshot().find((j) => j.id === job.id)?.runs, 1);
	});

	it("re-arms waits longer than the setTimeout limit instead of firing early", () => {
		const { clock, scheduler, fires } = setup("2026-03-02T10:00:00Z");
		scheduler.create({ prompt: "p", cron: "0 0 1 6 *", tz: "UTC" }); // 2026-06-01, ~91 days away
		clock.advance(60 * 24 * 60 * MINUTE);
		assert.equal(fires.length, 0);
		clock.advance(32 * 24 * 60 * MINUTE);
		assert.deepEqual(fires.map((f) => f.at), ["2026-06-01T00:00:00.000Z"]);
	});

	it("cancels by id and all, clearing timers", () => {
		const { clock, scheduler, fires } = setup();
		const a = scheduler.create({ prompt: "a", cron: "* * * * *" });
		scheduler.create({ prompt: "b", cron: "* * * * *" });
		scheduler.create({ prompt: "c", in: "5m" });
		assert.equal(scheduler.cancel(a.id), true);
		assert.equal(scheduler.cancel(a.id), false);
		assert.equal(scheduler.cancelAll(), 2);
		assert.equal(clock.pendingTimers, 0);
		clock.advance(10 * MINUTE);
		assert.equal(fires.length, 0);
	});
});

describe("restore", () => {
	it("re-arms cron jobs at the next match without catch-up and drops due one-shots", () => {
		const first = setup("2026-03-02T10:00:30Z");
		const cron = first.scheduler.create({ prompt: "p", cron: "*/10 * * * *", name: "check" });
		first.scheduler.create({ prompt: "soon", in: "5m" });
		first.scheduler.create({ prompt: "later", in: "3h" });
		const saved = JSON.parse(JSON.stringify(first.scheduler.snapshot())) as Job[];
		first.scheduler.stop();

		const second = setup("2026-03-02T11:03:00Z");
		const dropped = second.scheduler.restore(saved);
		assert.deepEqual(dropped.map((j) => j.prompt), ["soon"]);
		assert.deepEqual(second.scheduler.list().map(({ job }) => job.prompt).sort(), ["later", "p"]);
		assert.equal(second.scheduler.upcoming(cron.id)[0], Date.parse("2026-03-02T11:10:00Z"));
		second.clock.advance(7 * MINUTE);
		assert.deepEqual(second.fires.map((f) => [f.id, f.at]), [[cron.id, "2026-03-02T11:10:00.000Z"]]);
		assert.equal(second.changes(), 1);
	});

	it("drops jobs that no longer validate", () => {
		const { scheduler } = setup();
		const dropped = scheduler.restore([{ id: "abcd", prompt: "p", cron: "bad", runs: 0 }]);
		assert.equal(dropped.length, 1);
		assert.equal(scheduler.list().length, 0);
	});
});
