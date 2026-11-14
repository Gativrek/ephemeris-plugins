/**
 * Frequency response, margins, stability and the step response (SPECS 13.3).
 *
 * Phase follows MATLAB's `bode`: the sum of each factor's angle (the gain's sign, plus
 * every zero's, minus every pole's), so it is continuous and starts on MATLAB's
 * branch (a right-half-plane zero starts near +360°, 1/s² at -180°). Magnitude is
 * evaluated by Horner's method.
 *
 * A discrete system (sample time ts) is evaluated on the unit circle, z = e^{jωTs}, up to
 * the Nyquist frequency π/Ts; its phase is the same angle sum, each factor taken on a
 * branch that is continuous along the circle, which is MATLAB's.
 */
import { expm, type Matrix } from './expm';
import { cabs, cdiv, degree, evalAt, trim, type Complex, type Tf } from './poly';
import { roots } from './roots';

export interface Analysis {
  tf: Tf;
  poles: Complex[];
  zeros: Complex[];
  /** 180 for a negative gain, else 0. */
  gainPhase: number;
  /** Sample time in seconds; null for a continuous system. */
  ts: number | null;
}

const DEG = 180 / Math.PI;

export function analyze(tf: Tf, ts: number | null = null): Analysis {
  const num = trim(tf.num);
  const den = trim(tf.den);
  return {
    tf: { num, den },
    poles: roots(den),
    zeros: roots(num),
    gainPhase: num[0]! / den[0]! < 0 ? 180 : 0,
    ts,
  };
}

/** The Nyquist frequency π/Ts in rad/s. */
export const nyquist = (ts: number): number => Math.PI / ts;

/** Where the response is evaluated: s = jω, or z = e^{jωTs}. */
function point(a: Analysis, w: number): Complex {
  return a.ts === null ? { re: 0, im: w } : { re: Math.cos(w * a.ts), im: Math.sin(w * a.ts) };
}

export function magDb(a: Analysis, w: number): number {
  const z = point(a, w);
  return 20 * Math.log10(cabs(evalAt(a.tf.num, z)) / cabs(evalAt(a.tf.den, z)));
}

/** Degrees; continuous in w except where a root sits on the imaginary axis. */
export function phaseDeg(a: Analysis, w: number): number {
  if (a.ts !== null) return discretePhaseDeg(a, w, a.ts);
  let p = a.gainPhase;
  // At w = 0 a root at the origin contributes its limit from above, 90°.
  const arg = (r: Complex) => (w === 0 && r.re === 0 && r.im === 0 ? 90 : Math.atan2(w - r.im, -r.re) * DEG);
  for (const z of a.zeros) p += arg(z);
  for (const q of a.poles) p -= arg(q);
  return p;
}

const onCircle = (r: Complex) => Math.abs(cabs(r) - 1) < 1e-9;
const atOne = (r: Complex) => Math.hypot(r.re - 1, r.im) < 1e-9;

/**
 * arg(e^{jθ} − r) with θ = ωTs, continuous in θ on [0, π]: inside the circle it is
 * θ + arg(1 − r·e^{−jθ}) (a factor with positive real part); outside, arg(−r) +
 * arg(1 − e^{jθ}/r); on it, at r = e^{jφ}, (θ + φ)/2 ± 90°, the sign flipping as θ passes
 * φ (the limit from above at θ = 0, from below elsewhere).
 */
function circleArg(r: Complex, w: number, ts: number): number {
  const th = w * ts;
  const c = Math.cos(th);
  const s = Math.sin(th);
  if (onCircle(r)) {
    const phi = Math.atan2(r.im, r.re);
    const above = th > phi || (th === phi && w === 0);
    return ((th + phi) / 2) * DEG + (above ? 90 : -90);
  }
  if (cabs(r) < 1) {
    // 1 − r·e^{−jθ}
    const re = 1 - (r.re * c + r.im * s);
    const im = -(r.im * c - r.re * s);
    return (th + Math.atan2(im, re)) * DEG;
  }
  // 1 − e^{jθ}/r
  const q = cdiv({ re: c, im: s }, r);
  // 0 − x, not −x: a real root has im = 0, and atan2(−0, −1) is −π where MATLAB has +π.
  return (Math.atan2(0 - r.im, 0 - r.re) + Math.atan2(0 - q.im, 1 - q.re)) * DEG;
}

function discretePhaseDeg(a: Analysis, w: number, ts: number): number {
  let p = a.gainPhase;
  for (const z of a.zeros) p += circleArg(z, w, ts);
  for (const q of a.poles) p -= circleArg(q, w, ts);
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

/**
 * A discrete root's frequency as a continuous one would have it, |ln r| / Ts; none for a
 * root at 0 or at 1.
 */
function discreteFrequencies(a: Analysis): number[] {
  const ts = a.ts!;
  return [...a.poles, ...a.zeros]
    .filter((r) => cabs(r) > 0 && !atOne(r))
    .map((r) => Math.hypot(Math.log(cabs(r)), Math.atan2(r.im, r.re)) / ts);
}

/**
 * Two decades beyond the pole and zero magnitudes, rounded out to whole decades (rad/s).
 * A discrete system's range ends at its Nyquist frequency and starts two decades below
 * its slowest root (three below the Nyquist frequency when it has none).
 */
export function autoRange(list: Analysis[]): [number, number] {
  const cont = list.filter((a) => a.ts === null);
  const disc = list.filter((a) => a.ts !== null);
  const los: number[] = [];
  const his: number[] = [];
  if (cont.length || !disc.length) {
    const m = rootMagnitudes(cont);
    if (!m.length) {
      los.push(1e-2);
      his.push(1e2);
    } else {
      los.push(decade(Math.floor(Math.log10(Math.min(...m))) - 2));
      his.push(decade(Math.ceil(Math.log10(Math.max(...m))) + 2));
    }
  }
  for (const a of disc) {
    const nyq = nyquist(a.ts!);
    const f = discreteFrequencies(a).filter((v) => v < nyq);
    los.push(decade(Math.floor(Math.log10(f.length ? Math.min(...f) : nyq)) - (f.length ? 2 : 3)));
    his.push(nyq);
  }
  return [Math.min(...los), Math.max(...his)];
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
  if (a.ts !== null) return discreteMargins(a, a.ts);
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
  return smallest(pm, gm);
}

/**
 * The same solving on [0, π/Ts]: crossovers at ω = 0 and at the Nyquist frequency count,
 * as in MATLAB's `margin` for a sampled system.
 */
function discreteMargins(a: Analysis, ts: number): Margins {
  const nyq = nyquist(ts);
  const f = discreteFrequencies(a).filter((v) => v < nyq);
  const lo = Math.min(10 ** (Math.floor(Math.log10(f.length ? Math.min(...f) : nyq)) - 4), nyq * 1e-6);
  const ws = logspace(lo, nyq, 4000);
  ws[ws.length - 1] = nyq;
  const mags = ws.map((w) => magDb(a, w));
  const phs = ws.map((w) => phaseDeg(a, w));
  const finiteAtZero = ![...a.poles, ...a.zeros].some(atOne);
  const turns = (p: number) => (p + 180) / 360;
  const onCrossing = (p: number) => Math.abs(wrap180(p + 180)) < 1e-9;
  const last = ws.length - 1;

  const pm: Array<{ pm: number; w: number }> = [];
  if (finiteAtZero && Math.abs(magDb(a, 0)) < 1e-9) pm.push({ pm: wrap180(phaseDeg(a, 0) + 180), w: 0 });
  for (let i = 0; i < last; i++) {
    if (mags[i] === 0) pm.push({ pm: wrap180(phs[i]! + 180), w: ws[i]! });
    else if (Math.sign(mags[i]!) * Math.sign(mags[i + 1]!) < 0) {
      const w = bisect((x) => magDb(a, x), ws[i]!, ws[i + 1]!);
      pm.push({ pm: wrap180(phaseDeg(a, w) + 180), w });
    }
  }
  if (Math.abs(mags[last]!) < 1e-9) pm.push({ pm: wrap180(phs[last]! + 180), w: nyq });

  const gm: Array<{ gm: number; w: number }> = [];
  if (phs.every(onCrossing)) {
    for (const c of pm) gm.push({ gm: 0, w: c.w });
    if (!gm.length) gm.push({ gm: -Math.min(...mags.map(Math.abs)), w: NaN });
  } else {
    if (finiteAtZero && onCrossing(phaseDeg(a, 0))) gm.push({ gm: -magDb(a, 0), w: 0 });
    for (let i = 0; i < last; i++) {
      const k0 = Math.floor(turns(phs[i]!));
      const k1 = Math.floor(turns(phs[i + 1]!));
      if (k0 === k1) continue;
      const k = Math.max(k0, k1);
      const w = bisect((x) => turns(phaseDeg(a, x)) - k, ws[i]!, ws[i + 1]!);
      gm.push({ gm: -magDb(a, w), w });
    }
    if (onCrossing(phs[last]!)) gm.push({ gm: -mags[last]!, w: nyq });
  }
  return smallest(pm, gm);
}

function smallest(pm: Array<{ pm: number; w: number }>, gm: Array<{ gm: number; w: number }>): Margins {
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
  if (a.ts !== null) {
    if (a.poles.some((p) => cabs(p) > 1 + 1e-9)) return 'unstable';
    if (a.poles.some((p) => cabs(p) >= 1 - 1e-9)) return 'marginal';
    return 'stable';
  }
  const tol = (p: Complex) => 1e-9 * Math.max(1, cabs(p));
  if (a.poles.some((p) => p.re > tol(p))) return 'unstable';
  if (a.poles.some((p) => Math.abs(p.re) <= tol(p))) return 'marginal';
  return 'stable';
}

/** 6 / min |Re(p)| over stable poles, in [1e-3, 1e4]; 10 s for an unstable system or one without stable poles. */
export function autoT(a: Analysis): number {
  if (a.ts !== null) return autoSteps(a) * a.ts;
  if (stability(a) === 'unstable') return 10;
  const re = a.poles.filter((p) => p.re < -1e-9 * Math.max(1, cabs(p))).map((p) => Math.abs(p.re));
  if (!re.length) return 10;
  return Math.min(1e4, Math.max(1e-3, 6 / Math.min(...re)));
}

/**
 * A discrete system's window in samples: until the slowest stable pole decays to 0.2%
 * (|p|^k < 0.002), in [20, 10000]; 10 s of samples when it is unstable or has no stable pole.
 */
export function autoSteps(a: Analysis): number {
  const clamp = (k: number) => Math.min(10000, Math.max(20, Math.ceil(k)));
  const inside = a.poles.map(cabs).filter((m) => m < 1 - 1e-9);
  if (stability(a) === 'unstable' || !inside.length) return clamp(10 / a.ts! - 1e-9);
  const slowest = Math.max(...inside);
  return slowest <= 0 ? 20 : clamp(Math.log(0.002) / Math.log(slowest));
}

/** The DC gain, for the final value of a stable system: G(0), or G(1) when discrete. */
export function dcGain(a: Analysis): number {
  const n = a.tf.num;
  const d = a.tf.den;
  if (a.ts !== null) return n.reduce((s, c) => s + c, 0) / d.reduce((s, c) => s + c, 0);
  return n[n.length - 1]! / d[d.length - 1]!;
}

/**
 * A discrete system's unit step on k = 0 … samples − 1: the difference equation, exactly,
 * a0·y[k] = Σ b_i·u[k − i] − Σ_{i ≥ 1} a_i·y[k − i], with u = 1 from k = 0.
 */
export function stepDiscrete(tf: Tf, samples: number): number[] {
  const num = trim(tf.num);
  const den = trim(tf.den);
  if (degree(num) > degree(den)) throw new ImproperError('Step needs a proper transfer function');
  const n = den.length - 1;
  const a = den.map((c) => c / den[0]!);
  const b = [...new Array<number>(n + 1 - num.length).fill(0), ...num.map((c) => c / den[0]!)];
  const y = new Array<number>(samples).fill(0);
  let input = 0;
  for (let k = 0; k < samples; k++) {
    if (k <= n) input += b[k]!;
    let v = input;
    for (let i = 1; i <= Math.min(n, k); i++) v -= a[i]! * y[k - i]!;
    y[k] = v;
  }
  return y;
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
