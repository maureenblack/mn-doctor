import { relative } from 'node:path';

import type { ComponentReport, Finding, FixPlan, Report } from './types.js';

/** Standard 16-color ANSI only: red, green, yellow, bold, dim. */
const ANSI = {
  red: '31',
  green: '32',
  yellow: '33',
  bold: '1',
  dim: '2',
  redBold: '1;31',
} as const;

const WIDTH = 78;
const COL_STATUS = 12;
const COL_NAME = 22;
const COL_FOUND = 12;

export interface FormatOptions {
  ascii?: boolean;
}

function paint(text: string, code: string, enabled: boolean): string {
  if (!enabled || text.length === 0) return text;
  return `\u001b[${code}m${text}\u001b[0m`;
}

function pad(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text + ' '.repeat(width - text.length);
}

function visibleLength(text: string): number {
  return text.replace(/\u001b\[[0-9;]*m/g, '').length;
}

function wrap(text: string, width: number, indent: string): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  if (words.length === 1 && words[0] === '') return [];
  const lines: string[] = [];
  let current = indent;
  for (const word of words) {
    const next = current.trim().length === 0 ? indent + word : `${current} ${word}`;
    if (next.length > width && current.trim().length > 0) {
      lines.push(current);
      current = indent + word;
    } else {
      current = next;
    }
  }
  if (current.trim().length > 0) lines.push(current);
  return lines.map((line) => (line.length > width ? line.slice(0, width) : line));
}

function sentences(text: string, count: number): string {
  const parts = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.slice(0, count).join(' ');
}

function commandsIn(message: string): string[] {
  const found = [...message.matchAll(/`([^`\n]+)`/g)].map((match) => match[1].trim());
  const commands = found.filter((item) =>
    /^(compact |npm |pnpm |yarn |bun |docker |pragma )/.test(item),
  );
  return [...new Set(commands)];
}

function shortPath(root: string): string {
  const cwd = process.cwd();
  const rel = root === cwd ? '.' : root.startsWith(`${cwd}/`) ? relative(cwd, root) : root;
  if (rel.length <= 42) return rel || '.';
  const parts = rel.split('/');
  const tail = parts.slice(-2).join('/');
  return tail.length < rel.length ? `…/${tail}` : rel.slice(0, 42);
}

function shortName(label: string): string {
  const stripped = label.replace('@midnight-ntwrk/', '').replace('@midnightntwrk/', '');
  if (stripped === 'Compact devtools') return 'compact devtools';
  if (stripped === 'Compact compiler') return 'compact compiler';
  if (stripped === 'Language pragma') return 'language pragma';
  if (stripped === 'Proof server') return 'proof server';
  return stripped;
}

function firstVersion(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?|≥\s*\d+|\d+\.\d+/);
  return match ? match[0].replace(/\s+/g, '') : null;
}

interface TableRow {
  status: 'ok' | 'warning' | 'conflict' | 'missing';
  name: string;
  found: string;
  expected: string;
}

function relates(component: ComponentReport, finding: Finding): boolean {
  if (finding.component === component.id || finding.component === component.label) return true;
  const blob = `${component.id} ${component.label}`.toLowerCase();
  const key = finding.component.toLowerCase();
  if (key === 'compiler') return blob.includes('compiler') && !blob.includes('runtime');
  if (key === 'runtime') return blob.includes('compact-runtime');
  if (key === 'pragma') return blob.includes('pragma');
  if (key === 'proof-server') return blob.includes('proof');
  if (key === 'devtools') return blob.includes('devtools');
  return blob.includes(key);
}

function rowStatus(component: ComponentReport, findings: Finding[]): TableRow['status'] {
  const related = findings.filter((finding) => relates(component, finding));
  if (related.some((finding) => finding.severity === 'error') || component.status === 'conflict') {
    return 'conflict';
  }
  if (related.some((finding) => finding.severity === 'warning') || component.status === 'warning' || component.status === 'missing') {
    return component.status === 'missing' ? 'missing' : 'warning';
  }
  return 'ok';
}

function expectedOf(component: ComponentReport, findings: Finding[]): string {
  const related = findings.filter((finding) => relates(component, finding));
  for (const finding of related) {
    const version = firstVersion(finding.expected);
    if (version) return version;
  }
  if (component.version) return component.version;
  return '—';
}

function isMidnightJs(component: ComponentReport): boolean {
  return component.label === '@midnight-ntwrk/midnight-js' || component.label.startsWith('@midnight-ntwrk/midnight-js-');
}

function isNoise(component: ComponentReport): boolean {
  return component.status === 'info' && /wallet-sdk-/.test(component.label);
}

const KEEP =
  /devtools|compiler|pragma|compact-runtime|compact-js|midnight-js$|ledger-v\d|proof|wallet-sdk$|onchain-runtime|dapp-connector|platform-js|testkit|zkir/;

function tableRows(report: Report): TableRow[] {
  const rows: TableRow[] = [];
  const js = report.components.filter(isMidnightJs);
  const rest = report.components.filter((component) => !isMidnightJs(component) && !isNoise(component));

  const push = (component: ComponentReport, name: string): void => {
    const status = rowStatus(component, report.findings);
    const found = component.version ?? component.range ?? (status === 'missing' ? 'missing' : '—');
    rows.push({
      status: status === 'missing' ? 'warning' : status,
      name: shortName(name),
      found: found.length > COL_FOUND ? found.slice(0, COL_FOUND) : found,
      expected: expectedOf(component, report.findings),
    });
  };

  for (const component of rest) {
    const interesting = KEEP.test(component.label) || KEEP.test(component.id) || component.status === 'conflict' || component.status === 'warning' || component.status === 'missing';
    if (!interesting) continue;
    push(component, component.label);
  }

  if (js.length > 0) {
    const versions = [...new Set(js.map((component) => component.version).filter(Boolean))];
    const skewed = report.findings.some((finding) => finding.code === 'midnight-js-skew') || versions.length > 1;
    const sample = js[0];
    rows.push({
      status: skewed ? 'conflict' : rowStatus(sample, report.findings),
      name: 'midnight-js',
      found: skewed ? 'mixed' : (sample.version ?? '—'),
      expected: skewed ? 'same' : expectedOf(sample, report.findings),
    });
  }

  return rows;
}

function statusCell(status: TableRow['status'], ascii: boolean): { text: string; tone: string } {
  if (status === 'conflict') {
    return { text: ascii ? '[x]' : '✗ conflict', tone: ANSI.redBold };
  }
  if (status === 'warning') {
    return { text: ascii ? '[warn]' : '! warn', tone: ANSI.yellow };
  }
  return { text: ascii ? '[ok]' : '✓ ok', tone: ANSI.green };
}

function rule(ascii: boolean, color: boolean): string {
  const line = (ascii ? '-' : '─').repeat(58);
  return paint(line, ANSI.dim, color);
}

function explain(finding: Finding): { title: string; body: string; fixes: string[] } {
  const fixes = commandsIn(finding.message);
  if (finding.code === 'matches-older-matrix' && !fixes.includes('mn-doctor fix')) {
    fixes.push('mn-doctor fix');
  }
  if (finding.code === 'pragma-ledger-mismatch' || finding.code === 'pragma-compiler-mismatch') {
    const language = firstVersion(finding.expected);
    if (language) {
      const token = language.split('.').slice(0, 2).join('.');
      fixes.push(`pragma language_version ${token}`);
    }
  }
  if (finding.code === 'proof-server-unpinned' || finding.code === 'proof-server-patch' || finding.code === 'proof-server-ledger-mismatch') {
    const image = finding.expected ? `midnightntwrk/proof-server:${finding.expected}` : '';
    if (image && !fixes.some((item) => item.includes('proof-server'))) fixes.push(image);
  }
  const title =
    finding.code === 'compiler-runtime-mismatch'
      ? 'Compiler and compact-runtime are on different versions'
      : finding.code === 'compiler-ledger-mismatch' || finding.code === 'pragma-ledger-mismatch'
        ? 'This targets a ledger the network does not run'
        : finding.code === 'midnight-js-skew'
          ? 'Midnight.js packages are on different versions'
          : finding.code === 'exact-pin'
            ? `${finding.component} is not the version Midnight.js requires`
            : finding.code === 'floating-range'
              ? 'A version range can install a breaking release'
              : finding.code === 'matches-older-matrix'
                ? 'This matches an older official set'
                : finding.code === 'compiler-not-found'
                  ? 'No Compact compiler was found'
                  : sentences(finding.message, 1).replace(/\.$/, '');
  return { title, body: sentences(finding.message, 2), fixes };
}

export function formatReport(report: Report, color: boolean, options: FormatOptions = {}): string {
  const ascii = Boolean(options.ascii);
  const lines: string[] = [];
  const name = paint('mn-doctor', ANSI.bold, color);
  const rest = ` ${report.version} · ${shortPath(report.projectRoot)} · ${report.network}`;
  lines.push(name + rest);
  lines.push('');

  const header = pad('STATUS', COL_STATUS) + pad('COMPONENT', COL_NAME) + pad('FOUND', COL_FOUND) + 'EXPECTED';
  lines.push(paint(header, ANSI.dim, color));

  const rows = tableRows(report);
  if (rows.length === 0) {
    lines.push('(no Midnight components found)');
  }
  for (const row of rows) {
    const displayStatus = row.found === row.expected && row.status === 'conflict' ? 'ok' : row.status;
    const cell = statusCell(displayStatus, ascii);
    const status = paint(pad(cell.text, COL_STATUS), cell.tone, color);
    const foundTone = displayStatus === 'conflict' ? ANSI.redBold : displayStatus === 'warning' ? ANSI.yellow : '';
    const found = paint(pad(row.found, COL_FOUND), foundTone, color && foundTone !== '');
    const expectedTone = row.found === row.expected ? ANSI.dim : '';
    const expected = paint(row.expected, expectedTone, color && expectedTone !== '');
    lines.push(status + pad(row.name, COL_NAME) + found + expected);
  }

  const problems = report.findings.filter((finding) => finding.severity === 'error' || finding.severity === 'warning');
  if (problems.length > 0) {
    lines.push('');
    lines.push(rule(ascii, color));
    lines.push('');
    for (const finding of problems) {
      const item = explain(finding);
      const mark = finding.severity === 'error' ? (ascii ? '[x]' : '✗') : ascii ? '[!]' : '!';
      const tone = finding.severity === 'error' ? ANSI.redBold : ANSI.yellow;
      lines.push(paint(`${mark} ${item.title}`, tone, color));
      for (const line of wrap(item.body, WIDTH, '  ')) lines.push(line);
      for (const fix of item.fixes) {
        const label = paint('  fix  ', ANSI.bold, color);
        lines.push(label + fix);
      }
      lines.push('');
    }
    lines.push(rule(ascii, color));
  } else if (rows.length > 0) {
    lines.push('');
  }

  const conflicts = report.summary.errors;
  const warnings = report.summary.warnings;
  const ok = rows.filter((row) => (row.found === row.expected && row.status === 'conflict' ? 'ok' : row.status) === 'ok').length;
  const summary = `${conflicts} conflict${conflicts === 1 ? '' : 's'} · ${warnings} warning${warnings === 1 ? '' : 's'} · ${ok} ok`;
  lines.push(summary);

  lines.push('');
  if (conflicts > 0) {
    lines.push('Run mn-doctor fix to see the diff. Nothing is written until you confirm.');
  } else if (warnings > 0) {
    lines.push('Nothing here blocks a deploy. Run mn-doctor fix to move to the docs set.');
  } else if (ok > 0) {
    lines.push(`Clean bill of health. ${ok} of ${ok} components are on matching versions.`);
  } else {
    lines.push('Nothing to check. Add a Compact file or a Midnight package and run this again.');
  }

  if (report.disagreements.length > 0) {
    lines.push('');
    lines.push('Official sources disagree. This does not fail the check.');
    for (const row of report.disagreements) {
      const line = `  ${row.component}: docs ${row.docs}; sdk ${row.sdk}`;
      lines.push(line.length <= WIDTH ? line : `${line.slice(0, WIDTH - 1)}…`);
    }
  }

  for (const finding of report.findings.filter((item) => item.severity === 'info' && item.code !== 'multiple-lockfiles')) {
    lines.push('');
    for (const line of wrap(finding.message, WIDTH, '')) lines.push(line);
  }

  return lines
    .map((line) => (visibleLength(line) > WIDTH ? line : line))
    .join('\n');
}

export function formatPlan(plan: FixPlan, color: boolean, applied: boolean): string {
  const lines: string[] = [];
  lines.push(`${paint('mn-doctor fix', ANSI.bold, color)} · ${plan.stackId}`);
  lines.push('');
  if (plan.edits.length === 0) {
    lines.push('No file changes.');
  } else {
    lines.push(applied ? 'Applied' : 'Proposed diff');
    lines.push('');
    for (const edit of plan.edits) {
      lines.push(edit.diff);
      lines.push('');
    }
  }
  if (plan.commands.length > 0) {
    lines.push('Run these yourself. mn-doctor does not execute them.');
    for (const command of plan.commands) lines.push(`  fix  ${command}`);
  }
  for (const note of plan.notes) {
    for (const line of wrap(note, WIDTH, '')) lines.push(line);
  }
  if (!applied && plan.edits.length > 0) {
    lines.push('');
    lines.push('Nothing was written. Re-run with --yes, or confirm to apply.');
  }
  return lines.join('\n');
}
