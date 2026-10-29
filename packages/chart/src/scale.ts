/** Scales, ticks and number formatting for the plots. */

export interface Scale {
  (v: number): number;
  domain: [number, number];
  ticks: number[];
  /** Log scales: the minor ticks between decades, for light gridlines. */
  minor: number[];
}

/** 1, 2 or 5 times a power of ten, giving about `count` ticks. */
export function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

/** Widens [lo, hi] to whole steps, so the ends are ticks. */
export function niceDomain(lo: number, hi: number, count = 5, steps?: number[]): [number, number, number] {
  if (!(hi > lo)) {
    const pad = Math.abs(lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  let step = niceStep(hi - lo, count);
  if (steps) step = steps.find((s) => (hi - lo) / s <= count + 1) ?? steps[steps.length - 1]!;
  return [Math.floor(lo / step + 1e-9) * step, Math.ceil(hi / step - 1e-9) * step, step];
}

export function linear(lo: number, hi: number, from: number, to: number, count = 5, steps?: number[]): Scale {
  const [a, b, step] = niceDomain(lo, hi, count, steps);
  const f = ((v: number) => from + ((v - a) / (b - a)) * (to - from)) as Scale;
  f.domain = [a, b];
  f.ticks = [];
  for (let v = a; v <= b + step * 1e-9; v += step) f.ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  f.minor = [];
  return f;
}

/** A linear scale over exactly [lo, hi] (no rounding out), with nice ticks inside it. */
export function fixed(lo: number, hi: number, from: number, to: number, count = 5): Scale {
  const f = ((v: number) => from + ((v - lo) / (hi - lo)) * (to - from)) as Scale;
  f.domain = [lo, hi];
  const step = niceStep(hi - lo, count);
  f.ticks = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step)
    f.ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  f.minor = [];
  return f;
}

/** A log scale over whole decades. */
export function log(lo: number, hi: number, from: number, to: number): Scale {
  const a = Math.floor(Math.log10(lo) + 1e-9);
  const b = Math.max(a + 1, Math.ceil(Math.log10(hi) - 1e-9));
  const f = ((v: number) => from + ((Math.log10(v) - a) / (b - a)) * (to - from)) as Scale;
  f.domain = [Number(`1e${a}`), Number(`1e${b}`)];
  f.ticks = [];
  f.minor = [];
  const every = Math.ceil((b - a) / 8);
  for (let k = a; k <= b; k++) {
    if ((k - a) % every === 0) f.ticks.push(Number(`1e${k}`));
    if (k < b && every === 1) for (let m = 2; m <= 9; m++) f.minor.push(m * Number(`1e${k}`));
  }
  return f;
}

/** Four significant digits; exponents outside 1e-3 … 1e5. */
export function fmt(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '−∞' : '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  const s = a < 1e-3 || a >= 1e5 ? v.toExponential(2).replace('e+', 'e') : String(Number(v.toPrecision(4)));
  return s.replace('-', '−');
}

/** Tick labels: decades as 0.01, 0.1, 1, 10 … and 1e5 beyond. */
export function tickLabel(v: number): string {
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(0).replace('e+', 'e').replace('-', '−');
  return String(Number(v.toPrecision(6))).replace('-', '−');
}
