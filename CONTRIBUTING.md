# Contributing to mn-doctor

mn-doctor is maintained by Maureen. Issues are welcome. This repository is updated on `main`; check with the maintainer before opening a pull request.

## Development

Node.js 20 or newer.

```bash
npm ci
npm test
npm run demo
```

`npm test` compiles TypeScript to `dist/` and runs the fixture suite. The published CLI and the GitHub Action both run `dist/cli.js`, so commit the rebuilt `dist/` with source changes. CI fails if `dist/` is stale.

The compiler pin is printed and never executed. Tests pass `--compact-version` so they do not need the Compact devtools installed.

## Compatibility data

`data/compat.json` is the version matrix the CLI reads. It records the docs support matrix, `midnight-sdk` `COMPATIBILITY.md`, Compact release notes, and npm pins, including where those sources disagree.

Refresh it from the live pages:

```bash
npm run compat:refresh
```

That rewrites the parsed version fields and keeps editorial notes (wallet package generations, the ledger npm pin versus the proof server tag, the on-chain runtime split). Review the diff before committing. `npm run compat:refresh -- --check` exits 1 when the fetched versions differ and does not write the file.

Versions below 1.0, especially `@midnight-ntwrk/compact-runtime`, break on a minor bump. Keep those pins exact.
