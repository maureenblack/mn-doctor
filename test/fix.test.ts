import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'dist', 'cli.js');

function runCli(args: string[], cwd = root): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

describe('fix', () => {
  it('shows a diff and the compiler command without writing or launching compact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mn-doctor-fix-'));
    cpSync(join(root, 'test', 'fixtures', 'broken-compiler-ledger9'), dir, { recursive: true });
    const before = readFileSync(join(dir, 'package.json'), 'utf8');
    const result = runCli(
      ['fix', '--cwd', dir, '--compact-version', '0.35.0', '--devtools-version', '0.5.1', '--json'],
      root,
    );
    assert.equal(result.status, 2, result.stderr + result.stdout);
    const plan = JSON.parse(result.stdout) as {
      applied: boolean;
      commands: string[];
      edits: Array<{ diff: string }>;
    };
    assert.equal(plan.applied, false);
    assert.ok(plan.commands.includes('compact update 0.31.1'));
    assert.ok(plan.edits.some((edit) => edit.diff.includes('0.16.0') && edit.diff.includes('pragma') === false || edit.diff.includes('0.23')));
    assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), before);
    assert.doesNotMatch(result.stdout, /Executed|spawn/);
  });

  it('applies package, pragma, and proof-server edits with --yes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mn-doctor-fix-'));
    cpSync(join(root, 'test', 'fixtures', 'sdk-april-2026'), dir, { recursive: true });
    const result = runCli(
      ['fix', '--cwd', dir, '--compact-version', '0.30.0', '--devtools-version', '0.5.1', '--yes', '--no-color'],
      root,
    );
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /compact update 0\.31\.1/);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    assert.equal(pkg.dependencies['@midnight-ntwrk/compact-runtime'], '0.16.0');
    assert.equal(pkg.dependencies['@midnight-ntwrk/midnight-js'], '4.1.1');
    assert.equal(pkg.dependencies['@midnight-ntwrk/midnight-js-contracts'], '4.1.1');
    assert.equal(pkg.dependencies['@midnight-ntwrk/ledger-v8'], '8.1.0');
    assert.equal(pkg.dependencies['@midnight-ntwrk/wallet-sdk-facade'], '3.0.0');
    const contract = readFileSync(join(dir, 'contracts', 'counter.compact'), 'utf8');
    assert.match(contract, /pragma language_version 0\.23;/);
    const compose = readFileSync(join(dir, 'compose.yml'), 'utf8');
    assert.match(compose, /midnightntwrk\/proof-server:8\.1\.3/);
  });

  it('leaves an already-good project unchanged', () => {
    const result = runCli([
      'fix',
      '--cwd',
      join(root, 'test', 'fixtures', 'good-public'),
      '--compact-version',
      '0.31.1',
      '--devtools-version',
      '0.5.1',
      '--json',
    ]);
    assert.equal(result.status, 0, result.stdout);
    const plan = JSON.parse(result.stdout) as { applied: boolean; edits: unknown[]; commands: string[] };
    assert.equal(plan.applied, false);
    assert.equal(plan.edits.length, 0);
    assert.equal(plan.commands.length, 0);
  });
});
