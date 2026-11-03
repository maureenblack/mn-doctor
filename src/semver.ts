/**
 * Small semver subset for Midnight package ranges.
 * Covers exact versions, caret, tilde, comparators, and x-ranges.
 */

export interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
  /** True when the source text omitted the patch number, e.g. "0.23". */
  partial: boolean;
}

const VERSION_RE =
  /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(input: string): Version | null {
  const match = input.trim().match(VERSION_RE);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
    prerelease: match[4] ?? null,
    partial: match[3] === undefined,
  };
}

export function formatVersion(version: Version): string {
  const core = `${version.major}.${version.minor}.${version.patch}`;
  return version.prerelease ? `${core}-${version.prerelease}` : core;
}

export function compareVersions(a: Version, b: Version): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  const left = a.prerelease.split('.');
  const right = b.prerelease.split('.');
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i];
    const r = right[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const lNum = /^\d+$/.test(l);
    const rNum = /^\d+$/.test(r);
    if (lNum && rNum) {
      const diff = Number(l) - Number(r);
      if (diff !== 0) return diff;
    } else if (lNum !== rNum) {
      return lNum ? -1 : 1;
    } else if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return 0;
}

export function sameVersion(a: string, b: string): boolean {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return a.trim() === b.trim();
  return compareVersions(left, right) === 0 && left.prerelease === right.prerelease;
}

/** Major.minor equality. A missing patch is treated as 0, so 0.23 matches 0.23.0. */
export function sameMinor(a: string, b: string): boolean {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return false;
  return left.major === right.major && left.minor === right.minor;
}

export function majorOf(input: string): number | null {
  return parseVersion(input)?.major ?? null;
}

export function gte(a: string, b: string): boolean {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return false;
  return compareVersions(left, right) >= 0;
}

interface Comparator {
  op: '=' | '<' | '<=' | '>' | '>=';
  version: Version;
}

type Range =
  | { kind: 'any' }
  | { kind: 'unparsed' }
  | { kind: 'comparators'; comparators: Comparator[] };

function bump(version: Version, part: 'major' | 'minor' | 'patch'): Version {
  if (part === 'major') {
    return { major: version.major + 1, minor: 0, patch: 0, prerelease: null, partial: false };
  }
  if (part === 'minor') {
    return {
      major: version.major,
      minor: version.minor + 1,
      patch: 0,
      prerelease: null,
      partial: false,
    };
  }
  return {
    major: version.major,
    minor: version.minor,
    patch: version.patch + 1,
    prerelease: null,
    partial: false,
  };
}

function expandCaret(version: Version): Comparator[] {
  const lower: Comparator = { op: '>=', version };
  let upper: Version;
  if (version.major > 0) upper = bump(version, 'major');
  else if (version.minor > 0) upper = bump(version, 'minor');
  else upper = bump(version, 'patch');
  return [lower, { op: '<', version: upper }];
}

function expandTilde(version: Version): Comparator[] {
  return [
    { op: '>=', version },
    { op: '<', version: bump(version, 'minor') },
  ];
}

function parseComparatorToken(token: string): Comparator[] | null {
  const trimmed = token.trim();
  if (!trimmed) return [];
  if (trimmed === '*' || trimmed === 'x' || trimmed === 'X' || trimmed === 'latest') {
    return null;
  }
  const operatorMatch = trimmed.match(/^(>=|<=|>|<|=|\^|~)?\s*v?(.+)$/);
  if (!operatorMatch) return null;
  const op = operatorMatch[1] ?? '=';
  const body = operatorMatch[2].trim();
  if (body === '*' || body.endsWith('.x') || body.endsWith('.X') || body === 'x') {
    const prefix = body.replace(/\.(x|X|\*)$/, '');
    const version = parseVersion(prefix.includes('.') ? `${prefix}.0` : `${prefix}.0.0`);
    if (!version) return null;
    if (!prefix.includes('.')) {
      return [
        { op: '>=', version: { ...version, minor: 0, patch: 0 } },
        { op: '<', version: bump({ ...version, minor: 0, patch: 0 }, 'major') },
      ];
    }
    return expandTilde({ ...version, prerelease: null, partial: false });
  }
  const version = parseVersion(body);
  if (!version) return null;
  if (op === '^') return expandCaret(version);
  if (op === '~') return expandTilde(version);
  if (op === '=' && version.partial) return expandTilde(version);
  return [{ op: op as Comparator['op'], version }];
}

function parseRange(range: string): Range {
  const trimmed = range.trim();
  if (!trimmed || trimmed === '*' || trimmed === 'latest' || trimmed === 'x') {
    return { kind: 'any' };
  }
  if (trimmed.includes('||') || /[:/]/.test(trimmed) || trimmed.startsWith('workspace:') || trimmed.startsWith('catalog:')) {
    return { kind: 'unparsed' };
  }
  const comparators: Comparator[] = [];
  for (const token of trimmed.split(/\s+/)) {
    const parsed = parseComparatorToken(token);
    if (parsed === null) return { kind: 'any' };
    comparators.push(...parsed);
  }
  if (comparators.length === 0) return { kind: 'unparsed' };
  return { kind: 'comparators', comparators };
}

function compareOp(op: Comparator['op'], version: Version, bound: Version): boolean {
  const diff = compareVersions(version, bound);
  if (op === '=') return diff === 0;
  if (op === '<') return diff < 0;
  if (op === '<=') return diff <= 0;
  if (op === '>') return diff > 0;
  return diff >= 0;
}

/**
 * npm rule: a prerelease version satisfies a range only when a comparator
 * shares its major.minor.patch and itself carries a prerelease, or the
 * range is that exact prerelease.
 */
function prereleaseAllowed(version: Version, comparators: Comparator[]): boolean {
  if (version.prerelease === null) return true;
  return comparators.some((comparator) => {
    const bound = comparator.version;
    return (
      bound.prerelease !== null &&
      bound.major === version.major &&
      bound.minor === version.minor &&
      bound.patch === version.patch
    );
  });
}

/** `true` / `false` when the range is understood, `null` when it is not. */
export function satisfies(range: string, version: string): boolean | null {
  const parsed = parseRange(range);
  if (parsed.kind === 'any') return true;
  if (parsed.kind === 'unparsed') return null;
  const actual = parseVersion(version);
  if (!actual) return null;
  if (!prereleaseAllowed(actual, parsed.comparators)) return false;
  return parsed.comparators.every((comparator) =>
    compareOp(comparator.op, actual, comparator.version),
  );
}

export function isExactRange(range: string): boolean {
  const match = range.trim().match(/^=?\s*v?(\d+\.\d+\.\d+)$/);
  if (!match) return false;
  const version = parseVersion(match[1]);
  return version !== null && version.prerelease === null;
}

export function exactFromRange(range: string): string | null {
  const match = range.trim().match(/^=?\s*v?(\d+\.\d+\.\d+)$/);
  if (!match) return null;
  const version = parseVersion(match[1]);
  return version && version.prerelease === null ? formatVersion(version) : null;
}

/** True when some other minor of the same shape can satisfy the range. */
export function canSelectDifferentMinor(range: string, pin: string): boolean | null {
  const base = parseVersion(pin);
  if (!base) return null;
  const up = formatVersion({
    ...base,
    minor: base.minor + 1,
    patch: 0,
    prerelease: null,
    partial: false,
  });
  const upResult = satisfies(range, up);
  if (upResult === null) return null;
  if (upResult) return true;
  if (base.minor === 0) return false;
  const down = formatVersion({
    ...base,
    minor: base.minor - 1,
    patch: 0,
    prerelease: null,
    partial: false,
  });
  return satisfies(range, down);
}

/**
 * Compiler/runtime compatibility. Before 1.0 every minor of compact-runtime
 * is breaking. The generated contract checks that minor.
 */
export function runtimeMatchesCompiler(expected: string, actual: string): boolean {
  const left = parseVersion(expected);
  const right = parseVersion(actual);
  if (!left || !right) return false;
  if (left.major === 0 || right.major === 0) {
    return left.major === right.major && left.minor === right.minor;
  }
  return left.major === right.major;
}
