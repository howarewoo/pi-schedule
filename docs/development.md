# Local development

This page is for contributors working from a source checkout.

From a source checkout:

```sh
npm ci --ignore-scripts
npm run lint
npm run format:check
npm run typecheck
npm test
npm pack --dry-run
npm run test:package
```

`npm run check` runs lint, formatting, typecheck and tests. Tests run TypeScript directly through
Node's type stripping with `node --test`. `npm run test:package` packs the tarball, checks its
files and installs it in a temporary directory, then checks that the pinned Pi host loads the
production entrypoint and registers the `schedule` tool and command. It prefers the npm cache but
may fetch registry metadata for runtime dependencies. It does not use model credentials and leaves
your Pi settings unchanged.

Oxlint checks correctness rules; warnings fail the lint command. Run `npm run lint:fix` for safe
lint fixes and `npm run format` to apply Oxfmt formatting. Formatting skips the generated lockfile.

To try the extension from a local checkout without installing it, run
`pi -e /absolute/path/to/pi-schedule/index.ts`. The root `index.ts` re-exports the implementation
in `src/pi-schedule.ts`.

See the [release guide](releases.md) for versioning, publishing and recovery.
