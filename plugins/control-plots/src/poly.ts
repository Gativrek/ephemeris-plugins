/**
 * Polynomials as coefficient arrays, highest power first (MATLAB's convention:
 * [1 3 2] is s^2 + 3s + 2), complex numbers as { re, im }, and transfer functions as
 * a numerator over a denominator.
 */

export type Poly = number[];

export interface Complex {
  re: number;
  im: number;
}

export interface Tf {
  num: Poly;
  den: Poly;
}

/** Drops leading zero coefficients; the zero polynomial is [0]. */
export function trim(p: Poly): Poly {
  let i = 0;
  while (i < p.length - 1 && p[i] === 0) i++;
  return p.length ? p.slice(i) : [0];
}

export const degree = (p: Poly): number => trim(p).length - 1;
export const isZero = (p: Poly): boolean => trim(p).every((c) => c === 0);

export function add(a: Poly, b: Poly): Poly {
  const n = Math.max(a.length, b.length);
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < a.length; i++) out[n - a.length + i]! += a[i]!;
  for (let i = 0; i < b.length; i++) out[n - b.length + i]! += b[i]!;
  return trim(out);
}

/** `+ 0` turns -0 into 0. */
export const scale = (p: Poly, k: number): Poly => trim(p.map((c) => c * k + 0));
export const sub = (a: Poly, b: Poly): Poly => add(a, scale(b, -1));

export function mul(a: Poly, b: Poly): Poly {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j]! += a[i]! * b[j]!;
  return trim(out);
}

export function equal(a: Poly, b: Poly): boolean {
  const x = trim(a);
  const y = trim(b);
  return x.length === y.length && x.every((c, i) => c === y[i]);
}

/** p(z) by Horner's method. */
export function evalAt(p: Poly, z: Complex): Complex {
  let re = 0;
  let im = 0;
  for (const c of p) {
    const r = re * z.re - im * z.im + c;
    im = re * z.im + im * z.re;
    re = r;
  }
  return { re, im };
}

/** p(z) and p'(z) together, by Horner's method. */
export function evalWithDerivative(p: Poly, z: Complex): [Complex, Complex] {
  let pr = 0;
  let pi = 0;
  let dr = 0;
  let di = 0;
  for (const c of p) {
    const ndr = dr * z.re - di * z.im + pr;
    di = dr * z.im + di * z.re + pi;
    dr = ndr;
    const npr = pr * z.re - pi * z.im + c;
    pi = pr * z.im + pi * z.re;
    pr = npr;
  }
  return [
    { re: pr, im: pi },
    { re: dr, im: di },
  ];
}

export const cabs = (z: Complex): number => Math.hypot(z.re, z.im);

export function cdiv(a: Complex, b: Complex): Complex {
  // Smith's algorithm, to avoid overflow.
  if (Math.abs(b.re) >= Math.abs(b.im)) {
    const r = b.im / b.re;
    const d = b.re + b.im * r;
    return { re: (a.re + a.im * r) / d, im: (a.im - a.re * r) / d };
  }
  const r = b.re / b.im;
  const d = b.re * r + b.im;
  return { re: (a.re * r + a.im) / d, im: (a.im * r - a.re) / d };
}
