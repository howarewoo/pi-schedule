# Behavior, limits and cost

This page explains how fired jobs reach the conversation, what happens on reload, fork and exit,
and the limits that keep scheduled turns bounded. For the tool and command syntax, see
[Using schedules](usage.md).

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
