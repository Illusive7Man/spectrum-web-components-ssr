/** Minimal line-based unified diff, enough to show *where* two serialized DOM trees diverge. */

type Op = {t: ' ' | '-' | '+'; s: string};

export interface DiffOptions {
  /** Stop after this many differing (+/-) lines. Default 40. */
  maxChangedLines?: number;
  /** Unchanged lines of context around each change. Default 2. */
  context?: number;
  labelA?: string;
  labelB?: string;
}

export interface DiffResult {
  /** Unified-diff-style text (truncated to `maxChangedLines` changed lines). Empty string when equal. */
  text: string;
  removed: number;
  added: number;
  /** True if `text` was cut off. */
  truncated: boolean;
}

function editScript(A: string[], B: string[]): Op[] {
  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) start++;
  let endA = A.length;
  let endB = B.length;
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) {
    endA--;
    endB--;
  }
  const ops: Op[] = [];
  for (let i = 0; i < start; i++) ops.push({t: ' ', s: A[i]!});

  const midA = A.slice(start, endA);
  const midB = B.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  if (n * m <= 4_000_000) {
    // LCS table (lengths are bounded by min(n, m) <= 2000 here, so Uint16 is enough).
    const w = m + 1;
    const dp = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] =
          midA[i] === midB[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        ops.push({t: ' ', s: midA[i]!});
        i++;
        j++;
      } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) {
        ops.push({t: '-', s: midA[i++]!});
      } else {
        ops.push({t: '+', s: midB[j++]!});
      }
    }
    while (i < n) ops.push({t: '-', s: midA[i++]!});
    while (j < m) ops.push({t: '+', s: midB[j++]!});
  } else {
    for (const s of midA) ops.push({t: '-', s});
    for (const s of midB) ops.push({t: '+', s});
  }

  for (let i = endA; i < A.length; i++) ops.push({t: ' ', s: A[i]!});
  return ops;
}

export function unifiedDiff(a: string, b: string, options: DiffOptions = {}): DiffResult {
  const maxChanged = options.maxChangedLines ?? 40;
  const context = options.context ?? 2;
  if (a === b) return {text: '', removed: 0, added: 0, truncated: false};

  const ops = editScript(a.split('\n'), b.split('\n'));
  const removed = ops.filter((o) => o.t === '-').length;
  const added = ops.filter((o) => o.t === '+').length;

  // Mark ops to print: every change plus `context` lines around it.
  const show = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.t === ' ') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) show[k] = true;
  });

  const out: string[] = [`--- ${options.labelA ?? 'a'}`, `+++ ${options.labelB ?? 'b'}`];
  let aLine = 0;
  let bLine = 0;
  let changedPrinted = 0;
  let truncated = false;
  let gap = false;
  for (let idx = 0; idx < ops.length; idx++) {
    const op = ops[idx]!;
    if (op.t !== '+') aLine++;
    if (op.t !== '-') bLine++;
    if (!show[idx]) {
      gap = true;
      continue;
    }
    if (op.t !== ' ' && changedPrinted >= maxChanged) {
      truncated = true;
      break;
    }
    if (gap || out.length === 2) out.push(`@@ a:${aLine} b:${bLine} @@`);
    gap = false;
    out.push(`${op.t}${op.s}`);
    if (op.t !== ' ') changedPrinted++;
  }
  if (truncated) out.push(`... (${removed + added - changedPrinted} more differing lines not shown)`);
  return {text: out.join('\n'), removed, added, truncated};
}
