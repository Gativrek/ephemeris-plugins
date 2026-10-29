/**
 * Largest-Triangle-Three-Buckets downsampling (Steinarsson, 2013): keeps the samples that
 * shape a line, for drawing series longer than THRESHOLD (SPECS 13.4). Gaps (non-finite
 * values) are kept as gaps: each run between them gets a share of the budget.
 */

export const THRESHOLD = 5000;

/** Indices to draw for one finite run [from, to), at most `n` of them, ends included. */
function bucketRun(xs: number[], ys: number[], from: number, to: number, n: number, out: number[]): void {
  const len = to - from;
  if (len <= n || n < 3) {
    for (let i = from; i < to; i++) out.push(i);
    return;
  }
  const every = (len - 2) / (n - 2);
  let a = from;
  out.push(a);
  for (let b = 0; b < n - 2; b++) {
    // The next bucket's average is the third point of the triangle.
    const nextStart = from + Math.floor((b + 1) * every) + 1;
    const nextEnd = Math.min(to, from + Math.floor((b + 2) * every) + 1);
    let ax = 0;
    let ay = 0;
    for (let i = nextStart; i < nextEnd; i++) {
      ax += xs[i]!;
      ay += ys[i]!;
    }
    const count = Math.max(1, nextEnd - nextStart);
    ax /= count;
    ay /= count;
    const start = from + Math.floor(b * every) + 1;
    const end = from + Math.floor((b + 1) * every) + 1;
    let best = start;
    let area = -1;
    for (let i = start; i < end; i++) {
      const s = Math.abs((xs[a]! - ax) * (ys[i]! - ys[a]!) - (xs[a]! - xs[i]!) * (ay - ys[a]!));
      if (s > area) {
        area = s;
        best = i;
      }
    }
    out.push(best);
    a = best;
  }
  out.push(to - 1);
}

/** The indices of `xs`/`ys` to draw: all of them up to `threshold`, else an LTTB selection. */
export function lttb(xs: number[], ys: number[], threshold = THRESHOLD): number[] {
  const ok = (i: number) => Number.isFinite(xs[i]!) && Number.isFinite(ys[i]!);
  const runs: Array<[number, number]> = [];
  for (let i = 0; i < xs.length;) {
    while (i < xs.length && !ok(i)) i++;
    const start = i;
    while (i < xs.length && ok(i)) i++;
    if (i > start) runs.push([start, i]);
  }
  const total = runs.reduce((s, [a, b]) => s + b - a, 0);
  if (total <= threshold) return runs.flatMap(([a, b]) => Array.from({ length: b - a }, (_, k) => a + k));
  const out: number[] = [];
  for (const [a, b] of runs)
    bucketRun(xs, ys, a, b, Math.max(2, Math.round((threshold * (b - a)) / total)), out);
  return out;
}

/** The drawn samples, with NaN between runs so the line breaks at gaps. */
export function thin(xs: number[], ys: number[], threshold = THRESHOLD): { xs: number[]; ys: number[] } {
  const idx = lttb(xs, ys, threshold);
  const ox: number[] = [];
  const oy: number[] = [];
  for (let k = 0; k < idx.length; k++) {
    if (k > 0 && idx[k]! !== idx[k - 1]! + 1 && hasGap(xs, ys, idx[k - 1]!, idx[k]!)) {
      ox.push(NaN);
      oy.push(NaN);
    }
    ox.push(xs[idx[k]!]!);
    oy.push(ys[idx[k]!]!);
  }
  return { xs: ox, ys: oy };
}

function hasGap(xs: number[], ys: number[], a: number, b: number): boolean {
  for (let i = a + 1; i < b; i++) if (!Number.isFinite(xs[i]!) || !Number.isFinite(ys[i]!)) return true;
  return false;
}
