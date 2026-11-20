import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type Clock, describeSchedule, type Job, type JobSpec, Scheduler, systemClock } from "./src/registry.ts";

export const MESSAGE_TYPE = "pi-schedule";
export const STATE_TYPE = "pi-schedule-state";

const USAGE = [
	"/schedule                                     list jobs",
	'/schedule cron "<expr>" [tz=<IANA>] [name=<name>] [maxRuns=<n>] <prompt>',
	"/schedule in <duration> [name=<name>] <prompt>",
	"/schedule cancel <id|all>",
].join("\n");

const parameters = Type.Object({
	action: StringEnum(["create", "list", "cancel"] as const),
	prompt: Type.Optional(Type.String({ description: "create: the prompt delivered to this session when the job fires." })),
	cron: Type.Optional(
		Type.String({
			description:
				'create (recurring): 5-field cron expression "minute hour day-of-month month day-of-week", e.g. "*/10 * * * *" or "0 9 * * 1-5".',
		}),
	),
	in: Type.Optional(Type.String({ description: 'create (one-shot): delay such as "90s", "45m", or "2h"; minimum 1 minute.' })),
	tz: Type.Optional(Type.String({ description: "create (cron only): IANA timezone. Defaults to the machine's local timezone." })),
	name: Type.Optional(Type.String({ description: "create: short label for the job." })),
	maxRuns: Type.Optional(Type.Integer({ minimum: 1, description: "create (cron only): stop after this many fires." })),
	id: Type.Optional(Type.String({ description: "cancel: job id." })),
	all: Type.Optional(Type.Boolean({ description: "cancel: cancel every job in this session." })),
});

function firedText(job: Job, run: number): string {
	const runs = job.maxRuns ? `run ${run}/${job.maxRuns}` : `run ${run}`;
	const lines = [`[pi-schedule] ${job.name ?? "job"} (job ${job.id}, ${describeSchedule(job)}, ${runs})`, job.prompt];
	if (job.cron !== undefined) {
		lines.push(`This job keeps running. Only once it is no longer needed, cancel it with schedule {action: "cancel", id: "${job.id}"}.`);
	}
	return lines.join("\n");
}

/** Parse `/schedule` arguments into an action. Throws with usage on malformed input. */
export function parseCommand(args: string): { action: "list" } | { action: "cancel"; target: string } | { action: "create"; spec: JobSpec } {
	const text = args.trim();
	const [verb = "", ...restWords] = text.split(/\s+/);
	if (!verb || verb === "list") return { action: "list" };
	if (verb === "cancel" && restWords.length === 1) return { action: "cancel", target: restWords[0]! };

	let rest: string;
	const spec: JobSpec = {};
	if (verb === "cron") {
		const match = /^cron\s+(["'])(.+?)\1\s*([\s\S]*)$/.exec(text);
		if (!match) throw new Error(`Quote the cron expression.\n${USAGE}`);
		spec.cron = match[2];
		rest = match[3]!;
	} else if (verb === "in" && restWords.length > 0) {
		spec.in = restWords[0];
		rest = text.replace(/^in\s+\S+\s*/, "");
	} else {
		throw new Error(USAGE);
	}
	for (let option = /^(tz|name|maxRuns)=(\S+)\s*/.exec(rest); option; option = /^(tz|name|maxRuns)=(\S+)\s*/.exec(rest)) {
		const [whole, key, value] = option;
		if (key === "maxRuns") spec.maxRuns = Number(value);
		else spec[key as "tz" | "name"] = value;
		rest = rest.slice(whole.length);
	}
	spec.prompt = rest;
	return { action: "create", spec };
}

export function createExtension(clock: Clock = systemClock) {
	return function piSchedule(pi: ExtensionAPI): void {
		let ctx: ExtensionContext | undefined;

		const notify = (message: string, level: "info" | "warning" | "error" = "info") => {
			if (ctx?.hasUI) ctx.ui.notify(message, level);
		};
		const formatTime = (time: number) => new Date(time).toLocaleString();

		const updateStatus = () => {
			if (!ctx?.hasUI) return;
			const jobs = scheduler.list();
			if (jobs.length === 0) return ctx.ui.setStatus(MESSAGE_TYPE, undefined);
			const next = new Date(Math.min(...jobs.map((j) => j.nextAt)));
			const time = next.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
			ctx.ui.setStatus(MESSAGE_TYPE, `⏱ ${jobs.length} job${jobs.length === 1 ? "" : "s"} · next ${time}`);
		};

		const scheduler = new Scheduler(
			{
				fire(job, run) {
					pi.sendMessage(
						{ customType: MESSAGE_TYPE, content: firedText(job, run), display: true, details: { jobId: job.id, run } },
						// Steer lands after the current tool batch when busy; triggerTurn wakes an idle session.
						{ deliverAs: "steer", triggerTurn: true },
					);
				},
				error(job, error) {
					notify(`pi-schedule: job ${job.id} failed to fire: ${error instanceof Error ? error.message : String(error)}`, "error");
				},
				change() {
					pi.appendEntry(STATE_TYPE, { jobs: scheduler.snapshot() });
					updateStatus();
				},
			},
			clock,
		);

		const listText = () => {
			const jobs = scheduler.list();
			if (jobs.length === 0) return "No scheduled jobs.";
			return jobs
				.map(({ job, nextAt }) => {
					const runs = job.cron === undefined ? "" : `, runs ${job.runs}${job.maxRuns ? `/${job.maxRuns}` : ""}`;
					return `${job.id}${job.name ? ` ${job.name}` : ""}: ${describeSchedule(job)}${runs}, next ${formatTime(nextAt)}\n  ${job.prompt}`;
				})
				.join("\n");
		};

		const create = (spec: JobSpec) => {
			const job = scheduler.create(spec);
			const next = scheduler.upcoming(job.id).map(formatTime).join(", ");
			return `Scheduled job ${job.id}${job.name ? ` (${job.name})` : ""}: ${describeSchedule(job)}. Next: ${next}.`;
		};

		const cancel = (target: { id?: string; all?: boolean }) => {
			if (target.all) return `Cancelled ${scheduler.cancelAll()} job(s).`;
			if (!target.id) throw new Error("cancel needs an id or all.");
			if (!scheduler.cancel(target.id)) throw new Error(`No scheduled job ${target.id}.`);
			return `Cancelled job ${target.id}.`;
		};

		pi.registerTool({
			name: "schedule",
			label: "Schedule",
			description:
				"Schedule a prompt to be delivered back into this session later. Recurring jobs use a 5-field cron expression you choose; one-shot jobs use a delay. " +
				"Fired prompts wake the session when idle, or arrive after the current tool calls when busy. Jobs live only in this session while pi runs. Actions: create, list, cancel.",
			promptSnippet: "Schedule recurring (cron) or one-shot prompts that wake this session later",
			promptGuidelines: [
				"Use schedule for periodic check-ins such as orchestration reassessment checkpoints; choose the cron expression from the agreed interval.",
				"Cancel schedule jobs as soon as they are no longer needed, because every fire starts a model turn.",
			],
			parameters,
			async execute(_toolCallId, params) {
				const text =
					params.action === "create"
						? create(params)
						: params.action === "cancel"
							? cancel(params)
							: listText();
				return { content: [{ type: "text", text }], details: {} };
			},
		});

		pi.registerCommand("schedule", {
			description: "List, create, or cancel scheduled prompts for this session",
			async handler(args) {
				try {
					const command = parseCommand(args);
					const text =
						command.action === "create"
							? create(command.spec)
							: command.action === "cancel"
								? cancel(command.target === "all" ? { all: true } : { id: command.target })
								: listText();
					notify(text);
				} catch (error) {
					notify(error instanceof Error ? error.message : String(error), "error");
				}
			},
		});

		pi.on("session_start", async (event, startCtx) => {
			ctx = startCtx;
			let saved: Job[] | undefined;
			for (const entry of startCtx.sessionManager.getBranch()) {
				if (entry.type === "custom" && entry.customType === STATE_TYPE) saved = (entry.data as { jobs: Job[] }).jobs;
			}
			if (saved?.length) {
				if (event.reason === "fork") {
					// The fork copied the parent's snapshot; record an empty one so reopening the fork never restores them.
					pi.appendEntry(STATE_TYPE, { jobs: [] });
				} else {
					const dropped = scheduler.restore(saved);
					if (dropped.length) {
						pi.appendEntry(STATE_TYPE, { jobs: scheduler.snapshot() });
						notify(`pi-schedule: dropped ${dropped.length} job(s) that can no longer run: ${dropped.map((j) => j.id).join(", ")}`, "warning");
					}
				}
			}
			updateStatus();
		});

		pi.on("session_shutdown", async () => {
			scheduler.stop();
			ctx = undefined;
		});

		pi.on("message_start", async (event) => {
			const message = event.message;
			if (message.role === "custom" && message.customType === MESSAGE_TYPE) {
				scheduler.delivered((message.details as { jobId: string }).jobId);
			}
		});
	};
}

export default createExtension();
