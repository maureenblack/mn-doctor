import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isMidnightPackage } from './compat.js';

export interface LockfileRead {
  path: string;
  versions: Record<string, { version: string; alternates: string[] }>;
  extraLockfiles: string[];
}

const CANDIDATES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock'];

function addVersion(
  map: Map<string, { top: string | null; others: Set<string> }>,
  name: string,
  version: string,
  top: boolean,
): void {
  if (!isMidnightPackage(name)) return;
  const current = map.get(name) ?? { top: null, others: new Set<string>() };
  if (top) current.top = version;
  else current.others.add(version);
  map.set(name, current);
}

function finalize(
  map: Map<string, { top: string | null; others: Set<string> }>,
): Record<string, { version: string; alternates: string[] }> {
  const versions: Record<string, { version: string; alternates: string[] }> = {};
  for (const [name, entry] of map) {
    const version = entry.top ?? [...entry.others][0] ?? null;
    if (!version) continue;
    const alternates = [...entry.others].filter((item) => item !== version);
    if (entry.top) {
      for (const item of entry.others) {
        if (item !== entry.top && !alternates.includes(item)) alternates.push(item);
      }
    }
    versions[name] = { version, alternates };
  }
  return versions;
}

function fromPackageLock(text: string): Record<string, { version: string; alternates: string[] }> {
  const json = JSON.parse(text) as {
    packages?: Record<string, { version?: string; name?: string }>;
  };
  const map = new Map<string, { top: string | null; others: Set<string> }>();
  for (const [key, value] of Object.entries(json.packages ?? {})) {
    if (!value?.version) continue;
    const name =
      value.name ??
      (key.includes('node_modules/') ? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length) : null);
    if (!name) continue;
    addVersion(map, name, value.version, key === `node_modules/${name}`);
  }
  return finalize(map);
}

const PACKAGE_AT_VERSION =
  /(@(?:midnight-ntwrk|midnightntwrk)\/[A-Za-z0-9._-]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/g;

function fromRegex(text: string): Record<string, { version: string; alternates: string[] }> {
  const map = new Map<string, { top: string | null; others: Set<string> }>();
  for (const match of text.matchAll(PACKAGE_AT_VERSION)) {
    addVersion(map, match[1], match[2], false);
  }
  return finalize(map);
}

function fromYarn(text: string): Record<string, { version: string; alternates: string[] }> {
  const map = new Map<string, { top: string | null; others: Set<string> }>();
  const block =
    /"?(@(?:midnight-ntwrk|midnightntwrk)\/[^@"\s]+)@[^"\n]*"?\s*:\n([\s\S]*?)(?=\n"|$)/g;
  for (const match of text.matchAll(block)) {
    const version = /version:?\s+"?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)"?/.exec(match[2]);
    if (version) addVersion(map, match[1], version[1], false);
  }
  if (map.size === 0) return fromRegex(text);
  return finalize(map);
}

function fromBun(text: string): Record<string, { version: string; alternates: string[] }> {
  try {
    const json = JSON.parse(text) as { packages?: Record<string, unknown> };
    const map = new Map<string, { top: string | null; others: Set<string> }>();
    for (const [name, value] of Object.entries(json.packages ?? {})) {
      if (!isMidnightPackage(name)) continue;
      const first = Array.isArray(value) ? value.find((item) => typeof item === 'string') : null;
      const version =
        typeof first === 'string'
          ? /@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/.exec(first)?.[1]
          : null;
      if (version) addVersion(map, name, version, true);
    }
    if (map.size > 0) return finalize(map);
  } catch {
    // bun.lock is sometimes not pure JSON; the regex path covers that.
  }
  return fromRegex(text);
}

export function readLockfile(root: string): LockfileRead | null {
  const present = CANDIDATES.filter((name) => existsSync(join(root, name)));
  if (present.length === 0) return null;
  const chosen = present[0];
  const path = join(root, chosen);
  const text = readFileSync(path, 'utf8');
  let versions: LockfileRead['versions'];
  if (chosen === 'package-lock.json' || chosen === 'npm-shrinkwrap.json') {
    versions = fromPackageLock(text);
  } else if (chosen === 'yarn.lock') {
    versions = fromYarn(text);
  } else if (chosen === 'bun.lock') {
    versions = fromBun(text);
  } else {
    versions = fromRegex(text);
  }
  return { path, versions, extraLockfiles: present.slice(1) };
}
