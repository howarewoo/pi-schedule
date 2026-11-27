# Installation and updates

This page covers host requirements, install sources, updates, pinned versions and rollback. For a
first run, start with the [README quick start](../README.md#quick-start).

## Requirements and install sources

Requires **Node 22.19+**. Tested host: **Pi 1.6.0**; other Pi versions are not verified.
Wildcard host peer dependencies follow Pi's package format, not a compatibility promise.

Install from npm:

```sh
pi install npm:@howarewoo/pi-schedule
```

Alternatively, install from Git with `pi install git:github.com/howarewoo/pi-schedule`.
Use only one source: when switching between npm, Git or a local checkout, remove the
previously registered source first so Pi does not load the extension twice.

Restart Pi and run `/schedule` to check the installation; it replies `No scheduled jobs.`

## Updates and rollback

Restart Pi after updating. Quitting Pi stops all jobs, and reopening a session restores its saved
jobs under the new version. There is no extension-owned auto-updater.

```sh
# Update an unpinned npm installation
pi update npm:@howarewoo/pi-schedule

# Or update all installed extension packages
pi update --extensions
```

Plain `pi update` updates Pi itself, not installed extension packages. For a Git installation,
use `pi update git:github.com/howarewoo/pi-schedule`, matching the source you registered.
An unpinned Git source tracks the repository's default branch, including unreleased commits.

For a reproducible npm installation or rollback, select an exact published version:

```sh
pi install npm:@howarewoo/pi-schedule@0.1.0
```

For Git, select a published tag, for example
`pi install git:github.com/howarewoo/pi-schedule@v0.1.0`.
Exact npm versions and Git tags stay pinned; updating does not advance them to the next release.
Install a different version explicitly to change the pin.

[CHANGELOG.md](../CHANGELOG.md) lists user-facing changes and migrations. Pi shows new package
changelog entries on the next fresh launch after a version increase. See the
[maintainer release guide](releases.md) for publishing and recovery.
