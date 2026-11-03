import { spawnSync } from 'node:child_process';

import { parseVersion } from './semver.js';
import type { CompilerInfo } from './types.js';

export interface ProbeOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type Runner = (command: string, args: string[]) => ProbeOutput | null;

export function defaultRunner(command: string, args: string[]): ProbeOutput | null {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 8000,
    env: process.env,
    windowsHide: true,
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ETIMEDOUT') return null;
    return { code: null, stdout: '', stderr: result.error.message };
  }
  return {
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function firstVersion(output: ProbeOutput | null): string | null {
  if (!output) return null;
  const text = `${output.stdout}\n${output.stderr}`.slice(0, 4000);
  const match = text.match(/v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/);
  if (!match) return null;
  const parsed = parseVersion(match[1]);
  return parsed ? `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease ? `-${parsed.prerelease}` : ''}` : null;
}

function firstField(output: ProbeOutput | null, pattern: RegExp): string | null {
  if (!output) return null;
  const text = `${output.stdout}\n${output.stderr}`.slice(0, 4000);
  return pattern.exec(text)?.[0] ?? null;
}

export interface ProbeOverrides {
  toolchain?: string | null;
  devtools?: string | null;
}

/**
 * `compact` 0.5.x is the devtools CLI. `compactc` / `compact compile` is the
 * compiler. A bare version on the devtools line is not treated as compactc.
 */
export function probeCompiler(
  devtoolsLine: string,
  overrides: ProbeOverrides = {},
  runner: Runner = defaultRunner,
): CompilerInfo {
  const devtoolsMajorMinor = devtoolsLine;

  let devtools = overrides.devtools ?? null;
  let toolchain = overrides.toolchain ?? null;
  let ledgerVersion: string | null = null;
  let runtimeVersion: string | null = null;
  let languageVersion: string | null = null;

  if (overrides.devtools === undefined) {
    const fromCompact = firstVersion(runner('compact', ['--version']));
    if (fromCompact?.startsWith(`${devtoolsMajorMinor}.`)) devtools = fromCompact;
    else if (fromCompact && overrides.toolchain === undefined && !toolchain) toolchain = fromCompact;
  }

  if (overrides.toolchain === undefined) {
    const fromCompile = firstVersion(runner('compact', ['compile', '--version']));
    const compileIsDevtools = fromCompile?.startsWith(`${devtoolsMajorMinor}.`) ?? false;
    if (fromCompile && !compileIsDevtools) toolchain = fromCompile;
    else {
      const fromCompactc = firstVersion(runner('compactc', ['--version']));
      if (fromCompactc && !fromCompactc.startsWith(`${devtoolsMajorMinor}.`)) toolchain = fromCompactc;
    }
    runtimeVersion = firstVersion(runner('compact', ['compile', '--runtime-version']));
    languageVersion = firstVersion(runner('compact', ['compile', '--language-version']));
    ledgerVersion = firstField(
      runner('compact', ['compile', '--ledger-version']),
      /ledger-\d+(?:\.\d+)*/,
    );
  }

  return { toolchain, devtools, ledgerVersion, runtimeVersion, languageVersion };
}
