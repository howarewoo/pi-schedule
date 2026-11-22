# Security policy

## Reporting a vulnerability

Please report suspected security vulnerabilities privately through
[GitHub's vulnerability reporting form](https://github.com/howarewoo/pi-schedule/security/advisories/new).
Do not disclose vulnerabilities, credentials, or sensitive reproduction details in public
issues or pull requests.

Include the affected version, reproduction steps, and potential impact. Remove API keys,
tokens, personal data, and private repository content from logs and examples.

## Supported versions

Security fixes target the latest published release. Please upgrade to the latest release
before reporting a problem, when possible.

## Trust boundaries

The `schedule` tool lets the model create and cancel jobs without asking for confirmation,
so that scheduling also works in headless and RPC sessions. Every fire starts a model turn
with the session's existing tools and permissions; a scheduled prompt has no more authority
than a prompt typed into the same session. Only run the extension in projects you trust, and
review active jobs with `/schedule`.

A fire delivers its prompt as a custom message. It never runs slash commands, skills, prompt
templates or shell commands itself. Session limits (at most 10 jobs, each firing at most once
a minute) bound cost, but each fire can still incur provider charges.

## Session storage

Job definitions, including their prompts, are saved as custom entries in the Pi session file
so that `/reload`, `/resume` and `pi -c` can restore them. The extension writes no other files
and uses no daemon or OS crontab. Protect session storage accordingly, and do not put secrets
in scheduled prompts.
