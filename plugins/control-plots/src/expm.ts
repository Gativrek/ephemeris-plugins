/**
 * The matrix exponential for the step simulation (SPECS 13.3): scaling and squaring
 * with a [6/6] Padé approximant. Matrices are small (the system order plus one).
 */
export type Matrix = number[][];

const zeros = (n: number): Matrix => Array.from({ length: n }, () => new Array<number>(n).fill(0));
const identity = (n: number): Matrix => zeros(n).map((r, i) => r.map((_, j) => (i === j ? 1 : 0)));

export function matmul(a: Matrix, b: Matrix): Matrix {
  const n = a.length;
  const out = zeros(n);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < n; k++) {
      const aik = a[i]![k]!;
      if (aik === 0) continue;
      for (let j = 0; j < n; j++) out[i]![j]! += aik * b[k]![j]!;
    }
  return out;
}

const norm1 = (a: Matrix): number =>
  Math.max(0, ...a[0]!.map((_, j) => a.reduce((s, r) => s + Math.abs(r[j]!), 0)));

/** Solves d · x = n for x, by LU with partial pivoting. */
function solve(d: Matrix, n: Matrix): Matrix {
  const size = d.length;
  const a = d.map((r) => [...r]);
  const b = n.map((r) => [...r]);
  for (let c = 0; c < size; c++) {
    let p = c;
    for (let r = c + 1; r < size; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[p]![c]!)) p = r;
    [a[c], a[p]] = [a[p]!, a[c]!];
    [b[c], b[p]] = [b[p]!, b[c]!];
    const piv = a[c]![c]!;
    for (let r = c + 1; r < size; r++) {
      const f = a[r]![c]! / piv;
      if (f === 0) continue;
      for (let k = c; k < size; k++) a[r]![k]! -= f * a[c]![k]!;
      for (let k = 0; k < size; k++) b[r]![k]! -= f * b[c]![k]!;
    }
  }
  for (let c = size - 1; c >= 0; c--) {
    for (let k = 0; k < size; k++) {
      let s = b[c]![k]!;
      for (let j = c + 1; j < size; j++) s -= a[c]![j]! * b[j]![k]!;
      b[c]![k] = s / a[c]![c]!;
    }
  }
  return b;
}

export function expm(m: Matrix): Matrix {
  const n = m.length;
  const norm = norm1(m);
  const squarings = norm > 0.5 ? Math.ceil(Math.log2(norm / 0.5)) : 0;
  const a = m.map((r) => r.map((v) => v / 2 ** squarings));
  const q = 6;
  let c = 1;
  let num = identity(n);
  let den = identity(n);
  let power = identity(n);
  for (let k = 1; k <= q; k++) {
    c = (c * (q - k + 1)) / (k * (2 * q - k + 1));
    power = matmul(power, a);
    const sign = k % 2 === 0 ? 1 : -1;
    num = num.map((r, i) => r.map((v, j) => v + c * power[i]![j]!));
    den = den.map((r, i) => r.map((v, j) => v + sign * c * power[i]![j]!));
  }
  let out = solve(den, num);
  for (let s = 0; s < squarings; s++) out = matmul(out, out);
  return out;
}
