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
    const scope = new Map([['L', tf('10/(s(s+1))')]]);
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
