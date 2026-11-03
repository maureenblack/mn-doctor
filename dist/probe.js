import { spawnSync } from 'node:child_process';
import { parseVersion } from './semver.js';
export function defaultRunner(command, args) {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
        timeout: 8000,
        env: process.env,
        windowsHide: true,
    });
    if (result.error) {
        const code = result.error.code;
        if (code === 'ENOENT' || code === 'ETIMEDOUT')
            return null;
        return { code: null, stdout: '', stderr: result.error.message };
    }
    return {
        code: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}
function firstVersion(output) {
    if (!output)
        return null;
    const text = `${output.stdout}\n${output.stderr}`.slice(0, 4000);
    const match = text.match(/v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/);
    if (!match)
        return null;
    const parsed = parseVersion(match[1]);
    return parsed ? `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease ? `-${parsed.prerelease}` : ''}` : null;
}
function firstField(output, pattern) {
    if (!output)
        return null;
    const text = `${output.stdout}\n${output.stderr}`.slice(0, 4000);
    return pattern.exec(text)?.[0] ?? null;
}
/**
 * `compact` 0.5.x is the devtools CLI. `compactc` / `compact compile` is the
 * compiler. A bare version on the devtools line is not treated as compactc.
 */
export function probeCompiler(devtoolsLine, overrides = {}, runner = defaultRunner) {
    const devtoolsMajorMinor = devtoolsLine;
    let devtools = overrides.devtools ?? null;
    let toolchain = overrides.toolchain ?? null;
    let ledgerVersion = null;
    let runtimeVersion = null;
    let languageVersion = null;
    if (overrides.devtools === undefined) {
        const fromCompact = firstVersion(runner('compact', ['--version']));
        if (fromCompact?.startsWith(`${devtoolsMajorMinor}.`))
            devtools = fromCompact;
        else if (fromCompact && overrides.toolchain === undefined && !toolchain)
            toolchain = fromCompact;
    }
    if (overrides.toolchain === undefined) {
        const fromCompile = firstVersion(runner('compact', ['compile', '--version']));
        const compileIsDevtools = fromCompile?.startsWith(`${devtoolsMajorMinor}.`) ?? false;
        if (fromCompile && !compileIsDevtools)
            toolchain = fromCompile;
        else {
            const fromCompactc = firstVersion(runner('compactc', ['--version']));
            if (fromCompactc && !fromCompactc.startsWith(`${devtoolsMajorMinor}.`))
                toolchain = fromCompactc;
        }
        runtimeVersion = firstVersion(runner('compact', ['compile', '--runtime-version']));
        languageVersion = firstVersion(runner('compact', ['compile', '--language-version']));
        ledgerVersion = firstField(runner('compact', ['compile', '--ledger-version']), /ledger-\d+(?:\.\d+)*/);
    }
    return { toolchain, devtools, ledgerVersion, runtimeVersion, languageVersion };
}
