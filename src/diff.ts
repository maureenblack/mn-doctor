/** Line-oriented unified diff. Package manifests are small, so LCS is enough. */

function lcsLines(before: string[], after: string[]): string[] {
  const n = before.length;
  const m = after.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] =
        before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      lines.push(` ${before[i]}`);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push(`-${before[i]}`);
      i += 1;
    } else {
      lines.push(`+${after[j]}`);
      j += 1;
    }
  }
  while (i < n) {
    lines.push(`-${before[i]}`);
    i += 1;
  }
  while (j < m) {
    lines.push(`+${after[j]}`);
    j += 1;
  }
  return lines;
}

export function unifiedDiff(file: string, before: string, after: string): string {
  if (before === after) return '';
  const body = lcsLines(before.split('\n'), after.split('\n'));
  return [`--- a/${file}`, `+++ b/${file}`, ...body].join('\n');
}
