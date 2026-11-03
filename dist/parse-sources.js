/** Parsers for the two official Midnight compatibility pages. */
function cleanCell(cell) {
    return cell
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/`/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function tableRows(section) {
    const rows = [];
    for (const line of section.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|'))
            continue;
        if (/^\|?\s*-+/.test(trimmed.replace(/\|/g, '')))
            continue;
        const cells = trimmed
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map(cleanCell);
        if (cells.every((cell) => /^-+$/.test(cell) || cell === ''))
            continue;
        if (cells[0]?.toLowerCase() === 'functional area' || cells[0]?.toLowerCase() === 'component')
            continue;
        rows.push(cells);
    }
    return rows;
}
function versionOf(cell) {
    if (!cell)
        return undefined;
    const match = cell.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?/);
    return match?.[0];
}
const DOCS_COMPONENTS = [
    [/node \(midnight\)/i, 'node'],
    [/compact devtools/i, 'devtools'],
    [/compact toolchain/i, 'toolchain'],
    [/compact runtime/i, 'runtime'],
    [/compact js/i, 'compactJs'],
    [/platform js/i, 'platformJs'],
    [/on-chain runtime/i, 'onchainRuntime'],
    [/wallet sdk/i, 'walletSdk'],
    [/midnight\.js/i, 'midnightJs'],
    [/testkit/i, 'testkit'],
    [/dapp connector/i, 'dappConnector'],
    [/indexer/i, 'indexer'],
    [/proof server/i, 'proofServer'],
];
export function parseDocsMatrix(markdown) {
    const networks = {};
    const parts = markdown.split(/^##\s+/m).slice(1);
    for (const part of parts) {
        const title = part.split('\n')[0] ?? '';
        const name = /preview/i.test(title) ? 'preview' : /preprod/i.test(title) ? 'preprod' : /mainnet/i.test(title) ? 'mainnet' : null;
        if (!name || /incompatible/i.test(title))
            continue;
        const network = {};
        for (const row of tableRows(part)) {
            const component = row[1] || row[0] || '';
            const versionCell = row[2] ?? '';
            const notes = row[3] ?? '';
            for (const [pattern, key] of DOCS_COMPONENTS) {
                if (!pattern.test(component))
                    continue;
                const version = versionOf(versionCell);
                if (version)
                    network[key] = version;
                if (key === 'indexer' && notes)
                    network.indexerNote = notes;
            }
        }
        networks[name] = network;
    }
    return { networks };
}
const SDK_STABLE = [
    [/compact compiler/i, 'compactc'],
    [/compact toolchain/i, 'devtools'],
    [/compact language/i, 'language'],
    [/compact-js/i, 'compactJs'],
    [/compact-runtime/i, 'runtime'],
    [/midnight-js/i, 'midnightJs'],
    [/wallet-sdk-facade/i, 'walletFacade'],
    [/dapp-connector-api/i, 'dappConnector'],
    [/ledger-v8/i, 'ledger'],
    [/platform-js/i, 'platformJs'],
];
export function parseSdkCompatibility(markdown) {
    const updated = /updated\s+(\d{4}-\d{2}-\d{2})/i.exec(markdown)?.[1] ?? null;
    const infrastructure = {};
    const stable = {};
    const infraHeading = markdown.split(/##\s+Infrastructure/i)[1]?.split(/##\s+/)[0] ?? '';
    for (const row of tableRows(infraHeading)) {
        const name = (row[0] ?? '').toLowerCase();
        const key = name.includes('node')
            ? 'node'
            : name.includes('proof')
                ? 'proofServer'
                : name.includes('indexer')
                    ? 'indexer'
                    : name.includes('on-chain') || name.includes('onchain')
                        ? 'onchainRuntime'
                        : name === 'ledger'
                            ? 'ledger'
                            : null;
        if (!key)
            continue;
        infrastructure[key] = {
            preview: versionOf(row[1]) ?? row[1],
            preprod: versionOf(row[2]) ?? row[2],
            mainnet: versionOf(row[3]) ?? row[3],
        };
    }
    const stableHeading = markdown.split(/###\s+Compatible version sets/i)[1]?.split(/###\s+/)[0] ?? '';
    for (const row of tableRows(stableHeading)) {
        const label = row[0] ?? '';
        const version = versionOf(row[1]);
        if (!version)
            continue;
        for (const [pattern, key] of SDK_STABLE) {
            if (pattern.test(label))
                stable[key] = version;
        }
    }
    return { updated, infrastructure, stable };
}
