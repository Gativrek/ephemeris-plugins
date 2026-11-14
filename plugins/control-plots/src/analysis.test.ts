import { describe, expect, it } from 'vitest';
import {
  analyze,
  autoRange,
  autoSteps,
  autoT,
  dcGain,
  ImproperError,
  margins,
  phaseDeg,
  stability,
  stepDiscrete,
  stepResponse,
} from './analysis';
import { expm } from './expm';
import { parseExpression } from './parse';
import { roots } from './roots';

const sys = (text: string) => analyze(parseExpression(text));

describe('roots', () => {
  it('finds simple, complex and origin roots', () => {
    expect(roots([1, 3, 2])).toEqual([
      { re: -2, im: 0 },
      { re: -1, im: 0 },
    ]);
    const r = roots([1, 0.4, 4]);
    expect(r[0]!.re).toBeCloseTo(-0.2, 12);
    expect(r[0]!.im).toBeCloseTo(-Math.sqrt(3.96), 12);
    expect(r[1]).toEqual({ re: r[0]!.re, im: -r[0]!.im });
    expect(roots([1, 2, 0, 0]).filter((z) => z.re === 0 && z.im === 0)).toHaveLength(2);
    expect(roots([5])).toEqual([]);
  });

  it('is accurate on higher orders and repeated roots', () => {
    // (s+1)(s+2)…(s+8)
    let p = [1];
    for (let k = 1; k <= 8; k++) p = conv(p, [1, k]);
    const got = roots(p).map((z) => z.re);
    got.forEach((re, i) => expect(Math.abs(re + 8 - i)).toBeLessThan(1e-8));
    // (s+1)^4: a fourfold root is only accurate to about eps^(1/4).
    for (const z of roots([1, 4, 6, 4, 1])) expect(Math.hypot(z.re + 1, z.im)).toBeLessThan(1e-3);
  });
});

function conv(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => b.forEach((y, j) => (out[i + j]! += x * y)));
  return out;
}

describe('expm', () => {
  it('rotates: exp([[0, t], [-t, 0]]) = [[cos, sin], [-sin, cos]]', () => {
    const t = 2.5;
    const e = expm([
      [0, t],
      [-t, 0],
    ]);
    expect(e[0]![0]).toBeCloseTo(Math.cos(t), 13);
    expect(e[0]![1]).toBeCloseTo(Math.sin(t), 13);
    expect(e[1]![0]).toBeCloseTo(-Math.sin(t), 13);
  });

  it('handles large norms by scaling and squaring', () => {
    expect(expm([[-50]])[0]![0]).toBeCloseTo(Math.exp(-50), 30);
    expect(expm([[12]])[0]![0]! / Math.exp(12)).toBeCloseTo(1, 12);
  });
});

describe('margins, against exact values', () => {
  it('finds sqrt(11) and the exact phase margin for (2s+1)/(s^2+2s+10)', () => {
    const m = margins(sys('(2s+1)/(s^2+2s+10)'));
    expect(m.wcp).toBeCloseTo(Math.sqrt(11), 10);
    expect(m.gmDb).toBe(Infinity);
    expect(Number.isNaN(m.wcg)).toBe(true);
  });

  it('gives GM 20 dB at sqrt(11) for 6/((s+1)(s+2)(s+3))', () => {
    const m = margins(sys('6/((s+1)(s+2)(s+3))'));
    expect(m.gmDb).toBeCloseTo(20, 10);
    expect(m.wcg).toBeCloseTo(Math.sqrt(11), 10);
  });

  it('finds 2.8 exactly for 4/(s^2+0.4s+4)', () => {
    expect(margins(sys('4/(s^2+0.4s+4)')).wcp).toBeCloseTo(2.8, 10);
  });
});

describe('phase branch', () => {
  it('starts where MATLAB starts', () => {
    expect(phaseDeg(sys('1/s^2'), 1e-3)).toBeCloseTo(-180, 6);
    expect(phaseDeg(sys('-1/(s+1)'), 1e-6)).toBeCloseTo(180, 3);
    expect(phaseDeg(sys('(-s+1)/((s+1)(s+2))'), 1e-6)).toBeCloseTo(360, 3);
    expect(phaseDeg(sys('1/s^3'), 1)).toBeCloseTo(-270, 6);
  });
});

describe('step', () => {
  it('matches the closed form of a first-order lag', () => {
    const y = stepResponse({ num: [1], den: [1, 1] }, 5, 501);
    y.forEach((v, i) => expect(v).toBeCloseTo(1 - Math.exp(-(i * 5) / 500), 12));
  });

  it('starts at the feedthrough of a biproper system, and refuses improper ones', () => {
    expect(stepResponse({ num: [1, 2], den: [1, 1] }, 1, 11)[0]).toBe(1);
    expect(stepResponse({ num: [3], den: [2] }, 1, 3)).toEqual([1.5, 1.5, 1.5]);
    expect(() => stepResponse({ num: [1, 0], den: [1] }, 1)).toThrow(ImproperError);
  });

  it('classifies stability and picks the window', () => {
    expect(stability(sys('1/(s+1)'))).toBe('stable');
    expect(stability(sys('1/(s(s+2))'))).toBe('marginal');
    expect(stability(sys('1/(s^2+1)'))).toBe('marginal');
    expect(stability(sys('1/(s-1)'))).toBe('unstable');
    expect(autoT(sys('1/(s+1)'))).toBe(6);
    expect(autoT(sys('1/(s+0.5)(s+4)'))).toBeCloseTo(12, 12);
    expect(autoT(sys('10/(s(s+2))'))).toBe(3);
    expect(autoT(sys('1/(s^2+1)'))).toBe(10);
    expect(autoT(sys('1/(s-1)'))).toBe(10);
    expect(autoT(sys('1/(s+1e-6)'))).toBe(1e4);
    expect(dcGain(sys('4/(s^2+0.4s+4)'))).toBe(1);
  });
});

describe('autoRange', () => {
  it('goes two decades beyond the roots, in whole decades', () => {
    expect(autoRange([sys('1/(s+2)'), sys('(s+0.05)/(s+300)')])).toEqual([1e-4, 1e5]);
    expect(autoRange([sys('1/s')])).toEqual([1e-2, 1e2]);
  });
});

describe('discrete time', () => {
  const dsys = (text: string, ts = 0.1) => analyze(parseExpression(text, new Map(), 1, ts), ts);

  it('starts the phase on MATLAB branch: an integrator at -90, a zero outside at +180', () => {
    expect(phaseDeg(dsys('0.1/(z-1)'), 1e-6)).toBeCloseTo(-90, 3);
    expect(phaseDeg(dsys('0.1/(z-1)'), 0)).toBe(-90);
    expect(phaseDeg(dsys('(z-1.5)/(z-0.5)'), 1e-6)).toBeCloseTo(180, 3);
    // Three poles, two at the origin: -540 at the Nyquist frequency.
    expect(phaseDeg(dsys('1/(z^2 (z-0.5))'), Math.PI / 0.1)).toBeCloseTo(-540, 9);
  });

  it('takes a zero on the circle at -1 from below at the Nyquist frequency', () => {
    expect(phaseDeg(dsys('(z+1)/(z^2)'), Math.PI / 0.1)).toBeCloseTo(-360 + 90, 9);
  });

  it('classifies stability by |p| and picks the window in samples', () => {
    expect(stability(dsys('1/(z-0.5)'))).toBe('stable');
    expect(stability(dsys('1/(z-1)'))).toBe('marginal');
    expect(stability(dsys('1/(z^2+1)'))).toBe('marginal');
    expect(stability(dsys('1/(z-1.01)'))).toBe('unstable');
    // 0.5^k < 0.002 from k = 9: the minimum of 20 samples.
    expect(autoSteps(dsys('1/(z-0.5)'))).toBe(20);
    expect(autoSteps(dsys('1/(z-0.98)'))).toBe(308);
    expect(autoT(dsys('1/(z-0.98)', 0.05))).toBeCloseTo(15.4, 12);
    expect(autoSteps(dsys('1/(z-1)'))).toBe(100);
    expect(autoSteps(dsys('1/(z-0.9999999)', 1))).toBe(10000);
    expect(dcGain(dsys('0.5/(z-0.5)'))).toBe(1);
  });

  it('steps by the difference equation, delays included', () => {
    const y = stepDiscrete({ num: [0.5], den: [1, -0.5] }, 6);
    y.forEach((v, k) => expect(v).toBeCloseTo(k === 0 ? 0 : 1 - 0.5 ** k, 14));
    expect(stepDiscrete({ num: [1], den: [1, 0, 0] }, 4)).toEqual([0, 0, 1, 1]);
    expect(stepDiscrete({ num: [2, 0], den: [1, 0] }, 3)).toEqual([2, 2, 2]);
    expect(() => stepDiscrete({ num: [1, 0], den: [1] }, 3)).toThrow(ImproperError);
  });

  it('ends the automatic range at the Nyquist frequency', () => {
    expect(autoRange([dsys('0.5/(z-0.5)')])).toEqual([0.01, Math.PI / 0.1]);
    expect(autoRange([sys('1/(s+1)'), dsys('0.5/(z-0.5)', 0.001)])).toEqual([0.01, Math.PI / 0.001]);
  });

  it('finds the gain margin at the Nyquist frequency', () => {
    const m = margins(dsys('0.5/(z-0.5)'));
    expect(m.wcg).toBe(Math.PI / 0.1);
    expect(m.gmDb).toBeCloseTo(20 * Math.log10(3), 9);
  });
});
