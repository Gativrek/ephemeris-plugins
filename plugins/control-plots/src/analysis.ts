/**
 * Frequency response, margins, stability and the step response (SPECS 13.3).
 *
 * Phase follows MATLAB's `bode`: the sum of each factor's angle (the gain's sign, plus
 * every zero's, minus every pole's), so it is continuous and starts on MATLAB's
 * branch (a right-half-plane zero starts near +360°, 1/s² at -180°). Magnitude is
 * evaluated by Horner's method.
 */
import { expm, type Matrix } from './expm';
import { cabs, degree, evalAt, trim, type Complex, type Tf } from './poly';
import { roots } from './roots';

export interface Analysis {
  tf: Tf;
  poles: Complex[];
  zeros: Complex[];
  /** 180 for a negative gain, else 0. */
  gainPhase: number;
}

const DEG = 180 / Math.PI;

export function analyze(tf: Tf): Analysis {
  const num = trim(tf.num);
  const den = trim(tf.den);
  return {
    tf: { num, den },
    poles: roots(den),
    zeros: roots(num),
    gainPhase: num[0]! / den[0]! < 0 ? 180 : 0,
  };
}

export function magDb(a: Analysis, w: number): number {
  const z = { re: 0, im: w };
  return 20 * Math.log10(cabs(evalAt(a.tf.num, z)) / cabs(evalAt(a.tf.den, z)));
}

/** Degrees; continuous in w except where a root sits on the imaginary axis. */
export function phaseDeg(a: Analysis, w: number): number {
  let p = a.gainPhase;
  // At w = 0 a root at the origin contributes its limit from above, 90°.
  const arg = (r: Complex) => (w === 0 && r.re === 0 && r.im === 0 ? 90 : Math.atan2(w - r.im, -r.re) * DEG);
  for (const z of a.zeros) p += arg(z);
  for (const q of a.poles) p -= arg(q);
  return p;
}

export function logspace(lo: number, hi: number, n: number): number[] {
  const a = Math.log10(lo);
  const b = Math.log10(hi);
  return Array.from({ length: n }, (_, i) => 10 ** (a + ((b - a) * i) / (n - 1)));
}

export function bode(a: Analysis, ws: number[]): { magDb: number[]; phaseDeg: number[] } {
  const ph = ws.map((w) => phaseDeg(a, w));
  for (let i = 1; i < ph.length; i++) {
    while (ph[i]! - ph[i - 1]! > 180) ph[i]! -= 360;
    while (ph[i]! - ph[i - 1]! < -180) ph[i]! += 360;
  }
  return { magDb: ws.map((w) => magDb(a, w)), phaseDeg: ph };
}

function rootMagnitudes(list: Analysis[]): number[] {
  return list.flatMap((a) => [...a.poles, ...a.zeros].map(cabs).filter((m) => m > 0));
}

/** 10^k exactly (10 ** -4 is not 1e-4 in floating point). */
const decade = (k: number) => Number(`1e${k}`);

/** Two decades beyond the pole and zero magnitudes, rounded out to whole decades (rad/s). */
export function autoRange(list: Analysis[]): [number, number] {
  const m = rootMagnitudes(list);
  if (!m.length) return [1e-2, 1e2];
  return [
    decade(Math.floor(Math.log10(Math.min(...m))) - 2),
    decade(Math.ceil(Math.log10(Math.max(...m))) + 2),
  ];
}

// ---- Margins -------------------------------------------------------------------

export interface Margins {
  /** Gain margin in dB; Infinity when there is none. */
  gmDb: number;
  /** Phase crossover; NaN when the phase never reaches -180°, Infinity when only at infinity. */
  wcg: number;
  /** Phase margin in degrees, in [-180, 180); Infinity when the gain never crosses 0 dB. */
  pmDeg: number;
  wcp: number;
}

const wrap180 = (x: number) => x - 360 * Math.floor((x + 180) / 360);
const near = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(y));

function bisect(f: (w: number) => number, lo: number, hi: number): number {
  let a = Math.log10(lo);
  let b = Math.log10(hi);
  const fa = f(lo);
  for (let i = 0; i < 80; i++) {
    const m = (a + b) / 2;
    if (Math.sign(f(10 ** m)) === Math.sign(fa)) a = m;
    else b = m;
  }
  return 10 ** ((a + b) / 2);
}

/** As MATLAB's `margin`: with several crossings, the smallest margin of each kind. */
export function margins(a: Analysis): Margins {
  const m = rootMagnitudes([a]);
  const lo = 10 ** (Math.floor(Math.log10(m.length ? Math.min(...m) : 1)) - 4);
  const hi = 10 ** (Math.ceil(Math.log10(m.length ? Math.max(...m) : 1)) + 4);
  const ws = logspace(lo, hi, 4000);
  const mags = ws.map((w) => magDb(a, w));
  const phs = ws.map((w) => phaseDeg(a, w));
  const nz = a.zeros.length;
  const np = a.poles.length;
  const atOrigin = (rs: Complex[]) => rs.filter((r) => r.re === 0 && r.im === 0).length;
  const finiteAtZero = atOrigin(a.zeros) === 0 && atOrigin(a.poles) === 0;
  const phaseInf = a.gainPhase + 90 * (nz - np);
  const highGain = Math.abs(a.tf.num[0]! / a.tf.den[0]!);

  // Gain crossovers.
  const pm: Array<{ pm: number; w: number }> = [];
  if (finiteAtZero && Math.abs(magDb(a, 0)) < 1e-9) pm.push({ pm: wrap180(phaseDeg(a, 0) + 180), w: 0 });
  for (let i = 0; i + 1 < ws.length; i++) {
    if (mags[i] === 0) pm.push({ pm: wrap180(phs[i]! + 180), w: ws[i]! });
    else if (Math.sign(mags[i]!) * Math.sign(mags[i + 1]!) < 0) {
      const w = bisect((x) => magDb(a, x), ws[i]!, ws[i + 1]!);
      pm.push({ pm: wrap180(phaseDeg(a, w) + 180), w });
    }
  }
  if (nz === np && near(highGain, 1)) pm.push({ pm: wrap180(phaseInf + 180), w: Infinity });

  // Phase crossovers: the phase meets -180° + k·360°.
  const gm: Array<{ gm: number; w: number }> = [];
  const turns = (p: number) => (p + 180) / 360;
  const onCrossing = (p: number) => Math.abs(wrap180(p + 180)) < 1e-9;
  const flat = phs.every(onCrossing);
  if (flat) {
    // The phase sits on -180° everywhere (1/s²): the margin is smallest where |G| = 1.
    for (const c of pm) gm.push({ gm: 0, w: c.w });
    if (!gm.length) gm.push({ gm: -Math.min(...mags.map(Math.abs)), w: NaN });
  } else {
    if (finiteAtZero && onCrossing(phaseDeg(a, 0))) gm.push({ gm: -magDb(a, 0), w: 0 });
    for (let i = 0; i + 1 < ws.length; i++) {
      const k0 = Math.floor(turns(phs[i]!));
      const k1 = Math.floor(turns(phs[i + 1]!));
      if (k0 === k1) continue;
      const k = Math.max(k0, k1);
      const w = bisect((x) => turns(phaseDeg(a, x)) - k, ws[i]!, ws[i + 1]!);
      gm.push({ gm: -magDb(a, w), w });
    }
    if (onCrossing(phaseInf)) gm.push({ gm: np > nz ? Infinity : -20 * Math.log10(highGain), w: Infinity });
  }

  const bestPm = pm.reduce<{ pm: number; w: number } | null>(
    (b, c) => (!b || Math.abs(c.pm) < Math.abs(b.pm) ? c : b),
    null,
  );
  const bestGm = gm.reduce<{ gm: number; w: number } | null>(
    (b, c) => (!b || Math.abs(c.gm) < Math.abs(b.gm) ? c : b),
    null,
  );
  return {
    gmDb: bestGm ? bestGm.gm : Infinity,
    wcg: bestGm ? bestGm.w : NaN,
    pmDeg: bestPm ? bestPm.pm : Infinity,
    wcp: bestPm ? bestPm.w : NaN,
  };
}

// ---- Stability and the step response ---------------------------------------------

export type Stability = 'stable' | 'marginal' | 'unstable';

export function stability(a: Analysis): Stability {
  const tol = (p: Complex) => 1e-9 * Math.max(1, cabs(p));
  if (a.poles.some((p) => p.re > tol(p))) return 'unstable';
  if (a.poles.some((p) => Math.abs(p.re) <= tol(p))) return 'marginal';
  return 'stable';
}

/** 6 / min |Re(p)| over stable poles, in [1e-3, 1e4]; 10 s for an unstable system or one without stable poles. */
export function autoT(a: Analysis): number {
  if (stability(a) === 'unstable') return 10;
  const re = a.poles.filter((p) => p.re < -1e-9 * Math.max(1, cabs(p))).map((p) => Math.abs(p.re));
  if (!re.length) return 10;
  return Math.min(1e4, Math.max(1e-3, 6 / Math.min(...re)));
}

/** The DC gain, for the final value of a stable system. */
export function dcGain(a: Analysis): number {
  const n = a.tf.num;
  const d = a.tf.den;
  return n[n.length - 1]! / d[d.length - 1]!;
}

export class ImproperError extends Error {}

/**
 * The unit step on t = 0, T/(samples-1), …, T: controllable canonical form, discretized
 * exactly with a zero-order hold (the matrix exponential).
 */
export function stepResponse(tf: Tf, T: number, samples = 2001): number[] {
  const num = trim(tf.num);
  const den = trim(tf.den);
  if (degree(num) > degree(den)) throw new ImproperError('Step needs a proper transfer function');
  const n = den.length - 1;
  const a = den.map((c) => c / den[0]!);
  const b = [...new Array<number>(n + 1 - num.length).fill(0), ...num.map((c) => c / den[0]!)];
  const D = b[0]!;
  if (n === 0) return new Array<number>(samples).fill(D);
  const C = Array.from({ length: n }, (_, i) => b[i + 1]! - D * a[i + 1]!);
  const dt = T / (samples - 1);
  // [[A, B], [0, 0]] · dt, with A in controllable canonical form and B = e1.
  const M: Matrix = Array.from({ length: n + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let j = 0; j < n; j++) M[0]![j] = -a[j + 1]! * dt;
  for (let i = 1; i < n; i++) M[i]![i - 1] = dt;
  M[0]![n] = dt;
  const E = expm(M);
  const y = new Array<number>(samples);
  let x = new Array<number>(n).fill(0);
  for (let k = 0; k < samples; k++) {
    let out = D;
    for (let i = 0; i < n; i++) out += C[i]! * x[i]!;
    y[k] = out;
    const next = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = E[i]![n]!;
      for (let j = 0; j < n; j++) s += E[i]![j]! * x[j]!;
      next[i] = s;
    }
    x = next;
  }
  return y;
}
