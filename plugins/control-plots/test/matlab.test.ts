/**
 * The SPECS 13.3 verification: every reference system against MATLAB's own `bode`,
 * `step`, `pole`, `zero` and `margin` (test/refs, exported by test/make_refs.m), at the
 * spec's tolerances: 0.01 dB, 0.1°, 1e-4 relative for step samples, 1e-6 for roots.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyze, bode, margins, stepDiscrete, stepResponse } from '../src/analysis';
import { c2d, type Method } from '../src/discretize';
import type { Complex } from '../src/poly';

const refs = join(dirname(fileURLToPath(import.meta.url)), 'refs');

function csv(name: string): number[][] {
  const [, ...rows] = readFileSync(join(refs, name), 'utf8').trim().split(/\r?\n/);
  return rows.map((r) =>
    r.split(',').map((v) => (v === 'Inf' ? Infinity : v === '-Inf' ? -Infinity : Number(v))),
  );
}

const systems = readFileSync(join(refs, 'systems.csv'), 'utf8')
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((row) => {
    const [name, num, den, T, Ts, cnum, cden, method] = row.split(',');
    const vec = (s: string) => s.split(' ').map(Number);
    return {
      name: name!,
      tf: { num: vec(num!), den: vec(den!) },
      T: Number(T),
      ts: Number(Ts) > 0 ? Number(Ts) : null,
      source: cnum ? { tf: { num: vec(cnum), den: vec(cden!) }, method: method as Method } : null,
    };
  });

/** Coefficients aligned on the constant term, against the largest reference coefficient. */
function coefficientError(got: number[], want: number[]): number {
  const n = Math.max(got.length, want.length);
  const pad = (p: number[]) => [...new Array<number>(n - p.length).fill(0), ...p];
  const g = pad(got);
  const w = pad(want);
  const scale = Math.max(...w.map(Math.abs));
  return Math.max(...w.map((v, i) => Math.abs(g[i]! - v))) / scale;
}

describe('c2d', () => {
  it.each(systems.filter((s) => s.source))('$name: coefficients within 1e-9 relative', (s) => {
    const d = c2d(s.source!.tf, s.ts!, s.source!.method);
    expect(coefficientError(d.num, s.tf.num)).toBeLessThan(1e-9);
    expect(coefficientError(d.den, s.tf.den)).toBeLessThan(1e-9);
  });
});

/** Matches each expected root to the nearest unused computed one. */
function maxRootError(got: Complex[], want: Complex[]): number {
  expect(got.length).toBe(want.length);
  const pool = [...got];
  let worst = 0;
  for (const w of want) {
    let bi = 0;
    pool.forEach((g, i) => {
      if (Math.hypot(g.re - w.re, g.im - w.im) < Math.hypot(pool[bi]!.re - w.re, pool[bi]!.im - w.im)) bi = i;
    });
    const [g] = pool.splice(bi, 1);
    worst = Math.max(worst, Math.hypot(g!.re - w.re, g!.im - w.im) / Math.max(1, Math.hypot(w.re, w.im)));
  }
  return worst;
}

const sameOrBothNonFinite = (got: number, want: number) =>
  Number.isNaN(want) ? Number.isNaN(got) : !Number.isFinite(want) ? got === want : Number.isFinite(got);

describe.each(systems)('$name', ({ name, tf, T, ts }) => {
  const a = analyze(tf, ts);

  it('bode: magnitude within 0.01 dB, phase within 0.1°', () => {
    // Where the response is numerically zero (a Tustin zero at z = -1, at the Nyquist
    // frequency) neither magnitude nor phase is defined, and MATLAB's -344 dB is rounding.
    const ref = csv(`${name}.bode.csv`).filter((row) => row[1]! > -200);
    const r = bode(
      a,
      ref.map((row) => row[0]!),
    );
    let dMag = 0;
    let dPh = 0;
    ref.forEach((row, i) => {
      dMag = Math.max(dMag, Math.abs(r.magDb[i]! - row[1]!));
      dPh = Math.max(dPh, Math.abs(r.phaseDeg[i]! - row[2]!));
    });
    expect(dMag).toBeLessThan(0.01);
    expect(dPh).toBeLessThan(0.1);
  });

  it('step: samples within 1e-4 relative', () => {
    const ref = csv(`${name}.step.csv`);
    const y = ts === null ? stepResponse(tf, T, ref.length) : stepDiscrete(tf, ref.length);
    const scale = Math.max(1, ...ref.map((row) => Math.abs(row[1]!)));
    const worst = Math.max(...ref.map((row, i) => Math.abs(y[i]! - row[1]!) / scale));
    expect(worst).toBeLessThan(1e-4);
  });

  it('poles and zeros within 1e-6', () => {
    const ref = csv(`${name}.roots.csv`).map(([pole, re, im]) => ({
      pole: pole === 1,
      z: { re: re!, im: im! },
    }));
    expect(
      maxRootError(
        a.poles,
        ref.filter((r) => r.pole).map((r) => r.z),
      ),
    ).toBeLessThan(1e-6);
    expect(
      maxRootError(
        a.zeros,
        ref.filter((r) => !r.pole).map((r) => r.z),
      ),
    ).toBeLessThan(1e-6);
  });

  it('margins as MATLAB reports them', () => {
    const [gm, pm, wcg, wcp] = csv(`${name}.margin.csv`)[0]!;
    const m = margins(a);
    if (Number.isFinite(gm)) expect(Math.abs(m.gmDb - gm!)).toBeLessThan(0.01);
    else expect(m.gmDb).toBe(gm);
    if (Number.isFinite(pm)) expect(Math.abs(m.pmDeg - pm!)).toBeLessThan(0.1);
    else expect(m.pmDeg).toBe(pm);
    for (const [got, want] of [
      [m.wcg, wcg!],
      [m.wcp, wcp!],
    ] as const) {
      // MATLAB's margin interpolates crossovers (withzero: 3.316330 against the exact
      // sqrt(11) = 3.316625); exact values are checked in src/analysis.test.ts.
      if (Number.isFinite(want)) expect(Math.abs(got - want)).toBeLessThan(5e-4 * Math.max(1, want));
      else expect(sameOrBothNonFinite(got, want), `${got} vs ${want}`).toBe(true);
    }
  });
});
