import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { analyze } from '../src/analyze.js';
import { loadCompat } from '../src/compat.js';
import { inspectProject } from '../src/inspect.js';
import type { CompilerInfo } from '../src/types.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = loadCompat();
const cli = join(root, 'dist', 'cli.js');

function compiler(toolchain: string, devtools = '0.5.1'): CompilerInfo {
  return {
    toolchain,
    devtools,
    ledgerVersion: null,
    runtimeVersion: null,
    languageVersion: null,
  };
}

function checkFixture(name: string, toolchain: string, strict = false) {
  const project = join(root, 'test', 'fixtures', name);
  const snapshot = inspectProject(project, compiler(toolchain));
  return analyze(snapshot, data, {
    network: 'mainnet',
    networkLedgerMajor: 8,
    strict,
    toolVersion: '0.1.0',
  });
}

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('check fixtures', () => {
  it('accepts the docs public-network set', () => {
    const report = checkFixture('good-public', '0.31.1');
    assert.equal(report.ok, true, JSON.stringify(report.findings, null, 2));
    assert.equal(report.summary.errors, 0);
    assert.equal(report.summary.warnings, 0);
    assert.ok(report.disagreements.some((row) => row.docs.includes('4.1.1') && row.sdk.includes('4.0.4')));
  });

  it('rejects a ledger 9 compiler against runtime 0.16.0', () => {
    const report = checkFixture('broken-compiler-ledger9', '0.35.0');
    assert.equal(report.ok, false);
    const codes = report.findings.map((finding) => finding.code);
    assert.ok(codes.includes('compiler-runtime-mismatch'));
    assert.ok(codes.includes('pragma-ledger-mismatch'));
    const text = report.findings.map((finding) => finding.message).join('\n');
    assert.match(text, /0\.20\.0/);
    assert.match(text, /ledger 9/);
    assert.match(text, /compact update 0\.31\.1/);
  });

  it('rejects compact-runtime 0.20.0 on Midnight.js 4.1.1', () => {
    const report = checkFixture('broken-runtime-ledger9', '0.31.1');
    assert.equal(report.ok, false);
    const text = report.findings.map((finding) => finding.message).join('\n');
    assert.match(text, /0\.20\.0/);
    assert.match(text, /onchain-runtime-v4|ledger 9/);
    assert.ok(report.findings.some((finding) => finding.code === 'compiler-runtime-mismatch'));
    assert.ok(report.findings.some((finding) => finding.code === 'package-ledger-mismatch'));
  });

  it('warns on a consistent April 2026 SDK set and fails that set in strict mode', () => {
    const report = checkFixture('sdk-april-2026', '0.30.0');
    assert.equal(report.ok, true, JSON.stringify(report.findings, null, 2));
    assert.ok(report.findings.some((finding) => finding.code === 'matches-older-matrix'));
    const strict = checkFixture('sdk-april-2026', '0.30.0', true);
    assert.equal(strict.ok, false);
  });

  it('rejects mixed Midnight.js versions', () => {
    const report = checkFixture('mixed-midnight-js', '0.31.1');
    assert.equal(report.ok, false);
    assert.ok(report.findings.some((finding) => finding.code === 'midnight-js-skew'));
  });

  it('rejects a floating compact-runtime range and a latest proof server tag', () => {
    const report = checkFixture('floating-runtime', '0.31.1');
    assert.equal(report.ok, false);
    const codes = report.findings.map((finding) => finding.code);
    assert.ok(codes.includes('floating-range'));
    assert.ok(codes.includes('proof-server-unpinned'));
    const text = report.findings.map((finding) => finding.message).join('\n');
    assert.match(text, /0\.20\.0/);
  });

  it('rejects ledger-v8 8.1.3 next to Midnight.js 4.1.1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mn-doctor-'));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        dependencies: {
          '@midnight-ntwrk/midnight-js': '4.1.1',
          '@midnight-ntwrk/compact-runtime': '0.16.0',
          '@midnight-ntwrk/ledger-v8': '8.1.3',
        },
      }),
    );
    const report = analyze(inspectProject(dir, compiler('0.31.1')), data, {
      network: 'preprod',
      networkLedgerMajor: 8,
      toolVersion: '0.1.0',
    });
    assert.equal(report.ok, false);
    const pin = report.findings.find((finding) => finding.code === 'exact-pin' && finding.component.includes('ledger-v8'));
    assert.ok(pin, JSON.stringify(report.findings, null, 2));
    assert.match(pin.message, /8\.1\.0/);
  });
});

describe('cli', () => {
  it('exits 0 for the good fixture as json', () => {
    const result = runCli([
      'check',
      '--cwd',
      'test/fixtures/good-public',
      '--compact-version',
      '0.31.1',
      '--devtools-version',
      '0.5.1',
      '--json',
      '--no-color',
    ]);
    assert.equal(result.stderr, '');
    assert.equal(result.status, 0, result.stdout);
    const report = JSON.parse(result.stdout) as { ok: boolean; network: string };
    assert.equal(report.ok, true);
    assert.equal(report.network, 'mainnet');
  });

  it('exits 1 for the ledger 9 compiler fixture', () => {
    const result = runCli([
      '--cwd',
      'test/fixtures/broken-compiler-ledger9',
      '--compact-version',
      '0.35.0',
      '--devtools-version',
      '0.5.1',
      '--no-color',
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /compact update 0\.31\.1/);
    assert.match(result.stdout, /4\.1\.1/);
    assert.match(result.stdout, /4\.0\.4/);
  });

  it('prints compat data', () => {
    const result = runCli(['compat', '--no-color']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /0\.31\.1/);
    assert.match(result.stdout, /4\.0\.4/);
  });
});
