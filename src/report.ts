import type { FixPlan, Report } from './types.js';

const COLORS = {
  red: '31',
  green: '32',
  yellow: '33',
  cyan: '36',
  dim: '2',
  bold: '1',
};

function paint(text: string, code: string, enabled: boolean): string {
  if (!enabled) return text;
  return `\u001b[${code}m${text}\u001b[0m`;
}

function statusWord(status: Report['components'][number]['status'], color: boolean): string {
  const tone =
    status === 'ok'
      ? COLORS.green
      : status === 'conflict'
        ? COLORS.red
        : status === 'info'
          ? COLORS.dim
          : COLORS.yellow;
  const padded = status.padEnd(8, ' ');
  return paint(padded, tone, color);
}

export function formatReport(report: Report, color: boolean): string {
  const lines: string[] = [];
  const title = paint('mn-doctor check', COLORS.bold, color);
  lines.push(title);
  lines.push(`Project   ${report.projectRoot}`);
  lines.push(
    `Network   ${report.network} · public networks in this data set run ledger ${report.networkLedgerMajor}`,
  );
  lines.push('');
  lines.push(paint('Components', COLORS.bold, color));
  if (report.components.length === 0) {
    lines.push('  (none found)');
  }
  for (const row of report.components) {
    const version = row.version ?? row.range ?? '—';
    const ledger = row.ledgerMajor === null ? '' : `ledger ${row.ledgerMajor}`;
    lines.push(
      `  ${statusWord(row.status, color).padEnd(color ? 16 : 8)}  ${row.label}`,
    );
    lines.push(`           ${version}${ledger ? ` · ${ledger}` : ''}${row.file ? ` · ${row.file}` : ''}`);
    if (row.detail) lines.push(`           ${row.detail}`);
  }

  const errors = report.findings.filter((finding) => finding.severity === 'error');
  const warnings = report.findings.filter((finding) => finding.severity === 'warning');
  const infos = report.findings.filter((finding) => finding.severity === 'info');

  const section = (label: string, items: typeof errors, tone: string): void => {
    if (items.length === 0) return;
    lines.push('');
    lines.push(paint(label, tone, color));
    for (const finding of items) {
      lines.push(`  ${finding.message}`);
    }
  };
  section('Conflicts', errors, COLORS.red);
  section('Warnings', warnings, COLORS.yellow);
  section('Notes', infos, COLORS.dim);

  lines.push('');
  lines.push(paint('Where the official sources disagree', COLORS.bold, color));
  lines.push('  These rows are context. They do not by themselves fail the check.');
  for (const row of report.disagreements) {
    lines.push(`  ${row.component}`);
    lines.push(`    docs  ${row.docs}`);
    lines.push(`    sdk   ${row.sdk}`);
    lines.push(`    ${row.detail}`);
  }
  lines.push('');
  lines.push(paint('Where those sources agree', COLORS.bold, color));
  for (const row of report.agreements) {
    lines.push(`  ${row.component}  ${row.version}`);
  }

  lines.push('');
  const result = report.ok
    ? paint('Result    no conflicts', COLORS.green, color)
    : paint(`Result    ${report.summary.errors} conflict(s)`, COLORS.red, color);
  lines.push(result);
  lines.push(
    `          ${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.infos} note(s)${report.strict ? ' · strict' : ''}`,
  );
  lines.push('Data');
  for (const source of report.sources) {
    const dated = source.statedUpdated
      ? `page says updated ${source.statedUpdated}, fetched ${source.fetchedAt}`
      : `fetched ${source.fetchedAt}`;
    lines.push(`  ${source.title} (${dated})`);
    lines.push(`  ${source.url}`);
  }
  return lines.join('\n');
}

export function formatPlan(plan: FixPlan, color: boolean, applied: boolean): string {
  const lines: string[] = [];
  lines.push(paint('mn-doctor fix', COLORS.bold, color));
  lines.push(`Known-good set   ${plan.stackId}`);
  if (plan.edits.length === 0) {
    lines.push('File changes     none');
  } else {
    lines.push('');
    lines.push(paint(applied ? 'Applied' : 'Proposed diff', COLORS.bold, color));
    for (const edit of plan.edits) {
      lines.push(edit.diff);
      lines.push('');
    }
  }
  if (plan.commands.length > 0) {
    lines.push(paint('Commands to run yourself', COLORS.bold, color));
    for (const command of plan.commands) lines.push(`  ${command}`);
  } else {
    lines.push('Compiler pin     already matches the known-good compiler.');
  }
  if (plan.notes.length > 0) {
    lines.push('');
    lines.push(paint('Notes', COLORS.bold, color));
    for (const note of plan.notes) lines.push(`  ${note}`);
  }
  if (!applied && plan.edits.length > 0) {
    lines.push('');
    lines.push('Nothing was written. Re-run with --yes to apply the file edits.');
  }
  return lines.join('\n');
}
