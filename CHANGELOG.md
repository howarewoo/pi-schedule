# Changelog

## [Unreleased]

## [0.1.0]

Initial versioned release.

- Schedule prompts back into the current Pi session with the `schedule` tool and the
  `/schedule` command: recurring jobs use an agent-chosen 5-field cron expression with an
  optional IANA timezone, and one-shot jobs use a delay of at least 1 minute.
- Wake an idle session with a new turn, or deliver after the current tool calls when busy.
  Later matches are skipped while an earlier fire is still undelivered.
- Restore jobs when the same session is reopened through `/reload`, `/resume` or `pi -c`;
  forks and clones start with no jobs.
- Show active jobs and the next fire time in the footer. Limit each session to 10 jobs and
  at most one fire per minute, with optional `maxRuns` caps for cron jobs.

### Compatibility and lifecycle

Tested against Pi 1.6.0; requires Node 22.19 or newer. Other Pi versions are not yet verified.
Jobs fire only while the Pi session that created them is running. Quitting Pi stops all jobs,
and pending timers never keep Pi alive.
