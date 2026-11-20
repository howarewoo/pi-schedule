# pi-schedule

pi-schedule is a [pi](https://pi.dev) extension that lets an agent, or you, schedule cron jobs
inside a session. When a job fires, it sends its prompt back into the same conversation. If the
session is idle, that starts a new turn. If the agent is busy, the prompt arrives after its current
tool calls finish.

It was built for periodic check-ins during long agent runs. For example, an orchestrating agent can
have itself woken every ten minutes to check whether a subagent has stalled. The agent that creates
the job picks the schedule.

Jobs only fire while the pi session that created them is running. pi-schedule has no daemon, uses
no OS crontab, and writes no files outside the session.

## Features

| Feature | What you get |
| --- | --- |
| Agent-chosen schedules | Recurring jobs use a standard 5-field cron expression that the agent picks, with an optional IANA timezone. |
| One-shot delays | `in: "45m"` fires once, then removes itself. |
| Wakes the session | When the session is idle, a fire starts a new turn. When the agent is busy, it arrives after the current tool calls. |
| No pile-up | While an earlier fire is still waiting to be delivered, later matches are skipped. |
| Survives reloads | Jobs are restored when the same session is reopened through `/reload`, `/resume`, or `pi -c`. Forks start with no jobs. |
| Footer status | The footer shows how many jobs exist and when the next one fires. |
| Cost guards | At most 10 jobs per session and at most one fire per minute. Each fired message explains how to cancel the job, and you can optionally cap a job with `maxRuns`. |
| Lightweight | One small runtime dependency (croner), no daemon, and no files outside the session. |

## See it in action

In this session, the user asks the agent to watch a deploy status file. The agent picks the
`* * * * *` schedule (every minute) and creates the job. The footer then shows the job and its next
fire time:

![A pi session where the user asks the agent to check deploy-status.txt every minute and report when staging finishes. The agent calls the schedule tool with cron "* * * * *", the tool replies with job 9124 and its next two fire times, and the footer shows "1 job, next 06:31 PM".](docs/images/schedule-created.png)

Each fire wakes the idle session. On the first fire, staging is still deploying. On the second, the
agent sees that staging finished, reports it, and cancels its own job, so the footer status
disappears:

![The same pi session two minutes later. pi-schedule fires run 1 and run 2 of job 9124. After run 1, the agent reads deploy-status.txt and reports that staging is still deploying. After run 2, it reports "Staging finished" with the deployed version and calls the schedule tool to cancel job 9124.](docs/images/schedule-fired.png)

## Install

```bash
pi install git:github.com/howarewoo/pi-schedule
```

To try it from a local checkout without installing:

```bash
pi -e ./pi-schedule/index.ts
```

## Quick start

Ask the agent:

> Every 10 minutes, check on the running subagents and report anything stalled.

The agent calls the `schedule` tool with a cron expression it chooses:

```json
{ "action": "create", "cron": "*/10 * * * *", "name": "checkpoint", "prompt": "Check on the running subagents and report anything stalled." }
```

The tool replies with the job id and the next two fire times, so the agent can confirm the schedule
is what it meant:

```text
Scheduled job a3f1 (checkpoint): cron "*/10 * * * *". Next: 11/20/2026, 3:40:00 PM, 11/20/2026, 3:50:00 PM.
```

While the job exists, the footer shows `⏱ 1 job · next 03:40 PM`. At each fire, this message
appears in the conversation:

```text
[pi-schedule] checkpoint (job a3f1, cron "*/10 * * * *", run 1)
Check on the running subagents and report anything stalled.
This job keeps running. Only once it is no longer needed, cancel it with schedule {action: "cancel", id: "a3f1"}.
```

## Schedules

Each job uses one of two schedule types:

| Field | Job type | Example |
| --- | --- | --- |
| `cron` | Recurring. Fires on every match of a standard 5-field cron expression: minute, hour, day of month, month, day of week. | `*/10 * * * *` (every 10 minutes), `0 9 * * 1-5` (09:00 on weekdays) |
| `in` | One-shot. Fires once after a delay of `s`, `m`, `h`, or `d`, then removes itself. The minimum is 1 minute. | `90s`, `45m`, `2h` |

Things to know about cron jobs:

- **They follow the clock, not the creation time.** `*/10` fires at :00, :10, :20, and so on, so
  the first fire can come less than ten minutes after you create the job.
- **Deliveries and other activity never shift the schedule.**
- **Timezones:** expressions use the machine's local timezone unless you set `tz` to an IANA name
  such as `America/New_York`.
- **Syntax:** expressions are evaluated by [croner](https://github.com/hexagon/croner), which also
  accepts its extensions `L`, `W`, and `#`. Expressions with second or year fields (6 or 7 fields)
  are rejected.

## Tool: `schedule`

| Action | Parameters | Result |
| --- | --- | --- |
| `create` | `prompt` (required); exactly one of `cron` or `in`; optional `name`; cron only: `tz`, `maxRuns` | The job id, the schedule, and the next two fire times |
| `list` | none | Each job's id, name, schedule, run count, next fire time, and prompt |
| `cancel` | `id`, or `all: true` | Which jobs were cancelled |

`maxRuns` stops a cron job after that many fires. Without it, a cron job runs until it is
cancelled. Invalid input, such as a bad expression, an unknown timezone, an expression that never
matches again, or a delay under 1 minute, returns a tool error, and no job is created.

## Command: `/schedule`

```text
/schedule                                    List jobs
/schedule cron "<expr>" [tz=<IANA>] [name=<name>] [maxRuns=<n>] <prompt>
/schedule in <duration> [name=<name>] <prompt>
/schedule cancel <id|all>
```

Quote the cron expression, because it contains spaces:

```text
/schedule cron "0 9 * * 1-5" tz=America/New_York name=standup Summarize yesterday's commits
```

## Behavior

- **Delivery:** a fire sends a custom message (`customType: "pi-schedule"`) that is shown in the
  conversation. It never runs slash commands, skills, or prompt templates.
- **No pile-up:** if an earlier fire of a job hasn't reached the conversation yet, for example
  because it is waiting behind a long tool call, later matches are skipped and don't count as runs.
- **Reload and resume:** jobs are saved in the session and restored when the same session is
  reopened, through `/reload`, `/resume`, or `pi -c`. A cron job continues at its next match after
  now, and missed matches are not caught up. A one-shot job whose time passed while the session was
  closed is dropped, and pi shows a notice.
- **Forks:** forks and clones start with no jobs. This keeps two sessions from running the same
  check-in.
- **Exit:** quitting pi stops all jobs. Pending timers never keep `pi -p` or an RPC process alive.
- **Subagents:** subagent sessions that run without extensions can't schedule jobs.

## Limits and cost

Every fire starts a model turn and costs tokens. The model can create and cancel jobs without
asking for confirmation, so that scheduling also works in headless and RPC sessions. To keep
costs visible and bounded:

- A session can have at most 10 jobs.
- Cron jobs fire at most once a minute, and one-shot delays must be at least 1 minute.
- The footer shows active jobs, and `/schedule` lists them. Cancel jobs with
  `/schedule cancel <id|all>`.
- Each fired message tells the model how to cancel the job once it is no longer needed.

## Development

```bash
npm install
npm run check   # tsc --noEmit and node --test
```

Requires Node.js 22.19 or later. Tests run TypeScript directly through Node's type stripping.

## License

MIT
