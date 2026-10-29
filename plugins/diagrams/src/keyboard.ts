/**
 * Keyboard helpers for the canvas: the nearest node in a direction (Alt+Arrows, and
 * choosing a target while connecting), and a free spot beside a node for placing one.
 */
import type { Box, Size } from './geometry';
import type { Dir } from './syntax';

export type Direction = 'left' | 'right' | 'up' | 'down';

const VECTOR: Record<Direction, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

/**
 * The node whose centre lies most nearly in `dir` from `from`: within 60° of the
 * direction, closest first, with sideways distance counting double. Null when none.
 */
export function nearestInDirection(
  from: Box,
  boxes: Iterable<Box>,
  dir: Direction,
  skip: string[] = [],
): string | null {
  const [vx, vy] = VECTOR[dir];
  let best: string | null = null;
  let score = Infinity;
  for (const b of boxes) {
    if (b.id === from.id || skip.includes(b.id)) continue;
    const dx = b.x - from.x;
    const dy = b.y - from.y;
    const along = dx * vx + dy * vy;
    const across = Math.abs(dx * vy - dy * vx);
    if (along <= 0 || across > along * Math.tan(Math.PI / 3)) continue;
    const s = along + 2 * across;
    if (s < score) {
      score = s;
      best = b.id;
    }
  }
  return best;
}

const FLOW: Record<Dir, [number, number]> = { LR: [1, 0], RL: [-1, 0], TD: [0, 1], TB: [0, 1], BT: [0, -1] };
const GAP = 64;
const CLEAR = 16;

/**
 * Where a new node of `size` goes beside `anchor`: one gap further along the flow, then
 * stepped across the flow until it overlaps nothing.
 */
export function nextFreeSpot(
  anchor: Box,
  size: Size,
  boxes: Iterable<Box>,
  dir: Dir,
): { x: number; y: number } {
  const [fx, fy] = FLOW[dir];
  const all = [...boxes];
  const half = fx ? (anchor.w + size.w) / 2 : (anchor.h + size.h) / 2;
  const base = { x: anchor.x + fx * (half + GAP), y: anchor.y + fy * (half + GAP) };
  const step = fx ? size.h + 24 : size.w + 24;
  const overlaps = (p: { x: number; y: number }) =>
    all.some(
      (b) =>
        Math.abs(b.x - p.x) < (b.w + size.w) / 2 + CLEAR && Math.abs(b.y - p.y) < (b.h + size.h) / 2 + CLEAR,
    );
  // Try straight ahead, then alternately further to one side and the other.
  for (let i = 0; i < 40; i++) {
    const k = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 ? 1 : -1);
    const p = { x: base.x + (fx ? 0 : k * step), y: base.y + (fx ? k * step : 0) };
    if (!overlaps(p)) return p;
  }
  return base;
}
