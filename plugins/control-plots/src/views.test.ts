import { describe, expect, it } from 'vitest';
import { BlockError, parseBlock } from './parse';
import { stepSystems } from './views';

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
