# Using schedules

This page walks through a scheduled check-in and documents the schedule types, the `schedule`
tool and the `/schedule` command. For delivery, reload and cost rules, see
[Behavior, limits and cost](behavior.md).

## Walkthrough

It was built for periodic check-ins during long agent runs. For example, an orchestrating agent can
have itself woken every ten minutes to check whether a subagent has stalled. The agent that creates
the job picks the schedule.

Ask the agent:

> Every 10 minutes, check on the running subagents and report anything stalled.

The agent calls the `schedule` tool with a cron expression it chooses:

```json
{
  "action": "create",
  "cron": "*/10 * * * *",
  "name": "checkpoint",
  "prompt": "Check on the running subagents and report anything stalled."
}
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

In the deploy-status session shown in the [README](../README.md), each fire wakes the idle
session. On the first fire, staging is still deploying. On the second, the agent sees that staging
finished, reports it, and cancels its own job, so the footer status disappears:

![The same pi session two minutes later. pi-schedule fires run 1 and run 2 of job 9124. After run 1, the agent reads deploy-status.txt and reports that staging is still deploying. After run 2, it reports "Staging finished" with the deployed version and calls the schedule tool to cancel job 9124.](images/schedule-fired.png)

## Schedules

Each job uses one of two schedule types:

| Field  | Job type                                                                                                               | Example                                                              |
| ------ | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `cron` | Recurring. Fires on every match of a standard 5-field cron expression: minute, hour, day of month, month, day of week. | `*/10 * * * *` (every 10 minutes), `0 9 * * 1-5` (09:00 on weekdays) |
| `in`   | One-shot. Fires once after a delay of `s`, `m`, `h`, or `d`, then removes itself. The minimum is 1 minute.             | `90s`, `45m`, `2h`                                                   |

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

| Action   | Parameters                                                                                      | Result                                                               |
| -------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `create` | `prompt` (required); exactly one of `cron` or `in`; optional `name`; cron only: `tz`, `maxRuns` | The job id, the schedule, and the next two fire times                |
| `list`   | none                                                                                            | Each job's id, name, schedule, run count, next fire time, and prompt |
| `cancel` | `id`, or `all: true`                                                                            | Which jobs were cancelled                                            |

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
