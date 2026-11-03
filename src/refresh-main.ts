import { writeFileSync } from 'node:fs';

import { defaultCompatPath, loadCompat } from './compat.js';
import { parseDocsMatrix, parseSdkCompatibility } from './parse-sources.js';
import { mergeFetched } from './refresh.js';
import type { CompatData } from './types.js';

const DOCS_URL = 'https://docs.midnight.network/relnotes/support-matrix.md';
const SDK_URL = 'https://raw.githubusercontent.com/midnightntwrk/midnight-sdk/main/COMPATIBILITY.md';

async function fetchText(url: string): Promise<string> {
  let last = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { headers: { 'user-agent': 'mn-doctor-refresh' } });
    if (response.ok) return response.text();
    last = `${response.status} ${response.statusText}`;
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
  }
  throw new Error(`Failed to fetch ${url}: ${last}`);
}

async function refreshNpm(data: CompatData, fetchedAt: string): Promise<void> {
  const runtimeResponse = await fetch('https://registry.npmjs.org/@midnight-ntwrk/compact-runtime');
  if (runtimeResponse.ok) {
    const body = (await runtimeResponse.json()) as { 'dist-tags'?: Record<string, string> };
    if (body['dist-tags']) {
      data.npm.compactRuntimeDistTags = body['dist-tags'];
      data.npm.verifiedAt = fetchedAt;
    }
  }
  const recommended = data.stacks.find((stack) => stack.recommended);
  if (!recommended) return;
  const protocolUrl = `https://registry.npmjs.org/@midnight-ntwrk/midnight-js-protocol/${recommended.midnightJs}`;
  const protocolResponse = await fetch(protocolUrl);
  if (!protocolResponse.ok) return;
  const body = (await protocolResponse.json()) as { dependencies?: Record<string, string> };
  const line = data.releaseLines.find((item) => item.match === recommended.midnightJs.split('.').slice(0, 2).join('.'));
  if (!line || !body.dependencies) return;
  for (const [name, range] of Object.entries(body.dependencies)) {
    if (!name.startsWith('@midnight-')) continue;
    const exact = range.match(/^(\d+\.\d+\.\d+)$/)?.[1];
    if (exact) line.packages[name] = exact;
  }
  line.source = `npm registry @midnight-ntwrk/midnight-js-protocol@${recommended.midnightJs} (${fetchedAt})`;
}

function comparable(data: CompatData): string {
  return JSON.stringify({
    stacks: data.stacks.map((stack) => ({
      id: stack.id,
      toolchain: stack.toolchain,
      runtime: stack.compactRuntime,
      midnightJs: stack.midnightJs,
      proofServer: stack.proofServer,
    })),
    disagreements: data.disagreements.map((row) => ({ id: row.id, docs: row.docs, sdk: row.sdk })),
    networks: data.networks,
  });
}

async function main(): Promise<number> {
  const check = process.argv.includes('--check');
  const fetchedAt = new Date().toISOString().slice(0, 10);
  const [docsMd, sdkMd] = await Promise.all([fetchText(DOCS_URL), fetchText(SDK_URL)]);
  const docs = parseDocsMatrix(docsMd);
  const sdk = parseSdkCompatibility(sdkMd);
  if (!docs.networks.mainnet?.toolchain || !sdk.stable.compactc) {
    throw new Error('Parser did not find compiler versions. The page format may have changed.');
  }
  const current = loadCompat();
  const next = mergeFetched(current, docs, sdk, fetchedAt);
  await refreshNpm(next, fetchedAt);
  if (check) {
    const same = comparable(current) === comparable(next);
    console.log(same ? 'compat.json matches the fetched sources.' : 'compat.json differs from the fetched sources.');
    console.log(`docs compiler ${docs.networks.mainnet.toolchain}, sdk compiler ${sdk.stable.compactc}`);
    return same ? 0 : 1;
  }
  const path = defaultCompatPath();
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Wrote ${path}`);
  console.log(`docs ${DOCS_URL}`);
  console.log(`sdk  ${SDK_URL}`);
  console.log(`compiler docs ${next.stacks.find((stack) => stack.recommended)?.toolchain} · sdk ${sdk.stable.compactc}`);
  return 0;
}

if ((process.argv[1] ?? '').endsWith('refresh-main.js')) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
