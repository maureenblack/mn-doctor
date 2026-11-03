#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { analyze } from './analyze.js';
import { canonicalNetwork, knownNetworks, loadCompat, networkLedger, packageRoot, recommendedStack, } from './compat.js';
import { planFix, planTextEdits } from './fix.js';
import { inspectProject } from './inspect.js';
import { probeCompiler } from './probe.js';
import { formatPlan, formatReport } from './report.js';
function readFlags(argv) {
    const parsed = parseArgs({
        args: argv,
        allowPositionals: true,
        strict: true,
        options: {
            json: { type: 'boolean', default: false },
            network: { type: 'string' },
            cwd: { type: 'string' },
            yes: { type: 'boolean', default: false },
            strict: { type: 'boolean', default: false },
            'compact-version': { type: 'string' },
            'devtools-version': { type: 'string' },
            'no-color': { type: 'boolean', default: false },
            help: { type: 'boolean', short: 'h', default: false },
            version: { type: 'boolean', short: 'v', default: false },
        },
    });
    return {
        json: parsed.values.json ?? false,
        network: parsed.values.network,
        cwd: parsed.values.cwd,
        yes: parsed.values.yes ?? false,
        strict: parsed.values.strict ?? false,
        compactVersion: parsed.values['compact-version'],
        devtoolsVersion: parsed.values['devtools-version'],
        noColor: parsed.values['no-color'] ?? false,
        help: parsed.values.help ?? false,
        version: parsed.values.version ?? false,
        command: parsed.positionals[0] ?? 'check',
    };
}
function helpText() {
    return `mn-doctor — Midnight toolchain version doctor

Usage
  mn-doctor [check] [options]     Inspect the project in --cwd (default command)
  mn-doctor fix [options]         Propose the docs known-good set and, with --yes, edit files
  mn-doctor compat                Print the shipped compatibility data

Options
  --cwd <dir>                     Project directory (default: the current directory)
  --network <name>                preview, preprod, mainnet, or testnet (default: mainnet)
  --json                          Write a JSON report to stdout
  --strict                        Fail unless the project matches the current docs matrix
  --compact-version <ver>         Use this compactc version instead of probing the PATH
  --devtools-version <ver>        Use this compact CLI version instead of probing the PATH
  --yes                           Apply fix file edits without a prompt
  --no-color
  -h, --help
  -v, --version

Exit codes
  0   check found no conflicts, or fix wrote its edits (or had nothing to write)
  1   check found a version conflict
  2   usage error, or fix proposed file edits and did not write them

The compiler pin is printed and never executed. A bare \`compact update\` can install a
ledger 9 toolchain while preview, preprod, and mainnet still run ledger 8.
`;
}
function toolVersion() {
    const raw = readFileSync(resolve(packageRoot(), 'package.json'), 'utf8');
    return JSON.parse(raw).version;
}
function colorEnabled(flags) {
    return !flags.json && !flags.noColor && Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}
function compilerFrom(flags, devtoolsLine) {
    return probeCompiler(devtoolsLine, {
        toolchain: flags.compactVersion,
        devtools: flags.devtoolsVersion,
    });
}
function textFiles(root, relativePaths) {
    const unique = [...new Set(relativePaths)];
    return unique.map((file) => {
        const path = resolve(root, file);
        return { path, raw: readFileSync(path, 'utf8') };
    });
}
async function confirm(question) {
    if (!process.stdin.isTTY)
        return false;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = await rl.question(question);
        return /^y(es)?$/i.test(answer.trim());
    }
    finally {
        rl.close();
    }
}
async function main(argv) {
    let flags;
    try {
        flags = readFlags(argv);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        console.error('Run mn-doctor --help for usage.');
        return 2;
    }
    if (flags.help || flags.command === 'help') {
        console.log(helpText());
        return 0;
    }
    const version = toolVersion();
    if (flags.version || flags.command === 'version') {
        console.log(version);
        return 0;
    }
    if (!['check', 'fix', 'compat'].includes(flags.command)) {
        console.error(`Unknown command "${flags.command}".`);
        console.error(helpText());
        return 2;
    }
    const data = loadCompat();
    if (flags.command === 'compat') {
        const payload = {
            generatedAt: data.generatedAt,
            recommendedStack: recommendedStack(data),
            networks: data.networks,
            disagreements: data.disagreements,
            agreements: data.agreements,
            toolchains: data.toolchains,
            notes: data.notes,
            sources: data.sources,
        };
        if (flags.json)
            console.log(JSON.stringify(payload, null, 2));
        else {
            console.log(`mn-doctor compatibility data · ${data.generatedAt}`);
            console.log(`Recommended stack: ${payload.recommendedStack.label}`);
            console.log(`Compiler pin: ${payload.recommendedStack.install.compiler}`);
            console.log('');
            for (const row of data.disagreements) {
                console.log(`${row.component}: docs ${row.docs} · sdk ${row.sdk}`);
                console.log(`  ${row.detail}`);
            }
        }
        return 0;
    }
    const requested = canonicalNetwork(flags.network);
    if (!knownNetworks(data).includes(requested.id)) {
        console.error(`Unknown network "${flags.network}". Use one of: ${knownNetworks(data).join(', ')}, testnet.`);
        return 2;
    }
    const root = resolve(flags.cwd ?? process.cwd());
    const compiler = compilerFrom(flags, data.devtoolsLine);
    const snapshot = inspectProject(root, compiler);
    if (flags.command === 'check') {
        const report = analyze(snapshot, data, {
            network: requested.id,
            networkLedgerMajor: networkLedger(data, requested.id),
            aliasOf: requested.aliasOf,
            strict: flags.strict,
            toolVersion: version,
        });
        if (flags.json)
            console.log(JSON.stringify(report, null, 2));
        else
            console.log(formatReport(report, colorEnabled(flags)));
        return report.ok ? 0 : 1;
    }
    const manifestPlan = planFix(snapshot, data);
    const texts = textFiles(root, [
        ...snapshot.pragmas.map((pragma) => pragma.file),
        ...snapshot.proofServers.map((hit) => hit.file),
    ]);
    const textPlan = planTextEdits(snapshot, data, texts);
    const plan = { ...manifestPlan, edits: [...manifestPlan.edits, ...textPlan] };
    const needsWrite = plan.edits.length > 0;
    if (flags.json) {
        let applied = false;
        if (needsWrite && flags.yes) {
            for (const edit of plan.edits)
                writeFileSync(edit.path, edit.after);
            applied = true;
        }
        console.log(JSON.stringify({
            command: 'fix',
            applied,
            stackId: plan.stackId,
            edits: plan.edits.map((edit) => ({ path: edit.path, diff: edit.diff })),
            commands: plan.commands,
            notes: plan.notes,
        }, null, 2));
        return needsWrite && !applied ? 2 : 0;
    }
    console.log(formatPlan(plan, colorEnabled(flags), false));
    if (!needsWrite)
        return 0;
    const apply = flags.yes || (await confirm('\nApply these file edits? [y/N] '));
    if (!apply) {
        console.log('Left the project unchanged.');
        return 2;
    }
    for (const edit of plan.edits)
        writeFileSync(edit.path, edit.after);
    console.log(`Wrote ${plan.edits.length} file(s).`);
    return 0;
}
function isDirectRun() {
    const entry = process.argv[1];
    if (!entry)
        return false;
    try {
        return import.meta.url === pathToFileURL(realpathSync(entry)).href;
    }
    catch {
        return false;
    }
}
if (isDirectRun()) {
    main(process.argv.slice(2))
        .then((code) => {
        process.exitCode = code;
    })
        .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 2;
    });
}
