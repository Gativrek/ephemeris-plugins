/**
 * Polynomial roots (SPECS 13.3): Aberth–Ehrlich iteration, then Newton polishing on
 * the original polynomial. Roots at the origin are split off exactly; real
 * coefficients give exactly conjugate pairs.
 */
import { cabs, cdiv, evalWithDerivative, trim, type Complex, type Poly } from './poly';

const MAX_ITER = 1000;

function quadratic(a: number, b: number, c: number): Complex[] {
  const disc = b * b - 4 * a * c;
  if (disc >= 0) {
    // The stable form: no cancellation between -b and the root.
    const q = -0.5 * (b + Math.sign(b || 1) * Math.sqrt(disc));
    const r1 = q / a;
    const r2 = q !== 0 ? c / q : 0;
    return [
      { re: r1, im: 0 },
      { re: r2, im: 0 },
    ];
  }
  const re = -b / (2 * a);
  const im = Math.sqrt(-disc) / (2 * Math.abs(a));
  return [
    { re, im },
    { re, im: -im },
  ];
}

function aberth(q: Poly): Complex[] {
  const n = q.length - 1;
  // Start on a circle whose radius is the geometric mean of the root magnitudes.
  const radius = Math.abs(q[n]! / q[0]!) ** (1 / n) || 1;
  const z: Complex[] = Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n + 0.4;
    return { re: radius * Math.cos(a), im: radius * Math.sin(a) };
  });
  for (let iter = 0; iter < MAX_ITER; iter++) {
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const zi = z[i]!;
      const [p, d] = evalWithDerivative(q, zi);
      if (p.re === 0 && p.im === 0) continue;
      const ratio = cdiv(p, d);
      let sr = 0;
      let si = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const inv = cdiv({ re: 1, im: 0 }, { re: zi.re - z[j]!.re, im: zi.im - z[j]!.im });
        sr += inv.re;
        si += inv.im;
      }
      // w = ratio / (1 - ratio * sum)
      const den = { re: 1 - (ratio.re * sr - ratio.im * si), im: -(ratio.re * si + ratio.im * sr) };
      const w = cdiv(ratio, den);
      z[i] = { re: zi.re - w.re, im: zi.im - w.im };
      worst = Math.max(worst, cabs(w) / Math.max(1, cabs(z[i]!)));
    }
    if (worst < 1e-16) break;
  }
  return z;
}

function polish(q: Poly, z: Complex): Complex {
  let best = z;
  let bestErr = cabs(evalWithDerivative(q, z)[0]);
  let cur = z;
  for (let k = 0; k < 4; k++) {
    const [p, d] = evalWithDerivative(q, cur);
    if (d.re === 0 && d.im === 0) break;
    const step = cdiv(p, d);
    cur = { re: cur.re - step.re, im: cur.im - step.im };
    const err = cabs(evalWithDerivative(q, cur)[0]);
    if (err < bestErr) {
      best = cur;
      bestErr = err;
    }
  }
  return best;
}

/** Makes real roots exactly real and complex roots exact conjugate pairs. */
function conjugatePairs(zs: Complex[]): Complex[] {
  const out: Complex[] = [];
  const rest = zs.map((z) => (Math.abs(z.im) <= 1e-7 * Math.max(1, cabs(z)) ? { re: z.re, im: 0 } : z));
  const upper = rest.filter((z) => z.im > 0);
  const lower = rest.filter((z) => z.im < 0);
  out.push(...rest.filter((z) => z.im === 0));
  for (const u of upper) {
    let bi = -1;
    let bd = Infinity;
    lower.forEach((l, i) => {
      const d = Math.hypot(u.re - l.re, u.im + l.im);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    if (bi < 0) {
      out.push(u);
      continue;
    }
    const [l] = lower.splice(bi, 1);
    const re = (u.re + l!.re) / 2;
    const im = (u.im - l!.im) / 2;
    out.push({ re, im }, { re, im: -im });
  }
  out.push(...lower);
  return out;
}

/** Every root of p, sorted by real part, then imaginary part. */
export function roots(poly: Poly): Complex[] {
  const p = trim(poly);
  let end = p.length;
  while (end > 1 && p[end - 1] === 0) end--;
  const atOrigin = p.length - end;
  const q = p.slice(0, end);
  let found: Complex[];
  const n = q.length - 1;
  if (n <= 0) found = [];
  else if (n === 1) found = [{ re: -q[1]! / q[0]!, im: 0 }];
  else if (n === 2) found = quadratic(q[0]!, q[1]!, q[2]!);
  else found = conjugatePairs(aberth(q).map((z) => polish(q, z)));
  for (let i = 0; i < atOrigin; i++) found.push({ re: 0, im: 0 });
  return found.sort((a, b) => a.re - b.re || a.im - b.im);
}
