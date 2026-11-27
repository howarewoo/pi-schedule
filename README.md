# @howarewoo/pi-schedule

[![npm version](https://img.shields.io/npm/v/@howarewoo/pi-schedule)](https://www.npmjs.com/package/@howarewoo/pi-schedule)
[![npm downloads](https://img.shields.io/npm/dm/@howarewoo/pi-schedule)](https://www.npmjs.com/package/@howarewoo/pi-schedule)

A [Pi coding agent](https://pi.dev) extension that lets the agent, or you, schedule cron jobs whose prompts come back into the same session when they fire.

![A pi session where the user asks the agent to check deploy-status.txt every minute and report when staging finishes. The agent calls the schedule tool with cron "* * * * *", the tool replies with job 9124 and its next two fire times, and the footer shows "1 job, next 06:31 PM".](docs/images/schedule-created.png)

_The agent schedules itself to check a deploy status file every minute; the footer shows the job and its next fire time._

## Why use it

It is built for periodic check-ins during long agent runs. An orchestrating agent can wake itself every ten minutes to see whether a subagent has stalled, for example.

- The agent picks the schedule with the `schedule` tool: a 5-field cron expression with an optional IANA timezone, or a one-shot delay such as `45m`. You can do the same with the `/schedule` command.
- A fire starts a new turn when the session is idle. When the agent is busy, the prompt arrives after its current tool calls finish.
- The footer shows how many jobs exist and when the next one fires, and each fired message tells the model how to cancel its job.
- Jobs are saved in the session and come back when you reopen it with `/reload`, `/resume` or `pi -c`. Forks start with no jobs.
- There is no daemon or OS crontab, nothing is written outside the session, and the only runtime dependency is [croner](https://github.com/hexagon/croner).

Jobs fire only while the Pi session that created them is running. Quitting Pi stops them, and missed matches are not caught up when you reopen the session. If a job has to run while Pi is closed, use your operating system's scheduler instead.

Every fire starts a model turn and costs tokens, and the model can create jobs without asking you. A session holds at most 10 jobs, and a job fires at most once a minute. See [limits and cost](docs/behavior.md#limits-and-cost).

## Project status

Actively maintained, with releases below 1.0 (the npm badge shows the current version). It needs Node 22.19 or newer and is tested with Pi 1.6.0. It does not check the Pi version, and other Pi versions are not verified. Before 1.0, a minor release can change behavior, so read the [update notes](docs/installation.md#updates-and-rollback) before upgrading.

## Install

```sh
pi install npm:@howarewoo/pi-schedule
```

To install from Git instead, run `pi install git:github.com/howarewoo/pi-schedule`. Register only one source, or Pi loads the extension twice.

Restart Pi, then run `/schedule`. If it replies `No scheduled jobs.`, the extension is loaded. See [installation and updates](docs/installation.md) for pinned versions and rollback.

## Quick start

Start Pi in any project directory with a model selected through Pi's `/login` and `/model` commands. Ask Pi:

> Every minute, check whether this directory has a file named done.txt and tell me what you find. Stop after two runs.

The agent makes a tool call like this one; it writes its own `name` and `prompt`:

```json
{
  "action": "create",
  "cron": "* * * * *",
  "maxRuns": 2,
  "name": "check done.txt",
  "prompt": "Check whether this directory has a file named done.txt and report what you find."
}
```

The tool replies with the job id and the next two fire times, and the footer shows `⏱ 1 job · next` with the next fire time. Cron jobs follow the clock, so the first fire comes at the start of the next minute and adds this message to the conversation:

```text
[pi-schedule] check done.txt (job 53f2, cron "* * * * *", run 1/2)
Check whether this directory has a file named done.txt and report what you find.
This job keeps running. Only once it is no longer needed, cancel it with schedule {action: "cancel", id: "53f2"}.
```

The agent looks for the file and reports that it is missing. In another terminal, run `touch done.txt` in the same directory before the next minute starts, and on run 2 the agent reports that the file exists. After two runs the job removes itself and the footer status disappears. Run `/schedule` at any point to list jobs, or `/schedule cancel all` to stop them.

## Documentation

| Topic                                                      | What it covers                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Using schedules](docs/usage.md)                           | A full walkthrough, cron and one-shot jobs, the tool and the command   |
| [Behavior, limits and cost](docs/behavior.md)              | Delivery, pile-up, reload, forks, exit, subagents and per-session caps |
| [Installation and updates](docs/installation.md)           | Requirements, install sources, updates, pinned versions and rollback   |
| [Local development](docs/development.md)                   | Building, testing and loading the extension from a checkout            |
| [Releases](docs/releases.md) and [changelog](CHANGELOG.md) | Publishing process and user-facing changes                             |
| [Security policy](SECURITY.md)                             | Vulnerability reporting, trust boundaries and session storage          |

## License

[MIT](LICENSE)
