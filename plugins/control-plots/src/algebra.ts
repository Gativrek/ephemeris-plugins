/**
 * Transfer-function arithmetic (SPECS 13.3). Nothing is cancelled, as with MATLAB's
 * `tf`, except that terms over the same denominator combine over it, so L/(1+L) gives
 * the closed loop num/(den+num), as MATLAB's `feedback` does.
 */
import { add as padd, equal, isZero, mul as pmul, scale, sub as psub, type Tf } from './poly';

export const constant = (k: number): Tf => ({ num: [k], den: [1] });
export const S: Tf = { num: [1, 0], den: [1] };

export function add(a: Tf, b: Tf): Tf {
  if (equal(a.den, b.den)) return { num: padd(a.num, b.num), den: a.den };
  return { num: padd(pmul(a.num, b.den), pmul(b.num, a.den)), den: pmul(a.den, b.den) };
}

export function sub(a: Tf, b: Tf): Tf {
  if (equal(a.den, b.den)) return { num: psub(a.num, b.num), den: a.den };
  return { num: psub(pmul(a.num, b.den), pmul(b.num, a.den)), den: pmul(a.den, b.den) };
}

export const neg = (a: Tf): Tf => ({ num: scale(a.num, -1), den: a.den });
export const mul = (a: Tf, b: Tf): Tf => ({ num: pmul(a.num, b.num), den: pmul(a.den, b.den) });

export function div(a: Tf, b: Tf): Tf {
  if (isZero(b.num)) throw new Error('Division by zero.');
  if (equal(a.den, b.den)) return { num: a.num, den: b.num };
  return { num: pmul(a.num, b.den), den: pmul(a.den, b.num) };
}

export function pow(a: Tf, n: number): Tf {
  let out = constant(1);
  for (let i = 0; i < n; i++) out = mul(out, a);
  return out;
}
