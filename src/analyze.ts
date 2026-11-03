import { relative } from 'node:path';

import {
  combinationMessage,
  isMidnightJsPackage,
  isWalletBarrel,
  isWalletSubpackage,
  ledgerForLanguage,
  ledgerForRuntime,
  ledgerMajorFromPackageName,
  olderStacks,
  recommendedStack,
  releaseLineFor,
  describeToolchain,
} from './compat.js';
import {
  canSelectDifferentMinor,
  exactFromRange,
  isExactRange,
  majorOf,
  runtimeMatchesCompiler,
  sameMinor,
  sameVersion,
  satisfies,
} from './semver.js';
import type {
  CompatData,
  ComponentReport,
  Finding,
  FoundDep,
  ProjectSnapshot,
  Report,
  Severity,
  Stack,
} from './types.js';

export interface AnalyzeOptions {
  network: string;
  networkLedgerMajor: number;
  aliasOf?: string;
  strict?: boolean;
  toolVersion: string;
}

function rel(root: string, path: string | undefined): string | undefined {
  if (!path) return undefined;
  const value = relative(root, path);
  return value === '' ? path : value;
}

function collectDeps(snapshot: ProjectSnapshot): FoundDep[] {
  const byName = new Map<string, FoundDep>();
  for (const manifest of snapshot.manifests) {
    for (const dep of manifest.dependencies) {
      const locked = snapshot.lockfile?.versions[dep.name];
      const current = byName.get(dep.name) ?? {
        name: dep.name,
        ranges: [],
        manifests: [],
        resolved: locked?.version ?? null,
        alternates: locked?.alternates ?? [],
      };
      current.ranges.push(dep.range);
      current.manifests.push(dep.manifest);
      byName.set(dep.name, current);
    }
  }
  for (const [name, locked] of Object.entries(snapshot.lockfile?.versions ?? {})) {
    if (byName.has(name)) continue;
    byName.set(name, {
      name,
      ranges: [],
      manifests: [],
      resolved: locked.version,
      alternates: locked.alternates,
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function concrete(dep: FoundDep | undefined): string | null {
  if (!dep) return null;
  if (dep.resolved) return dep.resolved;
  for (const range of dep.ranges) {
    const exact = exactFromRange(range);
    if (exact) return exact;
  }
  return null;
}

function primaryRange(dep: FoundDep | undefined): string | null {
  return dep?.ranges[0] ?? null;
}

function depByName(deps: FoundDep[], name: string): FoundDep | undefined {
  return deps.find((dep) => dep.name === name);
}

interface Signal {
  id: string;
  actual: string | null;
  expected: string;
}

function stackAgrees(signals: Signal[], stack: Stack, read: (stack: Stack, id: string) => string | undefined): boolean | null {
  let compared = 0;
  for (const signal of signals) {
    if (signal.actual === null) continue;
    const expected = read(stack, signal.id);
    if (!expected) continue;
    compared += 1;
    if (!sameVersion(signal.actual, expected)) return false;
  }
  return compared === 0 ? null : true;
}

function readStack(stack: Stack, id: string): string | undefined {
  switch (id) {
    case 'devtools':
      return stack.devtools;
    case 'compiler':
      return stack.toolchain;
    case 'language':
      return stack.language;
    case 'runtime':
      return stack.compactRuntime;
    case 'compact-js':
      return stack.compactJs;
    case 'platform-js':
      return stack.platformJs;
    case 'midnight-js':
      return stack.midnightJs;
    case 'testkit':
      return stack.testkitJs;
    case 'dapp-connector':
      return stack.dappConnector;
    case 'onchain-runtime':
      return stack.onchainRuntime.version;
    case 'ledger':
      return stack.ledger.version;
    case 'proof-server':
      return stack.proofServer;
    case 'wallet':
      return stack.walletSdk?.version;
    case 'wallet-facade':
      return stack.walletFacade?.version;
    case 'zkir':
      return stack.zkir?.version;
    default:
      return undefined;
  }
}

export function analyze(snapshot: ProjectSnapshot, data: CompatData, options: AnalyzeOptions): Report {
  const recommended = recommendedStack(data);
  const findings: Finding[] = [];
  const components: ComponentReport[] = [];
  const push = (finding: Finding): void => {
    findings.push(finding);
  };
  const component = (row: ComponentReport): void => {
    components.push(row);
  };

  if (snapshot.packageJsonError) {
    push({
      severity: 'error',
      code: 'package-json-invalid',
      component: 'package.json',
      message: `package.json could not be parsed (${snapshot.packageJsonError}).`,
    });
  }
  if (snapshot.lockfile && snapshot.lockfile.extraLockfiles.length > 0) {
    push({
      severity: 'info',
      code: 'multiple-lockfiles',
      component: 'lockfile',
      message: `Read ${rel(snapshot.root, snapshot.lockfile.path)}. Also found ${snapshot.lockfile.extraLockfiles.join(', ')}.`,
    });
  }
  if (options.aliasOf) {
    push({
      severity: 'info',
      code: 'network-alias',
      component: 'network',
      message: `Network "${options.aliasOf}" uses the ${options.network} ledger ${options.networkLedgerMajor} profile. The current docs name the public networks preview, preprod, and mainnet.`,
    });
  }

  const deps = collectDeps(snapshot);
  const runtimeDep = depByName(deps, '@midnight-ntwrk/compact-runtime');
  const runtimeVersion = concrete(runtimeDep);
  const jsDeps = deps.filter((dep) => isMidnightJsPackage(dep.name));
  const jsVersions = [
    ...new Set(
      jsDeps
        .map((dep) => concrete(dep))
        .filter((version): version is string => Boolean(version)),
    ),
  ];
  if (jsVersions.length > 1) {
    const detail = jsDeps
      .map((dep) => `${dep.name} ${concrete(dep) ?? primaryRange(dep) ?? 'unresolved'}`)
      .join('; ');
    push({
      severity: 'error',
      code: 'midnight-js-skew',
      component: 'midnight-js',
      message: `Midnight.js packages are on different versions (${detail}). They are published together. Install the same version on every @midnight-ntwrk/midnight-js* package.`,
    });
  }
  const midnightJs = concrete(depByName(deps, '@midnight-ntwrk/midnight-js')) ?? jsVersions[0] ?? null;
  const releaseLine = releaseLineFor(data, midnightJs);

  const toolchain = snapshot.compiler.toolchain
    ? describeToolchain(data, snapshot.compiler.toolchain, {
        ledgerVersion: snapshot.compiler.ledgerVersion,
        runtimeVersion: snapshot.compiler.runtimeVersion,
        languageVersion: snapshot.compiler.languageVersion,
      })
    : null;
  const expectedRuntime = toolchain?.runtime ?? null;

  if (snapshot.compiler.devtools) {
    const matches = sameVersion(snapshot.compiler.devtools, recommended.devtools);
    component({
      id: 'devtools',
      label: 'Compact devtools',
      version: snapshot.compiler.devtools,
      range: null,
      ledgerMajor: null,
      status: matches ? 'ok' : 'warning',
      detail: matches
        ? 'Matches the tested compact CLI.'
        : `Tested devtools version is ${recommended.devtools}.`,
    });
    if (!matches) {
      push({
        severity: 'warning',
        code: 'devtools-version',
        component: 'devtools',
        message: `Compact devtools are ${snapshot.compiler.devtools}. The tested CLI is ${recommended.devtools}. Update with \`compact self update\` when you want that CLI; mn-doctor does not run it.`,
        found: snapshot.compiler.devtools,
        expected: recommended.devtools,
        strictUpgrade: true,
      });
    }
  } else if (snapshot.compactFileCount > 0) {
    component({
      id: 'devtools',
      label: 'Compact devtools',
      version: null,
      range: null,
      ledgerMajor: null,
      status: 'missing',
      detail: 'compact --version did not report a devtools version.',
    });
  }

  if (toolchain) {
    const ledgerConflict = toolchain.ledgerMajor !== options.networkLedgerMajor;
    component({
      id: 'compiler',
      label: 'Compact compiler',
      version: toolchain.version,
      range: null,
      ledgerMajor: toolchain.ledgerMajor,
      status: ledgerConflict ? 'conflict' : 'ok',
      detail: `Targets ledger ${toolchain.ledgerMajor}. Language ${toolchain.language ?? 'unknown'}, runtime ${expectedRuntime ?? 'unknown'}.`,
    });
  } else if (snapshot.compactFileCount > 0) {
    component({
      id: 'compiler',
      label: 'Compact compiler',
      version: null,
      range: null,
      ledgerMajor: null,
      status: 'missing',
      detail: 'compactc was not found. Pass --compact-version or install the compiler.',
    });
    push({
      severity: 'warning',
      code: 'compiler-not-found',
      component: 'compiler',
      message: `This project has ${snapshot.compactFileCount} Compact file(s), and no compiler version was found. The tested pin for ${options.network} is \`${recommended.install.compiler}\`.`,
      expected: recommended.toolchain,
      strictUpgrade: true,
    });
  }

  const hints = combinationMessage(data, {
    toolchain: toolchain?.version ?? null,
    runtime: runtimeVersion,
    midnightJs,
  });

  if (toolchain && expectedRuntime && runtimeVersion && !runtimeMatchesCompiler(expectedRuntime, runtimeVersion)) {
    const runtimeLedger = ledgerForRuntime(data, runtimeVersion);
    push({
      severity: 'error',
      code: 'compiler-runtime-mismatch',
      component: 'compiler',
      message: [
        `Compact compiler ${toolchain.version} generates contracts for compact-runtime ${expectedRuntime} (ledger ${toolchain.ledgerMajor}).`,
        `This project has compact-runtime ${runtimeVersion}${runtimeLedger ? ` (ledger ${runtimeLedger})` : ''}.`,
        ...hints,
        `${options.network} runs ledger ${options.networkLedgerMajor}. Pin the compiler with \`${recommended.install.compiler}\` and install \`@midnight-ntwrk/compact-runtime@${recommended.compactRuntime}\`.`,
        recommended.install.note,
      ].join(' '),
      found: `${toolchain.version} / runtime ${runtimeVersion}`,
      expected: `${recommended.toolchain} / runtime ${recommended.compactRuntime}`,
      ledgerMajor: toolchain.ledgerMajor,
    });
  } else if (toolchain && toolchain.ledgerMajor !== options.networkLedgerMajor) {
    push({
      severity: 'error',
      code: 'compiler-ledger-mismatch',
      component: 'compiler',
      message: [
        `Compact compiler ${toolchain.version} targets ledger ${toolchain.ledgerMajor}.`,
        `${options.network} runs ledger ${options.networkLedgerMajor}.`,
        ...hints,
        `Pin the compiler with \`${recommended.install.compiler}\`. ${recommended.install.note}`,
      ].join(' '),
      found: toolchain.version,
      expected: recommended.toolchain,
      ledgerMajor: toolchain.ledgerMajor,
    });
  }

  if (runtimeDep || runtimeVersion) {
    const runtimeLedger = runtimeVersion ? ledgerForRuntime(data, runtimeVersion) : null;
    const conflict = runtimeLedger !== null && runtimeLedger !== options.networkLedgerMajor;
    component({
      id: 'runtime',
      label: '@midnight-ntwrk/compact-runtime',
      version: runtimeVersion,
      range: primaryRange(runtimeDep),
      ledgerMajor: runtimeLedger,
      status: conflict ? 'conflict' : 'ok',
      detail: runtimeVersion
        ? `Ledger ${runtimeLedger ?? 'unknown'}.`
        : `Range ${primaryRange(runtimeDep) ?? 'unknown'} is not locked to one version.`,
      file: rel(snapshot.root, runtimeDep?.manifests[0]),
    });
    if (conflict && !findings.some((finding) => finding.code === 'compiler-runtime-mismatch')) {
      push({
        severity: 'error',
        code: 'runtime-ledger-mismatch',
        component: 'runtime',
        message: [
          `@midnight-ntwrk/compact-runtime ${runtimeVersion} targets ledger ${runtimeLedger}.`,
          `${options.network} runs ledger ${options.networkLedgerMajor}.`,
          ...hints,
          `Install \`@midnight-ntwrk/compact-runtime@${recommended.compactRuntime}\`.`,
        ].join(' '),
        found: runtimeVersion ?? undefined,
        expected: recommended.compactRuntime,
        ledgerMajor: runtimeLedger,
      });
    }
  }

  for (const dep of deps) {
    if (dep.alternates.length > 0) {
      push({
        severity: 'warning',
        code: 'duplicate-resolutions',
        component: dep.name,
        message: `${dep.name} resolved to ${dep.resolved}, and the lockfile also contains ${dep.alternates.join(', ')}.`,
        found: [dep.resolved, ...dep.alternates].filter(Boolean).join(', '),
        strictUpgrade: true,
      });
    }
  }

  const pragmaLedgers = snapshot.pragmas.map((pragma) => ({
    pragma,
    info: ledgerForLanguage(data, pragma.version),
  }));
  const pragmaKeys = new Set(snapshot.pragmas.map((pragma) => {
    const parsed = pragma.version.split('.');
    return `${parsed[0]}.${parsed[1] ?? '0'}`;
  }));
  if (pragmaKeys.size > 1) {
    push({
      severity: 'error',
      code: 'pragma-disagree',
      component: 'pragma',
      message: `Compact files request more than one language version (${[...pragmaKeys].join(', ')}). Pick one compiler line for the whole project.`,
    });
  }
  for (const { pragma, info } of pragmaLedgers) {
    const compilerLanguage = toolchain?.language;
    const mismatchesCompiler =
      compilerLanguage !== null &&
      compilerLanguage !== undefined &&
      !pragma.minimum &&
      !sameMinor(pragma.version, compilerLanguage);
    const mismatchesNetwork = info !== null && info.ledgerMajor !== options.networkLedgerMajor;
    component({
      id: `pragma:${pragma.file}:${pragma.line}`,
      label: 'Language pragma',
      version: pragma.version,
      range: null,
      ledgerMajor: info?.ledgerMajor ?? null,
      status: mismatchesCompiler || mismatchesNetwork ? 'conflict' : 'ok',
      detail: info
        ? `${pragma.file}:${pragma.line} · language ${info.language} · ledger ${info.ledgerMajor}`
        : `${pragma.file}:${pragma.line}`,
      file: pragma.file,
    });
    if (mismatchesCompiler) {
      push({
        severity: 'error',
        code: 'pragma-compiler-mismatch',
        component: 'pragma',
        file: pragma.file,
        message: `${pragma.file}:${pragma.line} requests language ${pragma.version}. Compiler ${toolchain?.version} supports language ${compilerLanguage}. ${info && mismatchesNetwork ? `Language ${pragma.version} targets ledger ${info.ledgerMajor}, and ${options.network} runs ledger ${options.networkLedgerMajor}. ` : ''}Use \`${recommended.install.compiler}\` and \`pragma language_version ${recommended.language.split('.').slice(0, 2).join('.')};\`.`,
        found: pragma.version,
        expected: compilerLanguage ?? undefined,
        ledgerMajor: info?.ledgerMajor ?? null,
      });
    } else if (mismatchesNetwork && info) {
      push({
        severity: 'error',
        code: 'pragma-ledger-mismatch',
        component: 'pragma',
        file: pragma.file,
        message: `${pragma.file}:${pragma.line} requests language ${pragma.version}, which toolchain ${info.toolchain} compiles for ledger ${info.ledgerMajor}. ${options.network} runs ledger ${options.networkLedgerMajor}. The tested language is ${recommended.language}.`,
        found: pragma.version,
        expected: recommended.language,
        ledgerMajor: info.ledgerMajor,
      });
    }
  }

  for (const hit of snapshot.proofServers) {
    const tagMajor = majorOf(hit.tag);
    const unpinned = hit.tag === 'latest' || hit.tag === 'stable';
    const ledgerConflict = tagMajor !== null && tagMajor !== options.networkLedgerMajor;
    component({
      id: `proof:${hit.file}`,
      label: 'Proof server',
      version: hit.tag,
      range: null,
      ledgerMajor: tagMajor,
      status: unpinned || ledgerConflict ? 'conflict' : 'ok',
      detail: `${hit.file} · ${hit.image}:${hit.tag}`,
      file: hit.file,
    });
    if (unpinned) {
      push({
        severity: 'error',
        code: 'proof-server-unpinned',
        component: 'proof-server',
        file: hit.file,
        message: `${hit.file} uses ${hit.image}:${hit.tag}. A floating tag can move onto another ledger. The tested image is ${hit.image}:${recommended.proofServer}.`,
        found: hit.tag,
        expected: recommended.proofServer,
      });
    } else if (ledgerConflict) {
      push({
        severity: 'error',
        code: 'proof-server-ledger-mismatch',
        component: 'proof-server',
        file: hit.file,
        message: `${hit.file} uses ${hit.image}:${hit.tag}, which tracks ledger ${tagMajor}. ${options.network} runs ledger ${options.networkLedgerMajor}. The tested image is ${hit.image}:${recommended.proofServer}.`,
        found: hit.tag,
        expected: recommended.proofServer,
        ledgerMajor: tagMajor,
      });
    } else if (tagMajor !== null && !sameVersion(hit.tag, recommended.proofServer)) {
      push({
        severity: 'warning',
        code: 'proof-server-patch',
        component: 'proof-server',
        file: hit.file,
        message: `${hit.file} uses ${hit.image}:${hit.tag}. That tag is ledger ${tagMajor}, the same major ${options.network} runs. The tested image is ${hit.image}:${recommended.proofServer}.`,
        found: hit.tag,
        expected: recommended.proofServer,
        ledgerMajor: tagMajor,
        strictUpgrade: true,
      });
    }
  }

  const expectedByPackage = new Map<string, { version: string; exact: boolean; source: string }>();
  const remember = (name: string, version: string, exact: boolean, source: string): void => {
    expectedByPackage.set(name, { version, exact, source });
  };
  if (releaseLine) {
    for (const [name, version] of Object.entries(releaseLine.packages)) {
      remember(name, version, true, releaseLine.source);
    }
  }
  remember('@midnight-ntwrk/compact-runtime', releaseLine?.packages['@midnight-ntwrk/compact-runtime'] ?? recommended.compactRuntime, true, releaseLine?.source ?? recommended.label);
  remember('@midnight-ntwrk/compact-js', releaseLine?.packages['@midnight-ntwrk/compact-js'] ?? recommended.compactJs, true, releaseLine?.source ?? recommended.label);
  remember('@midnight-ntwrk/platform-js', releaseLine?.packages['@midnight-ntwrk/platform-js'] ?? recommended.platformJs, Boolean(releaseLine?.packages['@midnight-ntwrk/platform-js']), recommended.label);
  remember('@midnight-ntwrk/testkit-js', recommended.testkitJs, false, recommended.label);
  remember('@midnight-ntwrk/dapp-connector-api', recommended.dappConnector, false, recommended.label);
  remember(recommended.onchainRuntime.name, releaseLine?.packages[recommended.onchainRuntime.name] ?? recommended.onchainRuntime.version, Boolean(releaseLine?.packages[recommended.onchainRuntime.name]), releaseLine?.source ?? recommended.label);
  const ledgerExpected =
    releaseLine?.packages[recommended.ledger.name] ??
    (deps.some((dep) => isWalletBarrel(dep.name)) && !midnightJs && recommended.ledger.walletOnlyVersion
      ? recommended.ledger.walletOnlyVersion
      : recommended.ledger.version);
  remember(
    recommended.ledger.name,
    ledgerExpected,
    Boolean(releaseLine?.packages[recommended.ledger.name]),
    releaseLine?.source ?? recommended.ledger.note ?? recommended.label,
  );
  if (recommended.walletSdk) {
    for (const name of recommended.walletSdk.names) {
      remember(name, recommended.walletSdk.version, false, recommended.label);
    }
  }
  if (recommended.zkir) remember(recommended.zkir.name, recommended.zkir.version, false, recommended.label);
  for (const dep of jsDeps) {
    remember(dep.name, releaseLine?.packages[dep.name] ?? recommended.midnightJs, Boolean(midnightJs), recommended.label);
  }

  const skipPin = new Set(['@midnight-ntwrk/compact-runtime']);
  for (const dep of deps) {
    if (isWalletSubpackage(dep.name) && !isWalletBarrel(dep.name)) {
      component({
        id: `dep:${dep.name}`,
        label: dep.name,
        version: concrete(dep),
        range: primaryRange(dep),
        ledgerMajor: ledgerMajorFromPackageName(dep.name, data),
        status: 'info',
        detail: 'Wallet sub-package versions follow their own line. Install the barrel @midnightntwrk/wallet-sdk when you want the tested set.',
        file: rel(snapshot.root, dep.manifests[0]),
      });
      continue;
    }
    const namedLedger = ledgerMajorFromPackageName(dep.name, data);
    if (namedLedger !== null && namedLedger !== options.networkLedgerMajor) {
      component({
        id: `dep:${dep.name}`,
        label: dep.name,
        version: concrete(dep),
        range: primaryRange(dep),
        ledgerMajor: namedLedger,
        status: 'conflict',
        detail: `Package name targets ledger ${namedLedger}.`,
        file: rel(snapshot.root, dep.manifests[0]),
      });
      push({
        severity: 'error',
        code: 'package-ledger-mismatch',
        component: dep.name,
        message: `${dep.name} targets ledger ${namedLedger}. ${options.network} runs ledger ${options.networkLedgerMajor}.`,
        found: concrete(dep) ?? primaryRange(dep) ?? undefined,
        ledgerMajor: namedLedger,
        file: rel(snapshot.root, dep.manifests[0]),
      });
      continue;
    }
    if (skipPin.has(dep.name)) continue;
    if (isMidnightJsPackage(dep.name)) {
      const skewed = findings.some((finding) => finding.code === 'midnight-js-skew');
      component({
        id: `dep:${dep.name}`,
        label: dep.name,
        version: concrete(dep),
        range: primaryRange(dep),
        ledgerMajor: null,
        status: skewed ? 'conflict' : 'ok',
        detail: skewed
          ? 'Version disagrees with another Midnight.js package.'
          : `Midnight.js line ${midnightJs ?? 'unknown'}.`,
        file: rel(snapshot.root, dep.manifests[0]),
      });
      continue;
    }
    const expected = expectedByPackage.get(dep.name);
    if (!expected) {
      if (dep.name.startsWith('@midnight')) {
        component({
          id: `dep:${dep.name}`,
          label: dep.name,
          version: concrete(dep),
          range: primaryRange(dep),
          ledgerMajor: namedLedger,
          status: 'info',
          detail: 'No tested pin in the shipped compatibility data.',
          file: rel(snapshot.root, dep.manifests[0]),
        });
      }
      continue;
    }
    judgePin(dep, expected, snapshot, options, data, push, component);
  }

  if (runtimeDep) {
    const expected = expectedByPackage.get(runtimeDep.name);
    if (expected) {
      const already = findings.some((finding) =>
        ['compiler-runtime-mismatch', 'runtime-ledger-mismatch', 'floating-range'].includes(finding.code),
      );
      if (!already) {
        const before = findings.length;
        judgePin(runtimeDep, expected, snapshot, options, data, push, component, true);
        if (findings.slice(before).some((finding) => finding.severity === 'error')) {
          const row = components.find((item) => item.id === 'runtime');
          if (row) row.status = 'conflict';
        }
      }
    }
  }

  const signals = buildSignals(
    snapshot,
    deps,
    toolchain?.version ?? null,
    midnightJs,
    recommended,
    ledgerExpected,
  );
  const agrees = (stack: Stack): boolean => stackAgrees(signals, stack, readStack) === true;
  const recommendedAgrees = agrees(recommended);
  const older = olderStacks(data).find((stack) => agrees(stack));
  const hasError = findings.some((finding) => finding.severity === 'error');
  if (!hasError && older && !recommendedAgrees) {
    for (let i = findings.length - 1; i >= 0; i -= 1) {
      if (findings[i].code === 'proof-server-patch' && findings[i].found === older.proofServer) {
        findings.splice(i, 1);
      }
    }
    push({
      severity: 'warning',
      code: 'matches-older-matrix',
      component: 'project',
      message: `This project matches ${older.label}. The newer docs support matrix tests compiler ${recommended.toolchain}, compact-runtime ${recommended.compactRuntime}, and Midnight.js ${recommended.midnightJs}. Both sets target ledger ${options.networkLedgerMajor}. \`mn-doctor fix\` proposes the docs set. The two official sources still disagree; see the source section.`,
      expected: recommended.id,
      found: older.id,
      strictUpgrade: true,
    });
  } else if (!hasError && !recommendedAgrees) {
    for (const signal of signals) {
      if (signal.actual === null || signal.expected === '') continue;
      if (signal.id === 'proof-server' || signal.id === 'devtools') continue;
      if (sameVersion(signal.actual, signal.expected)) continue;
      if (findings.some((finding) => finding.component === signal.id && finding.severity === 'error')) continue;
      push({
        severity: 'warning',
        code: 'not-tested-version',
        component: signal.id,
        message: `${signal.id} is ${signal.actual}. The docs support matrix tests ${signal.expected}.`,
        found: signal.actual,
        expected: signal.expected,
        strictUpgrade: true,
      });
    }
  }

  const facade = deps.find((dep) => dep.name === '@midnight-ntwrk/wallet-sdk-facade' || dep.name === '@midnightntwrk/wallet-sdk-facade');
  if (facade) {
    const version = concrete(facade);
    component({
      id: 'dep:wallet-facade',
      label: facade.name,
      version,
      range: primaryRange(facade),
      ledgerMajor: 8,
      status: 'info',
      detail: 'Facade package. Docs now test the barrel @midnightntwrk/wallet-sdk@1.2.0. COMPATIBILITY.md (2026-04-07) lists facade 3.0.0.',
      file: rel(snapshot.root, facade.manifests[0]),
    });
    if (version && midnightJs && sameMinor(midnightJs, '4.1') && sameMinor(version, '3.0')) {
      push({
        severity: 'warning',
        code: 'wallet-facade-generation',
        component: facade.name,
        message: `${facade.name}@${version} is the pre-1.0 facade line from COMPATIBILITY.md. Midnight.js ${midnightJs} is the current docs line. The wallet barrel @midnightntwrk/wallet-sdk@1.2.0 depends on @midnightntwrk/wallet-sdk-facade ^4.1.0, a different package generation from facade 3.0.0.`,
        found: version,
        expected: recommended.walletSdk?.version,
        strictUpgrade: true,
      });
    }
  }

  if (findings.some((finding) => finding.code === 'compiler-runtime-mismatch')) {
    for (const row of components) {
      if (row.id === 'runtime' || row.id === 'compiler') row.status = 'conflict';
    }
  }

  const midnightTouched =
    deps.length > 0 || snapshot.pragmas.length > 0 || snapshot.proofServers.length > 0 || snapshot.compactFileCount > 0;
  if (!midnightTouched) {
    push({
      severity: 'info',
      code: 'nothing-found',
      component: 'project',
      message: 'No Midnight packages, Compact files, or proof-server image were found in this project.',
    });
  }

  const effective = findings.map((finding) =>
    options.strict && finding.strictUpgrade && finding.severity === 'warning'
      ? { ...finding, severity: 'error' as Severity }
      : finding,
  );
  const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  effective.sort((a, b) => rank[a.severity] - rank[b.severity] || a.code.localeCompare(b.code));
  const summary = {
    errors: effective.filter((finding) => finding.severity === 'error').length,
    warnings: effective.filter((finding) => finding.severity === 'warning').length,
    infos: effective.filter((finding) => finding.severity === 'info').length,
  };

  return {
    ok: summary.errors === 0,
    command: 'check',
    version: options.toolVersion,
    network: options.network,
    networkLedgerMajor: options.networkLedgerMajor,
    projectRoot: snapshot.root,
    strict: Boolean(options.strict),
    recommendedStackId: recommended.id,
    compatGeneratedAt: data.generatedAt,
    sources: data.sources,
    components,
    findings: effective,
    disagreements: data.disagreements,
    agreements: data.agreements,
    summary,
  };
}

function judgePin(
  dep: FoundDep,
  expected: { version: string; exact: boolean; source: string },
  snapshot: ProjectSnapshot,
  options: AnalyzeOptions,
  data: CompatData,
  push: (finding: Finding) => void,
  component: (row: ComponentReport) => void,
  replaceRuntime = false,
): void {
  const resolved = concrete(dep);
  const range = primaryRange(dep);
  const ledger = ledgerMajorFromPackageName(dep.name, data) ?? (resolved ? ledgerForRuntime(data, resolved) : null);
  let status: ComponentReport['status'] = 'ok';
  let detail = expected.exact ? `Tested exact pin ${expected.version}.` : `Tested version ${expected.version}.`;

  const leavesMinor =
    range !== null && canSelectDifferentMinor(range, expected.version) === true;
  const leavesMajor =
    range !== null &&
    majorOf(expected.version) !== null &&
    satisfies(range, `${(majorOf(expected.version) ?? 0) + 1}.0.0`) === true;
  const floating = Boolean(range && (range.trim() === '*' || range.trim() === 'latest' || leavesMajor || (expected.version.startsWith('0.') && leavesMinor)));
  if (floating) {
    status = 'conflict';
    const latest = data.npm.compactRuntimeDistTags.latest;
    push({
      severity: 'error',
      code: 'floating-range',
      component: dep.name,
      message: `${dep.name} is ranged as "${range}". That range can install a different 0.x minor. npm \`latest\` for @midnight-ntwrk/compact-runtime is ${latest} (ledger 9, verified ${data.npm.verifiedAt}). Pin \`${dep.name}@${expected.version}\`.`,
      found: range ?? undefined,
      expected: expected.version,
      file: rel(snapshot.root, dep.manifests[0]),
    });
  } else if (resolved && !sameVersion(resolved, expected.version)) {
    if (expected.exact) {
      status = 'conflict';
      push({
        severity: 'error',
        code: 'exact-pin',
        component: dep.name,
        message: `${dep.name} is ${resolved}. ${expected.source} requires ${expected.version}.`,
        found: resolved,
        expected: expected.version,
        file: rel(snapshot.root, dep.manifests[0]),
      });
    } else {
      status = 'warning';
      detail = `Docs test ${expected.version}.`;
    }
  } else if (range && satisfies(range, expected.version) === false) {
    status = 'conflict';
    push({
      severity: 'error',
      code: 'range-excludes-pin',
      component: dep.name,
      message: `${dep.name} is ranged as "${range}", which does not include the tested version ${expected.version}.`,
      found: range,
      expected: expected.version,
      file: rel(snapshot.root, dep.manifests[0]),
    });
  } else if (range && !resolved && !isExactRange(range)) {
    push({
      severity: 'warning',
      code: 'unlocked-range',
      component: dep.name,
      message: `${dep.name} is ranged as "${range}" and there is no lockfile resolution. The tested version is ${expected.version}.`,
      found: range,
      expected: expected.version,
      strictUpgrade: true,
      file: rel(snapshot.root, dep.manifests[0]),
    });
    status = 'warning';
  }

  const row: ComponentReport = {
    id: dep.name === '@midnight-ntwrk/compact-runtime' ? 'runtime' : `dep:${dep.name}`,
    label: dep.name,
    version: resolved,
    range,
    ledgerMajor: dep.name.includes('compact-runtime') ? ledger : ledgerMajorFromPackageName(dep.name, data),
    status,
    detail,
    file: rel(snapshot.root, dep.manifests[0]),
  };
  if (replaceRuntime) {
    // The runtime row was already recorded with a coarser status.
    return;
  }
  if (dep.name !== '@midnight-ntwrk/compact-runtime') component(row);
  void options;
}

function buildSignals(
  snapshot: ProjectSnapshot,
  deps: FoundDep[],
  toolchain: string | null,
  midnightJs: string | null,
  stack: Stack,
  ledgerExpected: string,
): Signal[] {
  const versionOf = (name: string): string | null => concrete(depByName(deps, name));
  const signals: Signal[] = [
    { id: 'devtools', actual: snapshot.compiler.devtools, expected: '' },
    { id: 'compiler', actual: toolchain, expected: '' },
    { id: 'language', actual: snapshot.pragmas[0] ? normalizeLanguage(snapshot.pragmas[0].version) : null, expected: '' },
    { id: 'runtime', actual: versionOf('@midnight-ntwrk/compact-runtime'), expected: '' },
    { id: 'compact-js', actual: versionOf('@midnight-ntwrk/compact-js'), expected: '' },
    { id: 'platform-js', actual: versionOf('@midnight-ntwrk/platform-js'), expected: '' },
    { id: 'midnight-js', actual: midnightJs, expected: '' },
    { id: 'testkit', actual: versionOf('@midnight-ntwrk/testkit-js'), expected: '' },
    { id: 'dapp-connector', actual: versionOf('@midnight-ntwrk/dapp-connector-api'), expected: '' },
    { id: 'onchain-runtime', actual: versionOf('@midnight-ntwrk/onchain-runtime-v3'), expected: '' },
    { id: 'ledger', actual: versionOf('@midnight-ntwrk/ledger-v8'), expected: ledgerExpected },
    { id: 'proof-server', actual: snapshot.proofServers[0]?.tag ?? null, expected: '' },
    { id: 'wallet', actual: versionOf('@midnightntwrk/wallet-sdk') ?? versionOf('@midnight-ntwrk/wallet-sdk'), expected: '' },
    { id: 'zkir', actual: versionOf('@midnight-ntwrk/zkir-v2'), expected: '' },
  ];
  for (const signal of signals) {
    if (signal.id === 'ledger') continue;
    signal.expected = readStack(stack, signal.id) ?? '';
  }
  return signals;
}

function normalizeLanguage(version: string): string {
  const parts = version.split('.');
  if (parts.length === 2) return `${version}.0`;
  return version;
}
