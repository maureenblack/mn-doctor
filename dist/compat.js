import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gte, parseVersion, sameMinor } from './semver.js';
export function packageRoot() {
    return join(dirname(fileURLToPath(import.meta.url)), '..');
}
export function defaultCompatPath() {
    return join(packageRoot(), 'data', 'compat.json');
}
export function loadCompat(path = defaultCompatPath()) {
    const raw = readFileSync(path, 'utf8');
    const data = JSON.parse(raw);
    if (data.schemaVersion !== 1) {
        throw new Error(`Unsupported compat schema ${String(data.schemaVersion)} in ${path}`);
    }
    return data;
}
export function recommendedStack(data) {
    const stack = data.stacks.find((item) => item.id === data.recommendedStackId);
    if (!stack)
        throw new Error(`Recommended stack ${data.recommendedStackId} is missing from compat data`);
    return stack;
}
export function olderStacks(data) {
    return data.stacks.filter((item) => !item.recommended);
}
export function networkLedger(data, network) {
    return data.networks[network]?.ledgerMajor ?? data.publicLedgerMajor;
}
const NETWORK_ALIASES = {
    testnet: 'preview',
};
export function canonicalNetwork(network) {
    const requested = (network ?? 'mainnet').toLowerCase();
    if (NETWORK_ALIASES[requested]) {
        return { id: NETWORK_ALIASES[requested], aliasOf: requested };
    }
    return { id: requested };
}
export function knownNetworks(data) {
    return Object.keys(data.networks);
}
function fallbackLedger(version, rows) {
    const sorted = [...rows].sort((a, b) => (gte(a.min, b.min) ? -1 : 1));
    for (const row of sorted) {
        if (gte(version, row.min))
            return row.ledgerMajor;
    }
    return null;
}
export function describeToolchain(data, version, reported) {
    const exact = data.toolchains.find((entry) => entry.version === version);
    const sameLine = data.toolchains
        .filter((entry) => sameMinor(entry.version, version))
        .sort((a, b) => (gte(a.version, b.version) ? 1 : -1));
    const catalog = exact ?? sameLine.at(-1) ?? null;
    let ledgerMajor = catalog?.ledgerMajor ?? fallbackLedger(version, data.toolchainLedgerFallback);
    const reportedMajor = reported?.ledgerVersion
        ? Number(/^ledger-(\d+)/.exec(reported.ledgerVersion)?.[1] ?? NaN)
        : NaN;
    if (Number.isFinite(reportedMajor))
        ledgerMajor = reportedMajor;
    if (ledgerMajor === null)
        ledgerMajor = data.publicLedgerMajor;
    return {
        version,
        ledgerMajor,
        runtime: reported?.runtimeVersion ?? catalog?.runtime ?? null,
        language: reported?.languageVersion ?? catalog?.language ?? null,
        fromCatalog: catalog !== null,
        catalog,
    };
}
export function ledgerForRuntime(data, version) {
    const fromToolchain = data.toolchains.find((entry) => sameMinor(entry.runtime, version));
    if (fromToolchain)
        return fromToolchain.ledgerMajor;
    return fallbackLedger(version, data.runtimeLedgerFallback);
}
export function ledgerForLanguage(data, version) {
    const match = data.toolchains.find((entry) => sameMinor(entry.language, version));
    if (!match)
        return null;
    return { ledgerMajor: match.ledgerMajor, toolchain: match.version, language: match.language };
}
export function releaseLineFor(data, midnightJsVersion) {
    if (!midnightJsVersion)
        return null;
    const parsed = parseVersion(midnightJsVersion);
    if (!parsed)
        return null;
    const prefix = `${parsed.major}.${parsed.minor}`;
    return data.releaseLines.find((line) => line.match === prefix) ?? null;
}
export function ledgerMajorFromPackageName(name, data) {
    const ledger = /ledger-v(\d+)/.exec(name);
    if (ledger)
        return Number(ledger[1]);
    const runtime = /onchain-runtime-v(\d+)/.exec(name);
    if (runtime)
        return data.onchainRuntimeLedger[runtime[1]] ?? null;
    return null;
}
export function isMidnightPackage(name) {
    return name.startsWith('@midnight-ntwrk/') || name.startsWith('@midnightntwrk/');
}
export function isMidnightJsPackage(name) {
    return name === '@midnight-ntwrk/midnight-js' || name.startsWith('@midnight-ntwrk/midnight-js-');
}
export function isWalletBarrel(name) {
    return name === '@midnightntwrk/wallet-sdk' || name === '@midnight-ntwrk/wallet-sdk';
}
export function isWalletSubpackage(name) {
    return /@midnight-?ntwrk\/wallet-sdk-/.test(name);
}
export function combinationMessage(data, input) {
    const messages = [];
    for (const row of data.incompatibleCombinations) {
        const toolchainOk = !row.toolchain && !row.toolchains
            ? true
            : Boolean(input.toolchain &&
                (row.toolchain === input.toolchain || row.toolchains?.includes(input.toolchain)));
        const runtimeOk = !row.runtime && !row.runtimes
            ? true
            : Boolean(input.runtime && (row.runtime === input.runtime || row.runtimes?.includes(input.runtime)));
        const jsOk = !row.midnightJs ? true : Boolean(input.midnightJs && sameMinor(input.midnightJs, row.midnightJs));
        const constrained = Boolean(row.toolchain || row.toolchains || row.runtime || row.runtimes || row.midnightJs);
        if (constrained && toolchainOk && runtimeOk && jsOk) {
            if (row.toolchain || row.toolchains) {
                if (!input.toolchain)
                    continue;
            }
            if (row.runtime || row.runtimes) {
                if (!input.runtime)
                    continue;
            }
            messages.push(row.message);
        }
    }
    return messages;
}
