import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadCompat } from '../src/compat.js';
import { parseDocsMatrix, parseSdkCompatibility } from '../src/parse-sources.js';
import { mergeFetched } from '../src/refresh.js';

const DOCS = `
## Preview support matrix

| Functional area | Component | Version | Notes |
| --- | --- | --- | --- |
| Network | Node (Midnight) | 1.0.400 | Preview network node |
| Runtime and contracts | Compact devtools (\`compact\`) | 0.5.1 | Installs compilers |
| | Compact toolchain (\`compact compile\`) | 0.31.1 | Contract compiler |
| | Compact runtime | 0.16.0 | Runtime library |
| | Compact JS | 2.5.1 | TypeScript |
| | Platform JS | 2.2.4 | Core types |
| | On-chain runtime | 3.0.0 | v3 |
| SDKs and APIs | Wallet SDK | 1.2.0 | Wallet |
| | Midnight.js | 4.1.1 | DApp framework |
| | testkit-js | 4.1.1 | E2E |
| | DApp Connector API | 4.0.1 | Wallets |
| Indexing and data | Midnight Indexer | 4.3.5 | Preview indexer |
| ZK and proving services | Proof server | 8.1.3 | Proofs |

## Mainnet support matrix

| Functional area | Component | Version | Notes |
| --- | --- | --- | --- |
| Network | Node (Midnight) | 1.0.400 | Mainnet |
| | Compact toolchain (\`compact compile\`) | 0.31.1 | Compiler |
| | Compact runtime | 0.16.0 | Runtime |
| | Midnight.js | 4.1.1 | DApp |
| | Proof server | 8.1.3 | Proofs |
`;

const SDK = `
# Compatibility Matrix

What runs on each Midnight network (updated 2026-04-07).

## Infrastructure (server-side)

| Component | Preview | Preprod | Mainnet |
| --- | --- | --- | --- |
| Node | 0.22.3 | 0.22.2 | 0.22.1 |
| Proof Server | 8.0.3 | 8.0.3 | 8.0.3 |
| Indexer | 4.0.0 | 4.0.0 | 4.0.0 |

### Compatible version sets

| Component | Stable | Pre-release |
| --- | --- | --- |
| Compact Compiler (\`compactc\`) | [0.30.0](https://example.invalid/c) | — |
| Compact Toolchain (\`compact\`) | [0.5.1](https://example.invalid/t) | — |
| Compact Language | 0.22.0 | — |
| @midnight-ntwrk/compact-js | 2.5.0 | — |
| @midnight-ntwrk/compact-runtime | 0.15.0 | — |
| @midnight-ntwrk/midnight-js-* | 4.0.4 | — |
| @midnight-ntwrk/wallet-sdk-facade | 3.0.0 | — |
| @midnight-ntwrk/ledger-v8 | 8.0.3 | — |
| @midnight-ntwrk/platform-js | 2.2.4 | — |
`;

describe('official source parsers', () => {
  it('reads the docs matrix and the SDK file', () => {
    const docs = parseDocsMatrix(DOCS);
    const sdk = parseSdkCompatibility(SDK);
    assert.equal(docs.networks.preview?.toolchain, '0.31.1');
    assert.equal(docs.networks.preview?.midnightJs, '4.1.1');
    assert.equal(docs.networks.preview?.proofServer, '8.1.3');
    assert.equal(docs.networks.mainnet?.node, '1.0.400');
    assert.equal(sdk.updated, '2026-04-07');
    assert.equal(sdk.stable.compactc, '0.30.0');
    assert.equal(sdk.stable.devtools, '0.5.1');
    assert.equal(sdk.stable.midnightJs, '4.0.4');
    assert.equal(sdk.stable.runtime, '0.15.0');
    assert.equal(sdk.infrastructure.node?.mainnet, '0.22.1');
    assert.equal(sdk.infrastructure.proofServer?.preview, '8.0.3');
  });

  it('merges a fetched matrix onto the shipped data without dropping editorial notes', () => {
    const current = loadCompat();
    const next = mergeFetched(current, parseDocsMatrix(DOCS), parseSdkCompatibility(SDK), '2026-11-03');
    const recommended = next.stacks.find((stack) => stack.recommended);
    const wallet = next.disagreements.find((row) => row.id === 'wallet');
    assert.equal(recommended?.toolchain, '0.31.1');
    assert.equal(recommended?.midnightJs, '4.1.1');
    assert.equal(recommended?.install.compiler, 'compact update 0.31.1');
    assert.ok(wallet?.editorial);
    assert.match(wallet?.detail ?? '', /1\.2\.0/);
    const midnight = next.disagreements.find((row) => row.id === 'midnight-js');
    assert.equal(midnight?.docs, '4.1.1');
    assert.equal(midnight?.sdk, '4.0.4');
  });
});

describe('shipped compat.json', () => {
  const data = loadCompat();

  it('records the versions verified on 2026-11-03', () => {
    const recommended = data.stacks.find((stack) => stack.id === 'docs-public-networks');
    const older = data.stacks.find((stack) => stack.id === 'sdk-compatibility-2026-04-07');
    assert.equal(recommended?.toolchain, '0.31.1');
    assert.equal(recommended?.compactRuntime, '0.16.0');
    assert.equal(recommended?.midnightJs, '4.1.1');
    assert.equal(recommended?.ledger.version, '8.1.0');
    assert.equal(recommended?.proofServer, '8.1.3');
    assert.equal(older?.toolchain, '0.30.0');
    assert.equal(older?.compactRuntime, '0.15.0');
    assert.equal(older?.midnightJs, '4.0.4');
    assert.equal(data.npm.compactRuntimeDistTags.latest, '0.20.0');
    assert.equal(data.publicLedgerMajor, 8);
    const compiler = data.toolchains.find((entry) => entry.version === '0.35.0');
    assert.equal(compiler?.ledgerMajor, 9);
    assert.equal(compiler?.runtime, '0.20.0');
    assert.equal(data.sources.find((source) => source.id === 'sdk-compatibility')?.statedUpdated, '2026-04-07');
  });
});
