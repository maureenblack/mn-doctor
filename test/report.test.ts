import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { analyze } from '../src/analyze.js';
import { loadCompat } from '../src/compat.js';
import { inspectProject } from '../src/inspect.js';
import { formatReport } from '../src/report.js';
import type { CompilerInfo } from '../src/types.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = loadCompat();

function reportFor(fixture: string, toolchain: string) {
  const compiler: CompilerInfo = {
    toolchain,
    devtools: '0.5.1',
    ledgerVersion: null,
    runtimeVersion: null,
    languageVersion: null,
  };
  return analyze(inspectProject(join(root, 'test', 'fixtures', fixture), compiler), data, {
    network: 'mainnet',
    networkLedgerMajor: 8,
    toolVersion: '1.1.0',
  });
}

function plainLines(text: string): string[] {
  return text.replace(/\u001b\[[0-9;]*m/g, '').split('\n');
}

describe('terminal report', () => {
  it('uses the brand header, table, fix line, and stays within 80 columns', () => {
    const text = formatReport(reportFor('broken-compiler-ledger9', '0.35.0'), false);
    const lines = plainLines(text);
    for (const line of lines) {
      assert.ok(line.length <= 80, `too long (${line.length}): ${line}`);
    }
    assert.match(lines[0], /^mn-doctor 1\.1\.0 · .+ · mainnet$/);
    assert.match(text, /STATUS\s+COMPONENT\s+FOUND\s+EXPECTED/);
    assert.match(text, /✗ conflict\s+compact compiler\s+0\.35\.0\s+0\.31\.1/);
    assert.match(text, /✓ ok\s+compact-runtime\s+0\.16\.0\s+0\.16\.0/);
    assert.match(text, /✓ ok\s+proof server\s+8\.1\.3\s+8\.1\.3/);
    assert.match(text, /fix {2}compact update 0\.31\.1/);
    assert.doesNotMatch(text, /midnightnetwork\/proof-server/);
    assert.doesNotMatch(text, /0\.24\.0/);
    assert.match(text, /2 conflicts/);
    assert.match(text, /Run mn-doctor fix/);
    assert.match(text, /Note: docs and the SDK list disagree on \d+ items\. Use --sources to see them\./);
    assert.doesNotMatch(text, /…/);
    assert.doesNotMatch(text, /4\.0\.4/);
  });

  it('prints the full source list only with --sources, wrapped', () => {
    const text = formatReport(reportFor('broken-compiler-ledger9', '0.35.0'), false, { sources: true });
    const lines = plainLines(text);
    for (const line of lines) {
      assert.ok(line.length <= 80, `too long (${line.length}): ${line}`);
    }
    assert.match(text, /Midnight\.js: docs 4\.1\.1; sdk 4\.0\.4/);
    assert.match(text, /wallet-sdk-facade/);
    assert.match(text, /3\.0\.0/);
    assert.doesNotMatch(text, /…/);
    assert.doesNotMatch(text, /Use --sources to see them/);
  });

  it('prints a clean bill of health for the docs set', () => {
    const text = formatReport(reportFor('good-public', '0.31.1'), false);
    assert.match(text, /✓ ok\s+compact compiler\s+0\.31\.1\s+0\.31\.1/);
    assert.match(text, /Clean bill of health/);
    assert.doesNotMatch(text, /✗ conflict/);
  });

  it('stays readable with NO_COLOR and --ascii', () => {
    const colored = formatReport(reportFor('good-public', '0.31.1'), true);
    assert.match(colored, /\u001b\[32m/);
    assert.doesNotMatch(colored, /\u001b\[38/);
    const ascii = formatReport(reportFor('broken-compiler-ledger9', '0.35.0'), false, { ascii: true });
    assert.match(ascii, /\[x\]/);
    assert.match(ascii, /\[ok\]/);
    assert.doesNotMatch(ascii, /✓|✗/);
  });
});

describe('cli text', () => {
  it('matches the library report when stdout is not a TTY', () => {
    const result = spawnSync(
      process.execPath,
      [
        join(root, 'dist', 'cli.js'),
        'check',
        '--cwd',
        'test/fixtures/broken-compiler-ledger9',
        '--compact-version',
        '0.35.0',
        '--devtools-version',
        '0.5.1',
        '--no-color',
      ],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout.trimEnd(), formatReport(reportFor('broken-compiler-ledger9', '0.35.0'), false));
  });
});
