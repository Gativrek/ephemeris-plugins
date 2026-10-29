import { describe, expect, it } from 'vitest';
import type { Box } from './geometry';
import { nearestInDirection, nextFreeSpot } from './keyboard';

const box = (id: string, x: number, y: number, w = 72, h = 40): Box => ({ id, x, y, w, h });

describe('the nearest node in a direction', () => {
  const nodes = [
    box('a', 100, 100),
    box('right', 250, 110),
    box('far', 500, 100),
    box('below', 110, 220),
    box('diag', 220, 300),
  ];
  const from = nodes[0]!;

  it('prefers the node most nearly in line', () => {
    expect(nearestInDirection(from, nodes, 'right')).toBe('right');
    expect(nearestInDirection(from, nodes, 'down')).toBe('below');
  });

  it('returns null when nothing lies that way', () => {
    expect(nearestInDirection(from, nodes, 'left')).toBeNull();
    expect(nearestInDirection(from, nodes, 'up')).toBeNull();
  });

  it('skips the given nodes', () => {
    expect(nearestInDirection(from, nodes, 'right', ['right'])).toBe('far');
  });
});

describe('a free spot after a node', () => {
  const size = { w: 72, h: 40 };

  it('is one gap along the flow', () => {
    const a = box('a', 100, 100);
    expect(nextFreeSpot(a, size, [a], 'LR')).toEqual({ x: 100 + 72 + 64, y: 100 });
    expect(nextFreeSpot(a, size, [a], 'TD')).toEqual({ x: 100, y: 100 + 40 + 64 });
  });

  it('steps across the flow past an occupied spot', () => {
    const a = box('a', 100, 100);
    const taken = box('b', 236, 100);
    expect(nextFreeSpot(a, size, [a, taken], 'LR')).toEqual({ x: 236, y: 164 });
  });
});
