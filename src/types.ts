export type Severity = 'error' | 'warning' | 'info';

export interface SourceRef {
  id: string;
  title: string;
  url: string;
  fetchedAt: string;
  statedUpdated?: string;
}

export interface StackPackage {
  name: string;
  version: string;
  walletOnlyVersion?: string;
  note?: string;
}

export interface Stack {
  id: string;
  recommended: boolean;
  ledgerMajor: number;
  sourceId: string;
  label: string;
  devtools: string;
  toolchain: string;
  language: string;
  compactRuntime: string;
  compactJs: string;
  platformJs: string;
  midnightJs: string;
  testkitJs: string;
  dappConnector: string;
  onchainRuntime: StackPackage;
  ledger: StackPackage;
  walletSdk?: { names: string[]; version: string };
  walletFacade?: StackPackage;
  zkir?: StackPackage;
  proofServer: string;
  install: {
    compiler: string;
    note: string;
  };
}

export interface ToolchainEntry {
  version: string;
  language: string;
  runtime: string;
  ledgerMajor: number;
  released: string;
  note?: string;
  sources: string[];
}

export interface ReleaseLine {
  id: string;
  /** Major.minor prefix, e.g. "4.1". */
  match: string;
  packages: Record<string, string>;
  source: string;
}

export interface Disagreement {
  id: string;
  component: string;
  docs: string;
  sdk: string;
  detail: string;
  /** Refresh leaves editorial rows alone and only updates simple pairs. */
  editorial?: boolean;
}

export interface Agreement {
  component: string;
  version: string;
}

export interface IncompatibleCombination {
  id: string;
  toolchain?: string;
  toolchains?: string[];
  runtime?: string;
  runtimes?: string[];
  midnightJs?: string;
  message: string;
}

export interface NetworkSide {
  node: string;
  indexer: string;
  proofServer: string;
  indexerNote?: string;
}

export interface CompatData {
  schemaVersion: number;
  generatedAt: string;
  recommendedStackId: string;
  publicLedgerMajor: number;
  devtoolsLine: string;
  proofServerImage: string;
  sources: SourceRef[];
  networks: Record<string, { ledgerMajor: number; docs: NetworkSide; sdk: NetworkSide }>;
  stacks: Stack[];
  toolchains: ToolchainEntry[];
  toolchainLedgerFallback: Array<{ min: string; ledgerMajor: number }>;
  runtimeLedgerFallback: Array<{ min: string; ledgerMajor: number }>;
  onchainRuntimeLedger: Record<string, number>;
  releaseLines: ReleaseLine[];
  npm: {
    verifiedAt: string;
    compactRuntimeDistTags: Record<string, string>;
    pins: Record<string, Record<string, string>>;
  };
  disagreements: Disagreement[];
  agreements: Agreement[];
  incompatibleCombinations: IncompatibleCombination[];
  notes: string[];
}

export interface DepSpec {
  name: string;
  range: string;
  section: string;
  manifest: string;
}

export interface Manifest {
  path: string;
  raw: string;
  dependencies: DepSpec[];
}

export interface PragmaHit {
  file: string;
  version: string;
  minimum: boolean;
  line: number;
}

export interface ProofServerHit {
  file: string;
  image: string;
  tag: string;
}

export interface CompilerInfo {
  toolchain: string | null;
  devtools: string | null;
  ledgerVersion: string | null;
  runtimeVersion: string | null;
  languageVersion: string | null;
}

export interface ProjectSnapshot {
  root: string;
  manifests: Manifest[];
  packageJsonError?: string;
  lockfile: {
    path: string;
    versions: Record<string, { version: string; alternates: string[] }>;
    extraLockfiles: string[];
  } | null;
  pragmas: PragmaHit[];
  proofServers: ProofServerHit[];
  compiler: CompilerInfo;
  compactFileCount: number;
}

export interface FoundDep {
  name: string;
  ranges: string[];
  manifests: string[];
  resolved: string | null;
  alternates: string[];
}

export interface Finding {
  severity: Severity;
  code: string;
  component: string;
  message: string;
  found?: string;
  expected?: string;
  ledgerMajor?: number | null;
  file?: string;
  /** When true, `--strict` reports this warning as an error. */
  strictUpgrade?: boolean;
}

export interface ComponentReport {
  id: string;
  label: string;
  version: string | null;
  range: string | null;
  ledgerMajor: number | null;
  status: 'ok' | 'conflict' | 'warning' | 'info' | 'missing';
  detail: string;
  file?: string;
}

export interface Report {
  ok: boolean;
  command: 'check';
  version: string;
  network: string;
  networkLedgerMajor: number;
  projectRoot: string;
  strict: boolean;
  recommendedStackId: string;
  compatGeneratedAt: string;
  sources: SourceRef[];
  components: ComponentReport[];
  findings: Finding[];
  disagreements: Disagreement[];
  agreements: Agreement[];
  summary: { errors: number; warnings: number; infos: number };
}

export interface FileEdit {
  path: string;
  before: string;
  after: string;
  diff: string;
}

export interface FixPlan {
  stackId: string;
  edits: FileEdit[];
  commands: string[];
  notes: string[];
  compilerCommand: string | null;
}
