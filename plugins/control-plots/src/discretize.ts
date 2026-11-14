/**
 * `c2d` (SPECS 13.3, discrete time): a continuous transfer function sampled every Ts
 * seconds, by a zero-order hold (MATLAB's default) or the bilinear (Tustin) transform.
 * Results are normalized so the denominator is monic, as MATLAB's are.
 */
import { expm, type Matrix } from './expm';
import { add, degree, mul, scale, trim, type Poly, type Tf } from './poly';

export type Method = 'zoh' | 'tustin';

export class ImproperForC2dError extends Error {}

/** The characteristic polynomial det(zI − A), by the Faddeev–LeVerrier recursion (small n). */
export function charpoly(A: Matrix): Poly {
  const n = A.length;
  const c = [1];
  let M: Matrix = A.map((r) => r.map(() => 0));
  for (let k = 1; k <= n; k++) {
    // M_k = A · M_{k-1} + c_{k-1} I, c_k = −tr(A · M_k) / k.
    const next: Matrix = A.map((row) => row.map((_, j) => row.reduce((s, a, l) => s + a * M[l]![j]!, 0)));
    for (let i = 0; i < n; i++) next[i]![i]! += c[k - 1]!;
    M = next;
    let tr = 0;
    for (let i = 0; i < n; i++) for (let l = 0; l < n; l++) tr += A[i]![l]! * M[l]![i]!;
    c.push(-tr / k);
  }
  return c;
}

/**
 * Zero-order hold: the controllable canonical realization (A, B, C, D) sampled exactly,
 * Ad = e^{A·Ts}, Bd = ∫ e^{A·t} dt · B (the matrix exponential of [[A, B], [0, 0]] · Ts),
 * then back to a transfer function as MATLAB's ss2tf does:
 * num = det(zI − Ad + Bd·C) + (D − 1) · det(zI − Ad).
 */
function zoh(tf: Tf, Ts: number): Tf {
  const num = trim(tf.num);
  const den = trim(tf.den);
  const n = den.length - 1;
  const a = den.map((c) => c / den[0]!);
  const b = [...new Array<number>(n + 1 - num.length).fill(0), ...num.map((c) => c / den[0]!)];
  const D = b[0]!;
  if (n === 0) return { num: [D], den: [1] };
  const C = Array.from({ length: n }, (_, i) => b[i + 1]! - D * a[i + 1]!);
  const M: Matrix = Array.from({ length: n + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let j = 0; j < n; j++) M[0]![j] = -a[j + 1]! * Ts;
  for (let i = 1; i < n; i++) M[i]![i - 1] = Ts;
  M[0]![n] = Ts;
  const E = expm(M);
  const Ad = E.slice(0, n).map((r) => r.slice(0, n));
  const Bd = E.slice(0, n).map((r) => r[n]!);
  const dd = charpoly(Ad);
  const closed = charpoly(Ad.map((r, i) => r.map((v, j) => v - Bd[i]! * C[j]!)));
  return { num: trim(add(closed, scale(dd, D - 1))), den: dd };
}

/** s = (2/Ts)(z − 1)/(z + 1), with both sides multiplied by (z + 1)^n. */
function tustin(tf: Tf, Ts: number): Tf {
  const num = trim(tf.num);
  const den = trim(tf.den);
  const n = den.length - 1;
  const k = 2 / Ts;
  const powers = (p: Poly, base: Poly, times: number) => {
    let out = [1];
    for (let i = 0; i < times; i++) out = mul(out, base);
    return mul(out, p);
  };
  const map = (p: Poly): Poly => {
    let out: Poly = [0];
    const m = p.length - 1;
    p.forEach((c, i) => {
      const j = m - i; // the power of s
      out = add(out, scale(powers(powers([1], [1, -1], j), [1, 1], n - j), c * k ** j));
    });
    return out;
  };
  const N = map(num);
  const Dz = map(den);
  return { num: trim(N.map((c) => c / Dz[0]! + 0)), den: Dz.map((c) => c / Dz[0]! + 0) };
}

export function c2d(tf: Tf, Ts: number, method: Method = 'zoh'): Tf {
  if (degree(tf.num) > degree(tf.den)) throw new ImproperForC2dError('c2d needs a proper system');
  return method === 'zoh' ? zoh(tf, Ts) : tustin(tf, Ts);
}
