import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createExtension, MESSAGE_TYPE, parseCommand, STATE_TYPE } from "../index.ts";
import type { Clock } from "../src/registry.ts";

const MINUTE = 60_000;

/** Minimal manual clock: runs due timers on advance. */
function manualClock(iso: string) {
	let now = Date.parse(iso);
	let timers: { at: number; fn: () => void; id: number }[] = [];
	let nextId = 1;
	const clock: Clock = {
		now: () => now,
		setTimeout: (fn, ms) => {
			timers.push({ at: now + ms, fn, id: nextId });
			return nextId++;
		},
		clearTimeout: (id) => {
			timers = timers.filter((t) => t.id !== id);
		},
	};
	const advance = (ms: number) => {
		const end = now + ms;
		for (let due = timers.sort((a, b) => a.at - b.at)[0]; due && due.at <= end; due = timers.sort((a, b) => a.at - b.at)[0]) {
			timers = timers.filter((t) => t !== due);
			now = due.at;
			due.fn();
		}
		now = end;
	};
	return { clock, advance };
}

function harness(branch: unknown[] = []) {
	const { clock, advance } = manualClock("2026-03-02T10:00:30Z");
	const handlers: Record<string, (event: any, ctx: any) => Promise<void>> = {};
	const sent: { message: any; options: any }[] = [];
	const entries: { customType: string; data: any }[] = [];
	const notices: { message: string; level?: string }[] = [];
	const statuses: (string | undefined)[] = [];
	let tool: any;
	let command: any;
	const pi = {
		on: (name: string, fn: any) => (handlers[name] = fn),
		registerTool: (def: any) => (tool = def),
		registerCommand: (_name: string, def: any) => (command = def),
		sendMessage: (message: any, options: any) => sent.push({ message, options }),
		appendEntry: (customType: string, data: any) => entries.push({ customType, data }),
	};
	const ctx = {
		hasUI: true,
		ui: {
			notify: (message: string, level?: string) => notices.push({ message, level }),
			setStatus: (_key: string, text: string | undefined) => statuses.push(text),
		},
		sessionManager: { getBranch: () => branch },
		pendingMessages: false,
		hasPendingMessages() {
			return this.pendingMessages;
		},
	};
	createExtension(clock)(pi as any);
	const run = (args: Record<string, unknown>) => tool.execute("call", args).then((r: any) => r.content[0].text as string);
	return { handlers, sent, entries, notices, statuses, ctx, advance, run, command: () => command };
}

describe("parseCommand", () => {
	it("parses list, cancel, cron with options, and in", () => {
		assert.deepEqual(parseCommand(""), { action: "list" });
		assert.deepEqual(parseCommand("cancel all"), { action: "cancel", target: "all" });
		assert.deepEqual(parseCommand('cron "*/10 * * * *" tz=UTC name=check maxRuns=3 Reassess the plan'), {
			action: "create",
			spec: { cron: "*/10 * * * *", tz: "UTC", name: "check", maxRuns: 3, prompt: "Reassess the plan" },
		});
		assert.deepEqual(parseCommand("in 45m Check CI"), { action: "create", spec: { in: "45m", prompt: "Check CI" } });
		assert.throws(() => parseCommand("cron */10 * * * * hi"), /Quote/);
		assert.throws(() => parseCommand("every 10m hi"), /\/schedule/);
	});
});

describe("extension", () => {
	it("fires a custom steer message that wakes the session, and coalesces until delivered", async () => {
		const h = harness();
		await h.handlers.session_start!({ reason: "startup" }, h.ctx);
		const created = await h.run({ action: "create", cron: "* * * * *", name: "check", prompt: "Reassess" });
		const id = /job (\w+)/.exec(created)![1]!;
		assert.match(created, /Next: .+, .+\./);

		h.advance(MINUTE);
		assert.equal(h.sent.length, 1);
		assert.deepEqual(h.sent[0]!.options, { deliverAs: "steer", triggerTurn: true });
		assert.equal(h.sent[0]!.message.customType, MESSAGE_TYPE);
		assert.equal(h.sent[0]!.message.display, true);
		assert.equal(
			h.sent[0]!.message.content,
			`[pi-schedule] check (job ${id}, cron "* * * * *", run 1)\nReassess\nThis job keeps running. Only once it is no longer needed, cancel it with schedule {action: "cancel", id: "${id}"}.`,
		);

		h.advance(2 * MINUTE);
		assert.equal(h.sent.length, 1, "pending fire coalesces later matches");
		await h.handlers.message_start!({ message: { role: "custom", customType: MESSAGE_TYPE, details: { jobId: id } } }, h.ctx);
		h.advance(MINUTE);
		assert.equal(h.sent.length, 2);
		assert.match(h.statuses.at(-1)!, /^⏱ 1 job · next /);

		assert.equal(await h.run({ action: "cancel", all: true }), "Cancelled 1 job(s).");
		assert.equal(h.statuses.at(-1), undefined);
		assert.deepEqual(h.entries.at(-1), { customType: STATE_TYPE, data: { jobs: [] } });
	});

	it("re-enables firing when a run settles without delivering the fire, and skips snapshots on coalesced matches", async () => {
		const h = harness();
		await h.handlers.session_start!({ reason: "startup" }, h.ctx);
		await h.run({ action: "create", cron: "* * * * *", prompt: "Reassess" });

		h.advance(MINUTE);
		assert.equal(h.sent.length, 1);
		const entries = h.entries.length;
		h.advance(MINUTE);
		assert.equal(h.sent.length, 1);
		assert.equal(h.entries.length, entries, "coalesced match writes no snapshot");

		h.ctx.pendingMessages = true;
		await h.handlers.agent_settled!({ aborted: true }, h.ctx);
		h.advance(MINUTE);
		assert.equal(h.sent.length, 1, "a still-queued fire keeps coalescing");

		h.ctx.pendingMessages = false;
		await h.handlers.agent_settled!({ aborted: true }, h.ctx);
		h.advance(MINUTE);
		assert.equal(h.sent.length, 2, "a fire dropped by the abort no longer blocks later matches");
	});

	it("rejects invalid tool input with an error", async () => {
		const h = harness();
		await assert.rejects(h.run({ action: "create", cron: "* * * * * *", prompt: "p" }), /5 parts/);
		await assert.rejects(h.run({ action: "cancel", id: "nope" }), /No scheduled job/);
	});

	it("handles /schedule commands and reports errors as notices", async () => {
		const h = harness();
		await h.handlers.session_start!({ reason: "startup" }, h.ctx);
		await h.command().handler("in 5m Check CI", h.ctx);
		assert.match(h.notices.at(-1)!.message, /^Scheduled job \w+: once at /);
		await h.command().handler("", h.ctx);
		assert.match(h.notices.at(-1)!.message, /: once at .*\n {2}Check CI$/);
		await h.command().handler("in 10s too soon", h.ctx);
		assert.equal(h.notices.at(-1)!.level, "error");
	});

	it("restores the latest snapshot on reopen but not into a fork", async () => {
		const saved = [{ id: "ab12", prompt: "p", cron: "*/10 * * * *", runs: 4 }];
		const branch = [
			{ type: "custom", customType: STATE_TYPE, data: { jobs: [] } },
			{ type: "custom", customType: STATE_TYPE, data: { jobs: saved } },
		];

		const reopened = harness(branch);
		await reopened.handlers.session_start!({ reason: "startup" }, reopened.ctx);
		assert.match(await reopened.run({ action: "list" }), /^ab12: cron "\*\/10 \* \* \* \*", runs 4, next /);
		reopened.advance(10 * MINUTE);
		assert.match(reopened.sent[0]!.message.content, /run 5\)/);

		const fork = harness(branch);
		await fork.handlers.session_start!({ reason: "fork" }, fork.ctx);
		assert.equal(await fork.run({ action: "list" }), "No scheduled jobs.");
		assert.deepEqual(fork.entries, [{ customType: STATE_TYPE, data: { jobs: [] } }]);
	});

	it("drops overdue one-shots on restore with a notice, and stops timers on shutdown", async () => {
		const h = harness([
			{ type: "custom", customType: STATE_TYPE, data: { jobs: [{ id: "cd34", prompt: "late", at: 0, runs: 0 }] } },
		]);
		await h.handlers.session_start!({ reason: "resume" }, h.ctx);
		assert.equal(h.notices.at(-1)!.level, "warning");
		assert.deepEqual(h.entries.at(-1), { customType: STATE_TYPE, data: { jobs: [] } });

		await h.run({ action: "create", cron: "* * * * *", prompt: "p" });
		await h.handlers.session_shutdown!({ reason: "quit" }, h.ctx);
		h.advance(5 * MINUTE);
		assert.equal(h.sent.length, 0);
	});
});
