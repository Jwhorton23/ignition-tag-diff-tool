// Line-based text diff for script/expression bodies (PLAN.md §3.2 — the one
// place a line diff is the right tool, as opposed to the structural JSON
// diff used everywhere else). Plain O(N*M) LCS: script bodies are at most a
// few thousand lines, so this is fast enough without a Myers implementation.

export type LineDiffOp =
  | { type: 'equal'; line: string }
  | { type: 'add'; line: string }
  | { type: 'remove'; line: string };

export function diffLines(a: string, b: string): LineDiffOp[] {
  const linesA = a.split('\n');
  const linesB = b.split('\n');
  const n = linesA.length;
  const m = linesB.length;

  // dp[i][j] = length of the LCS of linesA[i..] and linesB[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        linesA[i] === linesB[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const ops: LineDiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (linesA[i] === linesB[j]) {
      ops.push({ type: 'equal', line: linesA[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: 'remove', line: linesA[i]! });
      i++;
    } else {
      ops.push({ type: 'add', line: linesB[j]! });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: 'remove', line: linesA[i]! });
    i++;
  }
  while (j < m) {
    ops.push({ type: 'add', line: linesB[j]! });
    j++;
  }
  return ops;
}
