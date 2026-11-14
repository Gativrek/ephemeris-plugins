import { describe, expect, it } from 'vitest';
import { BlockError, parseBlock, parseExpression } from './parse';

const tf = (text: string) => parseExpression(text);

describe('expressions', () => {
  it('reads tf() vectors with spaces or commas', () => {
    expect(tf('tf([1 2], [1 3 2])')).toEqual({ num: [1, 2], den: [1, 3, 2] });
    expect(tf('tf([1, -2.5e-1], [1,0,4])')).toEqual({ num: [1, -0.25], den: [1, 0, 4] });
    expect(tf('tf(4, [1 1])')).toEqual({ num: [4], den: [1, 1] });
  });

  it('reads rational expressions in s', () => {
    expect(tf('10*(s + 1)/(s^2 + 0.4*s + 4)')).toEqual({ num: [10, 10], den: [1, 0.4, 4] });
    expect(tf('1/(s+1)')).toEqual({ num: [1], den: [1, 1] });
    expect(tf('-s^2')).toEqual({ num: [-1, 0, 0], den: [1] });
    expect(tf('2s')).toEqual({ num: [2, 0], den: [1] });
  });

  it('binds juxtaposition tighter than / and *', () => {
    expect(tf('10/(s+1)(s+2)')).toEqual({ num: [10], den: [1, 3, 2] });
    expect(tf('1/2s')).toEqual({ num: [1], den: [2, 0] });
    expect(tf('(s+1)(s+2)')).toEqual({ num: [1, 3, 2], den: [1] });
    expect(tf('2*3s')).toEqual({ num: [6, 0], den: [1] });
  });

  it('keeps sums over a shared denominator, like MATLAB feedback', () => {
    const scope = new Map([['L', { tf: tf('10/(s(s+1))'), ts: null }]]);
    expect(parseExpression('L/(1+L)', scope)).toEqual({ num: [10], den: [1, 1, 10] });
    expect(parseExpression('1/(1+L)', scope)).toEqual({ num: [1, 1, 0], den: [1, 1, 10] });
  });

  it('names the problem', () => {
    expect(() => tf('1/(s+1')).toThrow("Line 1: expected ')' at the end");
    expect(() => tf('s^0.5')).toThrow('whole numbers');
    expect(() => tf('G/(s+1)')).toThrow("unknown name 'G'");
    expect(() => tf('1/0')).toThrow('division by zero');
    expect(() => tf('2 $ s')).toThrow("unexpected '$'");
    expect(() => tf('tf([], [1])')).toThrow('empty coefficient vector');
  });
});

describe('blocks', () => {
  it('reads options and systems, in order, with comments', () => {
    const b = parseBlock(
      [
        '# plant and controller',
        'G = 1/(s(s+1))',
        'C = 10(s+1)/(s+10)',
        'L = C*G',
        'w = 0.01..1000',
        'units = Hz',
        'margins = on',
        'grid = off',
        'title = Loop shaping',
        'show = L',
      ].join('\n'),
    );
    expect(b.systems.map((s) => s.name)).toEqual(['L']);
    expect(b.options).toEqual({
      w: [0.01, 1000],
      t: null,
      grid: false,
      title: 'Loop shaping',
      hz: true,
      margins: true,
      ts: null,
    });
  });

  it('accepts t as a range or a number', () => {
    expect(parseBlock('G = 1/(s+1)\nt = 0..20').options.t).toBe(20);
    expect(parseBlock('G = 1/(s+1)\nt = 5').options.t).toBe(5);
    expect(() => parseBlock('G = 1/(s+1)\nt = 1..5')).toThrow('Line 2: t must be a range like 0..10');
  });

  it('refuses what it cannot plot', () => {
    expect(() => parseBlock('')).toThrow(BlockError);
    expect(() => parseBlock('G = 1/(s+1)\nG = 2')).toThrow('Line 2: G is already defined');
    expect(() => parseBlock('s = 1')).toThrow("'s' cannot name a system");
    expect(() => parseBlock('G 1/(s+1)')).toThrow('Line 1: expected name = value');
    expect(() => parseBlock('G = 1\nshow = H')).toThrow("Line 2: show: unknown system 'H'");
    expect(() => parseBlock('G = 1/(s+1)\nw = 0..10')).toThrow('w must be above 0');
    expect(() => parseBlock('G = 1/(s+1)\ngrid = maybe')).toThrow('grid must be on or off');
    expect(() => parseBlock(['A=1', 'B=1', 'C=1', 'D=1', 'E=1', 'F=1', 'G=1'].join('\n'))).toThrow(
      'At most 6',
    );
  });
});

describe('discrete time', () => {
  it('reads tf(num, den, Ts) and expressions in z with Ts, in any order', () => {
    const b = parseBlock(
      ['H = tf([0.5], [1 -0.5], 0.2)', 'D = 0.5/(z - 0.5)', 'Ts = 0.1', 'G = 1/(s+1)'].join('\n'),
    );
    expect(b.options.ts).toBe(0.1);
    expect(b.systems.map((s) => [s.name, s.ts])).toEqual([
      ['H', 0.2],
      ['D', 0.1],
      ['G', null],
    ]);
    expect(b.systems[1]!.tf).toEqual({ num: [0.5], den: [1, -0.5] });
  });

  it('discretizes with c2d, by zero-order hold or Tustin', () => {
    const b = parseBlock(
      ['G = 1/(s+1)', 'Gd = c2d(G, 0.1)', "Gt = c2d(G, 0.1, 'tustin')", 'Gz = c2d(1/(s+1), 0.1, zoh)'].join(
        '\n',
      ),
    );
    const [, gd, gt, gz] = b.systems;
    const p = Math.exp(-0.1);
    expect(gd!.ts).toBe(0.1);
    expect(gd!.tf.den[1]).toBeCloseTo(-p, 14);
    expect(gd!.tf.num).toHaveLength(1);
    expect(gd!.tf.num[0]).toBeCloseTo(1 - p, 14);
    expect(gz!.tf).toEqual(gd!.tf);
    // Tustin: (z + 1)·0.1 / ((2.1)z − 1.9), normalized.
    expect(gt!.tf.den[1]).toBeCloseTo(-1.9 / 2.1, 14);
    expect(gt!.tf.num[0]).toBeCloseTo(0.1 / 2.1, 14);
  });

  it('lets plain gains combine with either', () => {
    const b = parseBlock(['K = 5', 'Ts = 0.1', 'C = K/(z - 1)', 'G = K/(s+1)'].join('\n'));
    expect(b.systems.map((s) => s.ts)).toEqual([null, 0.1, null]);
  });

  it('refuses mixing, missing Ts and bad arguments, naming the line', () => {
    expect(() => parseBlock('G = 1/(z - 0.5)')).toThrow('Line 1: a system in z needs Ts = …');
    expect(() => parseBlock('Ts = 0.1\nC = 1/(z-1)\nG = 1/(s+1)\nL = C*G')).toThrow(
      'Line 4: C is discrete and G is continuous; discretize G with c2d first',
    );
    expect(() => parseBlock('A = tf(1, [1 -0.5], 0.1)\nB = tf(1, [1 -0.5], 0.2)\nL = A*B')).toThrow(
      'Line 3: A and B have different sample times (0.1 s and 0.2 s)',
    );
    expect(() => parseBlock('Ts = 0.1\nG = (s+1)/(z-1)')).toThrow(
      'Line 2: a discrete system is written in z, not s',
    );
    expect(() => parseBlock('Ts = 0\nG = 1')).toThrow('Line 1: Ts must be a sample time in seconds');
    expect(() => parseBlock('G = tf(1, [1 1], -1)')).toThrow('must be above 0');
    expect(() => parseBlock('G = c2d(s+1, 0.1)')).toThrow('c2d needs a proper system');
    expect(() => parseBlock('G = c2d(1/(s+1), 0.1, foh)')).toThrow('the c2d method must be zoh or tustin');
    expect(() => parseBlock('Ts = 0.1\nG = c2d(1/(z-1), 0.1)')).toThrow(
      'c2d needs a continuous system, and z is discrete',
    );
    expect(() => parseBlock('z = 1')).toThrow("'z' cannot name a system");
    expect(() => parseBlock('c2d = 1')).toThrow("'c2d' cannot name a system");
  });
});
