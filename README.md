<p align="center">
  <img src="assets/brand/readme-banner.png" alt="mn-doctor. A calm doctor for your Midnight toolchain." width="1280">
</p>

<p align="center">
  <a href="https://github.com/maureenblack/mn-doctor/blob/main/package.json"><img src="https://img.shields.io/badge/version-0.1.0-c67139?style=flat-square&labelColor=201e1d" alt="version 0.1.0"></a>
  <a href="https://github.com/maureenblack/mn-doctor/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/maureenblack/mn-doctor/ci.yml?branch=main&style=flat-square&label=ci&labelColor=201e1d" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-Apache--2.0-645c50?style=flat-square&labelColor=201e1d" alt="Apache-2.0"></a>
</p>

# A calm doctor for your Midnight toolchain.

mn-doctor checks that your Compact compiler, runtime packages and proof server are on matching versions, explains any mismatch in plain English, and fixes it after showing you the diff.

```bash
npx mn-doctor
```

<img src="assets/brand/terminal-check.png" alt="mn-doctor check on the ledger 9 compiler fixture" width="720">

That screenshot is a real `mn-doctor check` of `test/fixtures/broken-compiler-ledger9`: Compact compiler **0.35.0** (ledger 9) against compact-runtime **0.16.0**, Midnight.js **4.1.1**, and `midnightntwrk/proof-server:8.1.3`. The fix it prints is `compact update 0.31.1`.

The npm package is not published yet. From a checkout: `npm ci && npm run build && npx .`. The brand guide is [docs/brand-guide.html](docs/brand-guide.html).

## Why this exists

A Midnight dApp has to line up the Compact compiler, the language pragma in `.compact` files, `@midnight-ntwrk/compact-runtime`, Midnight.js, the ledger npm package, the wallet SDK, and the proof server image. Those pieces move on different clocks, and two official pages describe them differently.

On 3 November 2026:

- Preview, preprod, and mainnet run **ledger 8**. The [docs support matrix](https://docs.midnight.network/relnotes/support-matrix) tests Compact toolchain **0.31.1**, compact-runtime **0.16.0**, and Midnight.js **4.1.1**. The proof server image is `midnightntwrk/proof-server:8.1.3`.
- Compact **0.34.0** and **0.35.0** target **ledger 9**. A bare `compact update` installs the newest toolchain, which was 0.35.0, and the contracts it emits cannot be deployed to those networks.
- npm `latest` for `@midnight-ntwrk/compact-runtime` was **0.20.0**, the runtime 0.35.0 emits. Midnight.js 4.1.1 pins **0.16.0**. Mixing them throws `Version mismatch: compiled code expects 0.20.0, runtime is 0.16.0` (or the reverse).
- [`COMPATIBILITY.md`](https://github.com/midnightntwrk/midnight-sdk/blob/main/COMPATIBILITY.md) in midnight-sdk, dated **2026-04-07**, still lists compiler **0.30.0**, compact-runtime **0.15.0**, Midnight.js **4.0.4**, and proof server **8.0.3**. That set is also ledger 8. It is older than the docs matrix, and the two pages disagree.

`mn-doctor` reports the project's own mismatches and, separately, where those official sources disagree. The disagreement section does not fail the check. A project that consistently follows the April 2026 SDK file is a warning. A project that mixes ledger 8 and ledger 9 is a failure.

## What `check` looks at

`mn-doctor check` is the default command. It reads the project in `--cwd` (the current directory by default):

| Signal | Where |
| --- | --- |
| `@midnight-ntwrk/*` and `@midnightntwrk/*` versions | `package.json`, including workspaces one level down, plus `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, or `bun.lock` |
| Compact devtools and compiler | `compact --version`, `compact compile --version`, `compactc --version`, plus `--runtime-version`, `--language-version`, and `--ledger-version` when the compiler is installed |
| Language pragma | `pragma language_version` in `.compact` files |
| Proof server | `midnightntwrk/proof-server:<tag>` in compose files, Dockerfiles, and env files |

`--network` is `preview`, `preprod`, `mainnet` (the default), or `testnet` (treated as a ledger 8 public network; the docs currently name preview, preprod, and mainnet). Client pins are the same on all three. The indexer version in the data file differs by network and is reported with the source disagreement, not required in a dApp repo.

Exit **0** when nothing conflicts. Exit **1** when a component targets another ledger, the compiler's runtime does not match the installed runtime, Midnight.js packages disagree with each other, or a `0.x` range can float onto another minor. Warnings, including "this matches the older SDK file", keep exit 0. `--strict` turns those warnings into failures.

```bash
mn-doctor check --network preprod
mn-doctor check --json
mn-doctor check --compact-version 0.31.1 --devtools-version 0.5.1
mn-doctor check --strict
```

`--compact-version` and `--devtools-version` skip probing the PATH. Use them in CI when the compiler is not installed on the runner and you still want the rest of the project checked against a chosen compiler.

A project on the docs set prints a clean bill of health: compiler **0.31.1**, compact-runtime **0.16.0**, Midnight.js **4.1.1**, proof server **8.1.3**. A bare `compact update` onto 0.35.0, with runtime 0.16.0 still installed, exits 1 and tells you to run `compact update 0.31.1`.

## `fix`

`mn-doctor fix` proposes the docs known-good set for public networks:

| Piece | Pin |
| --- | --- |
| Compiler | `compact update 0.31.1` |
| Language pragma | `pragma language_version 0.23;` |
| `@midnight-ntwrk/compact-runtime` | `0.16.0` |
| `@midnight-ntwrk/compact-js` | `2.5.1` |
| `@midnight-ntwrk/midnight-js*` and testkit | `4.1.1` |
| `@midnight-ntwrk/onchain-runtime-v3` | `3.0.0` |
| `@midnight-ntwrk/ledger-v8` beside Midnight.js 4.1.1 | `8.1.0` |
| `@midnightntwrk/wallet-sdk` (wallet-only projects) | `1.2.0`, with ledger-v8 `8.1.3` |
| Proof server | `midnightntwrk/proof-server:8.1.3` |

It prints a diff and does not write files until you confirm or pass `--yes`. It prints `compact update 0.31.1` and does not run it. It also prints the package-manager install for the packages it changed (`npm`, `pnpm`, `yarn`, or `bun`, chosen from the lockfile) and does not run that either.

`@midnight-ntwrk/midnight-js-protocol@4.1.1` depends on `@midnight-ntwrk/ledger-v8@8.1.0` exactly. The network proof server is `8.1.3`. Those are the same ledger major. A direct dependency on `ledger-v8@8.1.3` cannot be installed next to Midnight.js 4.1.1. Wallet-only projects, with the barrel SDK and no Midnight.js or Compact runtime, are pinned to `ledger-v8@8.1.3` instead, which is what the wallet guide installs.

The old `@midnight-ntwrk/wallet-sdk-facade@3.0.0` package is a different generation from `@midnightntwrk/wallet-sdk@1.2.0`. `fix` does not rename it.

```bash
mn-doctor fix --network mainnet
mn-doctor fix --yes
mn-doctor fix --json
```

Exit **2** when file edits were proposed and not written. Exit **0** when there was nothing to write, or when `--yes` wrote the files. The compiler command can still be sitting in the output after a successful write, because installing Compact is left to you. Run `mn-doctor check` again after you install it.

## Compatibility data

[`data/compat.json`](data/compat.json) is the matrix the CLI ships. Each source has a URL and a fetch date (2026-11-03 for this release). The file records both stacks, the Compact toolchain ledger map (0.30 and 0.31 are ledger 8, 0.34 and 0.35 are ledger 9), the npm pins verified that day, and the disagreements above.

Refresh it after Midnight publishes a new matrix:

```bash
npm run compat:refresh
```

`npm run compat:refresh -- --check` compares the fetched pages with the committed file and does not write.

## GitHub Action

The runner needs Node.js 20 or newer (`actions/setup-node`, or the Node already on GitHub-hosted runners).

```yaml
name: midnight
on: [push, pull_request]
jobs:
  toolchain:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: maureenblack/mn-doctor@v1
        with:
          network: preprod
```

| Input | Default | Purpose |
| --- | --- | --- |
| `network` | `mainnet` | `preview`, `preprod`, `mainnet`, or `testnet` |
| `working-directory` | `.` | DApp directory |
| `strict` | `false` | Fail unless the project matches the docs matrix |
| `json` | `false` | Print the JSON report in the job log |
| `compact-version` | empty | Check this compactc version when the compiler is not installed |
| `devtools-version` | empty | Check this `compact` CLI version |

The action is composite and runs `dist/cli.js` from the action repository. The check fails the step when the CLI exits 1.

`v1` tracks the current action interface. `v1.0.0` stays on the first tagged commit.

## Development

```bash
git clone https://github.com/maureenblack/mn-doctor.git
cd mn-doctor
npm ci
npm test
npm run demo
```

See [CONTRIBUTING.md](CONTRIBUTING.md). The license is [Apache-2.0](LICENSE). Copyright is in [NOTICE](NOTICE).

## Limits of v1

`mn-doctor` does not install Compact, does not run the package manager, and does not publish a ledger 9 network profile. Ledger 9 is not on preview, preprod, or mainnet in the sources fetched for this release. Indexer `4.3.302` is listed by the docs for preprod and mainnet with a note that it has no public tag yet, so the CLI does not require an indexer package in the dApp.
