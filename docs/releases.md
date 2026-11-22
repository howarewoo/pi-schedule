# Release guide

Publish deliberate, versioned npm releases. GitHub releases use the matching entry from
`CHANGELOG.md`; Pi owns installation and updates. Publishing executes no live model calls.
The repository workflows do not publish on ordinary main-branch pushes.

## Version and compatibility policy

- During 0.x, use a patch for compatible fixes and polish, and a minor for new functionality
  or breaking changes. Label breaking changes and explain migration in the changelog.
- Move to 1.0 when the public tool, command and message contracts are stable. After 1.0,
  use semantic versioning: major for breaking changes, minor for compatible features,
  patch for compatible fixes.
- The `schedule` tool arguments, `/schedule` command syntax, fired message format
  (`customType: "pi-schedule"`) and saved session entries (`pi-schedule-state`) are
  user-facing contracts. A small implementation change can still require a breaking release.
- This pipeline publishes stable versions to npm's `latest` channel. Prerelease versions
  are rejected until a separate channel policy is added.
- **Tested host: Pi 1.6.0**, with Node 22.19 or newer. The extension does not enforce a
  minimum host version; other Pi versions are not verified. Wildcard host peer dependencies
  remain required by Pi's packaging format, not a compatibility promise. Keep host development
  dependencies pinned and verify tool, command, session restore and delivery behavior before
  claiming another tested Pi version.
- Never move a release tag, reuse a published version or overwrite retained user artifacts.

## One-time owner bootstrap

`@howarewoo/pi-schedule` has **not been published to npm yet**. A repository owner and an npm
package owner must complete these steps before the first tag-triggered release. They are not
performed by the local scripts or by any pull request.

1. Confirm your npm account can publish `@howarewoo/pi-schedule` in the `@howarewoo` scope.
2. Enable GitHub Actions for this repository. Create a GitHub environment named `npm`.
   Require human approval by `howarewoo`, allow self-approval, and restrict deployment refs
   to release tags (`v*`). Do not run a release until this protection is configured.
   Protect `main` with the two CI matrix checks and restrict creation/deletion of `v*` tags
   to release maintainers using repository rulesets.
3. Bootstrap the package with the [first manual npm publish](#first-npm-publish-only) below.
   A trusted publisher is normally configured from an existing package's settings, so do not
   assume the first tag-triggered run can create a new npm package without account setup.
4. In **`@howarewoo/pi-schedule` → Settings → Trusted publishing**, add GitHub Actions with:

   | Field                | Value         |
   | -------------------- | ------------- |
   | Organization or user | `howarewoo`   |
   | Repository           | `pi-schedule` |
   | Workflow filename    | `release.yml` |
   | Environment name     | `npm`         |

   Permit direct `npm publish` if npm presents an allowed-actions selector. The workflow uses
   GitHub-hosted runners and `id-token: write`; no `NPM_TOKEN` secret is needed. Use npm
   11.5.1 or newer for OIDC publishing (the release runner uses Node 24).

5. Follow npm's current validation/expiry rules when creating the trusted publisher; create it
   near the next release. After successful OIDC publication, restrict traditional token-based
   publishing and revoke unused automation tokens. Public GitHub/OIDC publication supplies npm
   provenance automatically.

See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) for
current account requirements and troubleshooting. Do not use `npm whoami` to test OIDC: it does
not validate trusted publishing permissions.

The environment, required reviewer/tag restrictions, and repository rulesets are owner
prerequisites, not settings created by the release tooling. Do not treat the workflow's
`environment: npm` declaration as an approval rule: GitHub can create an unprotected
environment when a job references a new name. Confirm these settings before any tag push or
manual workflow dispatch.

## Contributor titles and release notes

Ordinary PRs do **not** edit `CHANGELOG.md`. Use `type(optional-scope)!: description`
for PR titles, with one of `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`,
`ci`, `chore`, `revert` or `style`. For example, `feat(schedule): add pause action`
or `fix: clear stuck pending fires`. Describe user-visible changes and migration in the PR
body; use `!` for breaking changes and retain `BREAKING CHANGE:` footers in the final
commit body. These details are inputs to release review, not proof of migration completeness.

The read-only **PR title** workflow checks opened and edited titles (also reopened,
synchronized and ready-for-review PRs). It passes the title as environment data, never as
shell source, uses no secrets or elevated `pull_request_target` execution, and installs no
dependencies. Locally, run `PR_TITLE='fix: clear stuck pending fires' npm run pr-title:check`.

The repository allows merge commits, squash merges and rebase merges, so a PR title is
**not guaranteed** to become the final commit title or preserve the PR description.
Maintainers should squash ordinary PRs and explicitly confirm the final conventional title
and meaningful body, including breaking/migration guidance. No repository settings or branch
protection are changed by this check. Generation uses first-parent history: a merge commit
is listed instead of its branch commits, and rebase merges may produce multiple entries.

## Prepare each release

1. Start from current `main`, with no unrelated local changes. Review the changes being released.
   Fetch complete history and tags first (for a shallow clone, `git fetch --unshallow --tags`;
   otherwise `git fetch --tags`). Identify the actual previous release tag; generation never
   guesses one from dates or version sorting and needs no GitHub API access.
2. On a release-preparation branch, update the manifest and lockfile without creating a tag:

   ```sh
   npm version 0.2.0 --no-git-tag-version
   ```

   Choose the actual next stable version according to the compatibility policy above.
   Preserve existing release tags and historical changelog entries.

3. Generate the new version section from the explicit prior release tag through current `HEAD`:

   ```sh
   npm run changelog:generate -- --from v0.1.0 --dry-run
   npm run changelog:generate -- --from v0.1.0
   ```

   Replace both example versions as appropriate. The target version comes from `package.json`.
   The preview prints the new section without writing; normal generation inserts it before the
   first historical release, after `Unreleased` if present. It leaves existing text unchanged.
   Existing nonempty `Unreleased` notes are **copied**, not silently moved or discarded, into
   **Previously curated notes** in the new section. Review these alongside generated entries
   to remove duplicates in the new section. Clear or move `Unreleased` notes only deliberately
   in the reviewed release PR after confirming their inclusion; otherwise they will be copied
   again next time. Generation itself never clears them.

   Entries retain subjects, PR-number suffixes and commit references, oldest first within
   each group: `feat` → **Features**, `fix`/`perf` → **Fixes and performance**, all other types
   → **Other changes**. Nonconventional legacy subjects are retained with warnings. Breaking
   `!` markers and `BREAKING CHANGE:` (also `BREAKING-CHANGE:`) body footers are surfaced in
   **Breaking changes**, independently of type. A marker without details asks for manual guidance.

   **Review and enrich the generated section** with migration, Pi compatibility and relevant
   tool, command or session-entry changes. Commit metadata is only a starting point. Do not
   promise verification that has not run. Keep README installation/migration examples current.

   Missing or nonancestor tags, shallow/incomplete history, an empty range, unstable versions
   and duplicate version headings fail before writing. Fix the input or fetch full history;
   never bypass these errors by moving a release tag. A duplicate heading protects reviewed
   notes from regeneration: use `--dry-run` before the first generation, or review a fresh
   preview in a disposable checkout with the target section absent. Do not delete reviewed
   notes merely to rerun the generator.

4. Run the local gates:

   ```sh
   npm ci --ignore-scripts
   npm run check
   npm run release:check
   npm run test:package
   ```

   `release:check` verifies the stable version, tag, changelog section and lockfile identity:
   the lockfile name and root `name`, `version`, `engines`, `dependencies`,
   `peerDependencies` and `devDependencies` must match `package.json`, with public
   `publishConfig.access`.

   Package smoke testing inspects the real tar entries against the allowlist in
   `scripts/test-package.config.mjs`. It then installs the tarball cache-first
   (`--prefer-offline`) into a disposable directory, with an empty npm user config and without
   host peers or lifecycle scripts. It
   requires the whole installed manifest to equal `package.json`, the installed tree to equal
   the locked production dependencies with no duplicated host packages, required files to be
   present and packed README links to resolve. It loads the extension with the pinned Pi host
   (`devDependencies["@earendil-works/pi-coding-agent"]`), checks the exact `schedule` tool and
   command registrations and the npm startup label, and runs the config's optional `verify`
   hook. It does not test live-provider reliability.

5. Submit the version/changelog changes as a human-reviewed release PR and merge it after CI.
   These instructions describe maintainer actions; local checks do not commit or publish.

CI runs all checks and the package smoke test on Node 22.19.0 and Node 24. It uses pinned Pi
1.6.0 development packages, not an implied matrix of all Pi versions.

## First npm publish only

Bootstrap for the first release, `0.1.0`. Run it once, after completing steps 1 and 2 of the
[one-time owner bootstrap](#one-time-owner-bootstrap); later versions use the tag-triggered
workflow.

Check out the exact clean `main` commit that contains the `0.1.0` changelog entry and run the
local gates above. Use an npm account with publishing rights and two-factor authentication:

```sh
npm login
release_dir="$(mktemp -d)"
npm pack --pack-destination "$release_dir"
npm run test:package -- "$release_dir/howarewoo-pi-schedule-0.1.0.tgz"
npm publish "$release_dir/howarewoo-pi-schedule-0.1.0.tgz" --access public --ignore-scripts
```

Inspect the result with `npm view @howarewoo/pi-schedule@0.1.0 version dist.integrity`.
Keep the tarball until verified, then remove the temporary directory. This interactive bootstrap
is separate from GitHub OIDC and does not claim GitHub provenance. Configure the trusted publisher
(step 4) before pushing any release tag.

To record the bootstrap release on GitHub, tag that same commit as `v0.1.0` and push the tag
after configuring the trusted publisher. The workflow accepts an already-published version only
when its registry SHA-512 integrity matches the newly verified tarball byte for byte, so it skips
npm publication and creates the GitHub release. If the repacked tarball differs, the workflow
stops; leave `v0.1.0` as an npm-only release and publish the next version through the workflow.

## Tag and publish

From the exact merged release commit (replace the example version as needed):

```sh
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0
```

`release.yml` accepts tag pushes and manual dispatch on an existing `v*` tag, not branch
dispatch. Its three GitHub-hosted jobs run in order:

1. **validation** has only `contents: read`, no OIDC permission or publishing environment.
   It checks main ancestry, tag/manifest/lockfile versions and changelog, installs dependencies
   with `npm ci --ignore-scripts`, runs the existing checks, packs once, and smoke-tests that
   exact tarball. It uploads package/metadata and notes as separate immutable artifacts.
2. **publish** depends on validation and requires the protected `npm` environment approval.
   Only this job has `id-token: write`; it has `contents: read`, never `contents: write`.
   It selects the package artifact by validation's exact artifact ID from the current run.
   Before any registry request, the reviewed checked-out, dependency-free publish helper
   requires regular metadata/tarball files, checks the fixed package name, stable version,
   tag, commit and fixed tarball filename, and recomputes SHA-512 against validation's job
   output. A missing or mismatched download is fatal; download-action digest warnings are
   not the publication gate. It then requires the GitHub OIDC request context, refuses
   `NPM_TOKEN`/`NODE_AUTH_TOKEN` and requires npm 11.5.1 or newer, so publication cannot
   fall back to a stored token. `node scripts/publish-package.mjs <dir> --verify-only`
   performs only the artifact checks, with no registry access or publication. It neither
   installs dependencies nor extracts/executes archive content, runs tests, or repacks. `npm publish --ignore-scripts` suppresses lifecycle scripts.
3. **github-release** depends on npm success. It has `contents: write` but no OIDC permission,
   downloads only the selected notes artifact, and creates the GitHub release without checking
   out or executing package code. An existing release remains unchanged.

Releases serialize; a later tag does not cancel an active publish. Artifact retention is seven
days. If artifacts expire, rerun validation and all downstream jobs on the same immutable tag
rather than substituting an artifact from another run. No executable helper comes from the
transferred artifact. Separation limits credential exposure during tests/builds; it does not
prove that a compromised validation job produced trustworthy package bytes. Review the release
commit and approval evidence before authorizing publication.

The artifact behavior follows [GitHub's artifact documentation](https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts).
OIDC still requires the actual npm account setup described above; documentation and job
permissions alone do not prove that account binding exists.

Verify both the npm version/integrity and the GitHub release before announcing it. Test a clean
Pi install, run `/schedule`, and confirm the documented update path. No tag, registry publish,
trusted-publisher setting or fresh installed-package user walkthrough is performed by local CI checks.

## Recover a partial or bad release

- **Failed before npm publication:** fix the configuration or external prerequisite, then rerun
  the workflow for the same tag. Do not move the tag to a changed commit.
- **npm published, GitHub release failed:** rerun the failed workflow, or dispatch **Release**
  on the same existing tag. It skips npm publication only when that version's integrity exactly
  matches the verified tarball. An existing GitHub release is left unchanged. A different integrity
  or a registry error stops the workflow; do not bypass the check.
- **Published contents are wrong:** prepare a new patch (or appropriate breaking version), with
  clear changelog guidance. Deprecate the affected version with an explanatory npm message if
  needed; do not unpublish as the normal rollback strategy.
- **User rollback:** explicitly install the last known-good version, then restart Pi. For
  example, `pi install npm:@howarewoo/pi-schedule@0.1.0` if that is the last known-good release.
  Pinning code does not undo incompatible session-entry changes; follow release-specific
  migration instructions. Restarting Pi stops all jobs; reopened sessions restore saved jobs.
