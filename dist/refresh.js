function setDisagreement(rows, id, component, docs, sdk) {
    const existing = rows.find((row) => row.id === id);
    if (existing?.editorial)
        return;
    if (docs === sdk) {
        const index = rows.findIndex((row) => row.id === id);
        if (index >= 0)
            rows.splice(index, 1);
        return;
    }
    if (existing) {
        existing.docs = docs;
        existing.sdk = sdk;
        existing.component = component;
        return;
    }
    rows.push({
        id,
        component,
        docs,
        sdk,
        detail: 'The docs support matrix and midnight-sdk COMPATIBILITY.md list different versions.',
    });
}
export function mergeFetched(current, docs, sdk, fetchedAt) {
    const next = structuredClone(current);
    next.generatedAt = fetchedAt;
    for (const source of next.sources) {
        if (source.id === 'docs-support-matrix' || source.id === 'sdk-compatibility') {
            source.fetchedAt = fetchedAt;
        }
        if (source.id === 'sdk-compatibility' && sdk.updated)
            source.statedUpdated = sdk.updated;
    }
    for (const [name, parsed] of Object.entries(docs.networks)) {
        const network = next.networks[name];
        if (!network)
            continue;
        if (parsed.node)
            network.docs.node = parsed.node;
        if (parsed.indexer)
            network.docs.indexer = parsed.indexer;
        if (parsed.proofServer)
            network.docs.proofServer = parsed.proofServer;
        if (parsed.indexerNote)
            network.docs.indexerNote = parsed.indexerNote;
    }
    for (const [name, network] of Object.entries(next.networks)) {
        const infra = sdk.infrastructure;
        if (infra.node?.[name])
            network.sdk.node = infra.node[name] ?? network.sdk.node;
        if (infra.indexer?.[name]) {
            network.sdk.indexer = infra.indexer[name] ?? network.sdk.indexer;
        }
        if (infra.proofServer?.[name]) {
            network.sdk.proofServer = infra.proofServer[name] ?? network.sdk.proofServer;
        }
    }
    const preview = docs.networks.preview ?? docs.networks.mainnet ?? {};
    const recommended = next.stacks.find((stack) => stack.recommended);
    if (recommended) {
        if (preview.devtools)
            recommended.devtools = preview.devtools;
        if (preview.toolchain) {
            recommended.toolchain = preview.toolchain;
            recommended.install.compiler = `compact update ${preview.toolchain}`;
        }
        if (preview.runtime)
            recommended.compactRuntime = preview.runtime;
        if (preview.compactJs)
            recommended.compactJs = preview.compactJs;
        if (preview.platformJs)
            recommended.platformJs = preview.platformJs;
        if (preview.midnightJs)
            recommended.midnightJs = preview.midnightJs;
        if (preview.testkit)
            recommended.testkitJs = preview.testkit;
        if (preview.dappConnector)
            recommended.dappConnector = preview.dappConnector;
        if (preview.onchainRuntime)
            recommended.onchainRuntime.version = preview.onchainRuntime;
        if (preview.walletSdk && recommended.walletSdk)
            recommended.walletSdk.version = preview.walletSdk;
        if (preview.proofServer)
            recommended.proofServer = preview.proofServer;
    }
    const older = next.stacks.find((stack) => !stack.recommended);
    if (older) {
        if (sdk.stable.devtools)
            older.devtools = sdk.stable.devtools;
        if (sdk.stable.compactc)
            older.toolchain = sdk.stable.compactc;
        if (sdk.stable.language)
            older.language = sdk.stable.language;
        if (sdk.stable.runtime)
            older.compactRuntime = sdk.stable.runtime;
        if (sdk.stable.compactJs)
            older.compactJs = sdk.stable.compactJs;
        if (sdk.stable.platformJs)
            older.platformJs = sdk.stable.platformJs;
        if (sdk.stable.midnightJs)
            older.midnightJs = sdk.stable.midnightJs;
        if (sdk.stable.dappConnector)
            older.dappConnector = sdk.stable.dappConnector;
        if (sdk.stable.ledger)
            older.ledger.version = sdk.stable.ledger;
        if (sdk.stable.walletFacade && older.walletFacade)
            older.walletFacade.version = sdk.stable.walletFacade;
        const proof = sdk.infrastructure.proofServer?.mainnet;
        if (proof)
            older.proofServer = proof;
        if (sdk.updated)
            older.label = `midnight-sdk COMPATIBILITY.md (updated ${sdk.updated})`;
    }
    const main = docs.networks.mainnet ?? {};
    const joinNet = (pick) => ['preview', 'preprod', 'mainnet']
        .map((name) => {
        const value = pick(name);
        return value ? `${name} ${value}` : null;
    })
        .filter((value) => Boolean(value))
        .join(', ');
    setDisagreement(next.disagreements, 'toolchain', 'Compact compiler', main.toolchain ?? preview.toolchain ?? '', sdk.stable.compactc ?? '');
    setDisagreement(next.disagreements, 'compact-runtime', 'Compact runtime', preview.runtime ?? '', sdk.stable.runtime ?? '');
    setDisagreement(next.disagreements, 'compact-js', 'Compact JS', preview.compactJs ?? '', sdk.stable.compactJs ?? '');
    setDisagreement(next.disagreements, 'midnight-js', 'Midnight.js', preview.midnightJs ?? '', sdk.stable.midnightJs ?? '');
    setDisagreement(next.disagreements, 'proof-server', 'Proof server', preview.proofServer ?? '', sdk.infrastructure.proofServer?.mainnet ?? '');
    setDisagreement(next.disagreements, 'node', 'Node', joinNet((name) => docs.networks[name]?.node), joinNet((name) => sdk.infrastructure.node?.[name]));
    setDisagreement(next.disagreements, 'indexer', 'Indexer', joinNet((name) => docs.networks[name]?.indexer), sdk.infrastructure.indexer?.mainnet ?? '');
    next.agreements = next.agreements.map((row) => {
        if (row.component === 'Compact devtools' && preview.devtools && sdk.stable.devtools && preview.devtools === sdk.stable.devtools) {
            return { ...row, version: preview.devtools };
        }
        if (row.component === 'Platform JS' && preview.platformJs && preview.platformJs === sdk.stable.platformJs) {
            return { ...row, version: preview.platformJs };
        }
        if (row.component === 'DApp Connector API' && preview.dappConnector && preview.dappConnector === sdk.stable.dappConnector) {
            return { ...row, version: preview.dappConnector };
        }
        return row;
    });
    return next;
}
