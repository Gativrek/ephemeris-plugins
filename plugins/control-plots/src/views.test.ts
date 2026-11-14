import { describe, expect, it } from 'vitest';
import { BlockError, parseBlock } from './parse';
import { legendName, stairs, stepSystems } from './views';

describe('step blocks', () => {
  it('leave out systems with more zeros than poles, and name them', () => {
    const block = parseBlock('G = 1/(s+1)\nL = s^2+2*s+1\nT = G*L\nH = T/(T+1)');
    const { plotted, skipped } = stepSystems(block);
    expect(plotted.systems.map((s) => s.name)).toEqual(['G', 'H']);
    expect(skipped).toEqual(['L', 'T']);
    expect(plotted.options).toBe(block.options);
  });

  it('keep biproper systems', () => {
    expect(stepSystems(parseBlock('G = (s+2)/(s+1)')).skipped).toEqual([]);
  });

  it('fail only when nothing is left to plot', () => {
    expect(() => stepSystems(parseBlock('L = s+1'))).toThrow(
      new BlockError('No step response: L has more zeros than poles.'),
    );
    expect(() => stepSystems(parseBlock('L = s+1\nM = s^2\nshow = L, M'))).toThrow(
      'No step response: L, M have more zeros than poles.',
    );
  });
});

describe('discrete systems', () => {
  it('carry their sample time in the legend', () => {
    expect(legendName({ name: 'Gd', ts: 0.1 })).toBe('Gd (Ts = 0.1 s)');
    expect(legendName({ name: 'G', ts: null })).toBe('G');
    expect(legendName({ name: 'H', ts: 0.1 + 0.2 })).toBe('H (Ts = 0.3 s)');
  });

  it('draw steps as stairs', () => {
    expect(stairs(0.5, [0, 1, 2])).toEqual({ xs: [0, 0.5, 0.5, 1, 1], ys: [0, 0, 1, 1, 2] });
  });
});
