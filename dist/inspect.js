import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isMidnightPackage } from './compat.js';
import { readLockfile } from './lockfile.js';
const IGNORE = new Set([
    'node_modules',
    'dist',
    '.git',
    'coverage',
    'build',
    'target',
    '.next',
    '.turbo',
    '.cache',
]);
const DEP_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
function walk(dir, depth, acc) {
    if (depth > 8 || acc.length > 4000)
        return;
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (IGNORE.has(entry.name))
            continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory())
            walk(path, depth + 1, acc);
        else if (entry.isFile())
            acc.push(path);
    }
}
function depsFromManifest(path, raw) {
    let json;
    try {
        json = JSON.parse(raw);
    }
    catch (error) {
        return { manifest: null, error: error instanceof Error ? error.message : 'invalid JSON' };
    }
    const dependencies = [];
    for (const section of DEP_SECTIONS) {
        const block = json[section];
        if (!block || typeof block !== 'object')
            continue;
        for (const [name, range] of Object.entries(block)) {
            if (typeof range !== 'string' || !isMidnightPackage(name))
                continue;
            dependencies.push({ name, range, section, manifest: path });
        }
    }
    return { manifest: { path, raw, dependencies } };
}
function workspaceManifests(root, raw) {
    let json;
    try {
        json = JSON.parse(raw);
    }
    catch {
        return [];
    }
    const patterns = Array.isArray(json.workspaces) ? json.workspaces : json.workspaces?.packages ?? [];
    const paths = [];
    for (const pattern of patterns) {
        if (pattern.includes('*')) {
            const parent = join(root, pattern.replace(/\/?\*.*$/, ''));
            if (!existsSync(parent))
                continue;
            for (const entry of readdirSync(parent, { withFileTypes: true })) {
                if (!entry.isDirectory() || IGNORE.has(entry.name))
                    continue;
                const manifest = join(parent, entry.name, 'package.json');
                if (existsSync(manifest))
                    paths.push(manifest);
            }
        }
        else {
            const manifest = join(root, pattern, 'package.json');
            if (existsSync(manifest))
                paths.push(manifest);
        }
    }
    return paths;
}
const PRAGMA_RE = /pragma\s+language_version\s*(>=)?\s*(\d+(?:\.\d+){0,2})/g;
const PROOF_RE = /(?:docker\.io\/)?midnightntwrk\/proof-server:([^\s'"]+)/g;
function rel(root, path) {
    const value = relative(root, path);
    return value === '' ? '.' : value;
}
export function inspectProject(root, compiler) {
    const manifests = [];
    let packageJsonError;
    const rootManifestPath = join(root, 'package.json');
    if (existsSync(rootManifestPath)) {
        const raw = readFileSync(rootManifestPath, 'utf8');
        const parsed = depsFromManifest(rootManifestPath, raw);
        if (parsed.manifest)
            manifests.push(parsed.manifest);
        if (parsed.error)
            packageJsonError = parsed.error;
        if (parsed.manifest) {
            for (const extra of workspaceManifests(root, raw)) {
                const extraRaw = readFileSync(extra, 'utf8');
                const extraParsed = depsFromManifest(extra, extraRaw);
                if (extraParsed.manifest)
                    manifests.push(extraParsed.manifest);
            }
        }
    }
    const files = [];
    walk(root, 0, files);
    const pragmas = [];
    const proofServers = [];
    let compactFileCount = 0;
    for (const file of files) {
        let size = 0;
        try {
            size = statSync(file).size;
        }
        catch {
            continue;
        }
        if (size > 1_000_000)
            continue;
        if (file.endsWith('.compact')) {
            compactFileCount += 1;
            const text = readFileSync(file, 'utf8');
            const lines = text.split(/\r?\n/);
            lines.forEach((line, index) => {
                for (const match of line.matchAll(PRAGMA_RE)) {
                    pragmas.push({
                        file: rel(root, file),
                        version: match[2],
                        minimum: Boolean(match[1]),
                        line: index + 1,
                    });
                }
            });
        }
        const base = file.slice(file.lastIndexOf('/') + 1);
        const interesting = /\.compact$/.test(file) ||
            /\.(ya?ml|env)$/.test(base) ||
            base === 'Dockerfile' ||
            base.startsWith('docker-compose') ||
            base.startsWith('compose.');
        if (!interesting)
            continue;
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(PROOF_RE)) {
            proofServers.push({
                file: rel(root, file),
                image: 'midnightntwrk/proof-server',
                tag: match[1].replace(/[",}]+$/, ''),
            });
        }
    }
    return {
        root,
        manifests,
        packageJsonError,
        lockfile: readLockfile(root),
        pragmas,
        proofServers,
        compiler,
        compactFileCount,
    };
}
