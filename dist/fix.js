import { relative } from 'node:path';
import { isMidnightJsPackage, isWalletBarrel, isWalletSubpackage, recommendedStack } from './compat.js';
import { unifiedDiff } from './diff.js';
import { exactFromRange, sameVersion } from './semver.js';
const PROOF_IMAGE = /((?:docker\.io\/)?midnightntwrk\/proof-server:)([^\s'"]+)/g;
function rel(root, path) {
    const value = relative(root, path);
    return value === '' ? path : value;
}
function replaceDep(source, name, version) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`("${escaped}"\\s*:\\s*")([^"]*)(")`, 'g');
    return source.replace(pattern, (full, open, current, close) => {
        if (/[:/]/.test(current) || current.startsWith('workspace:') || current.startsWith('catalog:')) {
            return full;
        }
        return `${open}${version}${close}`;
    });
}
function desiredVersion(name, snapshot, data) {
    const stack = recommendedStack(data);
    if (isWalletSubpackage(name) && !isWalletBarrel(name))
        return null;
    if (isMidnightJsPackage(name))
        return stack.midnightJs;
    if (name === '@midnight-ntwrk/testkit-js')
        return stack.testkitJs;
    if (name === '@midnight-ntwrk/compact-runtime')
        return stack.compactRuntime;
    if (name === '@midnight-ntwrk/compact-js')
        return stack.compactJs;
    if (name === '@midnight-ntwrk/platform-js')
        return stack.platformJs;
    if (name === '@midnight-ntwrk/dapp-connector-api')
        return stack.dappConnector;
    if (name === stack.onchainRuntime.name)
        return stack.onchainRuntime.version;
    if (name === stack.ledger.name) {
        const hasDapp = snapshot.manifests.some((manifest) => manifest.dependencies.some((dep) => isMidnightJsPackage(dep.name) ||
            dep.name === '@midnight-ntwrk/compact-runtime' ||
            dep.name === '@midnight-ntwrk/compact-js'));
        const hasWallet = snapshot.manifests.some((manifest) => manifest.dependencies.some((dep) => isWalletBarrel(dep.name)));
        if (hasWallet && !hasDapp && stack.ledger.walletOnlyVersion)
            return stack.ledger.walletOnlyVersion;
        return stack.ledger.version;
    }
    if (stack.walletSdk?.names.includes(name))
        return stack.walletSdk.version;
    if (stack.zkir?.name === name)
        return stack.zkir.version;
    return null;
}
function languageToken(language) {
    const parts = language.split('.');
    return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : language;
}
function packageManager(snapshot) {
    const path = snapshot.lockfile?.path ?? '';
    if (path.endsWith('pnpm-lock.yaml'))
        return 'pnpm';
    if (path.endsWith('yarn.lock'))
        return 'yarn';
    if (path.endsWith('bun.lock'))
        return 'bun';
    return 'npm';
}
function installCommand(manager, packages) {
    const list = packages.join(' ');
    if (manager === 'pnpm')
        return `pnpm add ${list}`;
    if (manager === 'yarn')
        return `yarn add ${list}`;
    if (manager === 'bun')
        return `bun add ${list}`;
    return `npm install ${list}`;
}
export function planFix(snapshot, data) {
    const stack = recommendedStack(data);
    const edits = [];
    const notes = [];
    const installSpecs = new Map();
    for (const manifest of snapshot.manifests) {
        let next = manifest.raw;
        for (const dep of manifest.dependencies) {
            const version = desiredVersion(dep.name, snapshot, data);
            if (!version) {
                if (dep.name.endsWith('wallet-sdk-facade')) {
                    notes.push(`${dep.name} stays at ${dep.range}. The docs-tested wallet package is the barrel ${stack.walletSdk?.names[0]}@${stack.walletSdk?.version}. Facade 3.x and that barrel are different generations, so this command does not rewrite the facade name.`);
                }
                continue;
            }
            const current = exactFromRange(dep.range);
            if (current && sameVersion(current, version))
                continue;
            if (dep.range === version)
                continue;
            const updated = replaceDep(next, dep.name, version);
            if (updated === next)
                continue;
            next = updated;
            installSpecs.set(dep.name, version);
        }
        if (next !== manifest.raw) {
            edits.push({
                path: manifest.path,
                before: manifest.raw,
                after: next.endsWith('\n') || !manifest.raw.endsWith('\n') ? next : `${next}\n`,
                diff: unifiedDiff(rel(snapshot.root, manifest.path), manifest.raw, next),
            });
        }
    }
    const compilerCommand = snapshot.compiler.toolchain && sameVersion(snapshot.compiler.toolchain, stack.toolchain)
        ? null
        : stack.install.compiler;
    const commands = [];
    if (compilerCommand)
        commands.push(compilerCommand);
    if (installSpecs.size > 0) {
        const specs = [...installSpecs.entries()].map(([name, version]) => `${name}@${version}`);
        commands.push(installCommand(packageManager(snapshot), specs));
    }
    if (compilerCommand) {
        notes.push(stack.install.note);
        notes.push('mn-doctor prints the compiler command and does not run it.');
    }
    if (installSpecs.size > 0) {
        notes.push('Review the diff, then run the package-manager command yourself so the lockfile updates.');
    }
    if (stack.ledger.note)
        notes.push(stack.ledger.note);
    return {
        stackId: stack.id,
        edits,
        commands,
        notes: [...new Set(notes)],
        compilerCommand,
    };
}
/** Second pass for Compact sources and compose files, which are not JSON manifests. */
export function planTextEdits(snapshot, data, files) {
    const stack = recommendedStack(data);
    const token = languageToken(stack.language);
    const edits = [];
    for (const file of files) {
        let next = file.raw;
        if (file.path.endsWith('.compact')) {
            next = next.replace(/pragma\s+language_version\s*(?:>=)?\s*\d+(?:\.\d+){0,2}/g, `pragma language_version ${token}`);
        }
        if (/proof-server:/.test(file.raw)) {
            next = next.replace(PROOF_IMAGE, `$1${stack.proofServer}`);
        }
        if (next !== file.raw) {
            edits.push({
                path: file.path,
                before: file.raw,
                after: next,
                diff: unifiedDiff(rel(snapshot.root, file.path), file.raw, next),
            });
        }
    }
    return edits;
}
