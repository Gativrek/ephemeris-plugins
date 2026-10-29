/**
 * Node sizes and orthogonal edge routes (SPECS 13.1). Routing works in a frame where
 * the flow runs left to right (+x) and "below" is +y; TD, RL and BT map into it, so a
 * feedback path runs underneath in LR and on the right in TD.
 */
import { isSign, type Diagram, type DiagramEdge, type DiagramNode, type Dir } from './syntax';

export interface Size {
  w: number;
  h: number;
}
export type Measure = (label: string) => Size;
export interface Point {
  x: number;
  y: number;
}
export interface Box {
  id: string;
  /** Centre. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export const JUNCTION = 20;
export const BRANCH = 6;
/** Space kept between a feedback path and the nodes it passes, and between parallel paths. */
const LANE = 22;

export function nodeSize(n: DiagramNode, measure: Measure): Size {
  if (n.shape === 'junction') return { w: JUNCTION, h: JUNCTION };
  if (n.shape === 'branch') return { w: BRANCH, h: BRANCH };
  if (n.shape === 'text') {
    const t = measure(n.label);
    return { w: Math.max(16, t.w + 8), h: t.h };
  }
  const t = measure(n.label);
  if (n.shape === 'circle') {
    const d = Math.max(48, Math.hypot(t.w, t.h) + 16);
    return { w: d, h: d };
  }
  if (n.shape === 'diamond') {
    // A w × h label fits a diamond of W × H when w/W + h/H ≤ 1; H = 0.6 W.
    const W = Math.max(88, t.w + t.h / 0.6 + 20);
    return { w: W, h: W * 0.6 };
  }
  return { w: Math.max(72, t.w + 28), h: Math.max(40, t.h + 18) };
}

// ---- Frames ----------------------------------------------------------------------

interface Frame {
  to(p: Point): Point;
  from(p: Point): Point;
  /** Width and height swap in vertical frames. */
  swap: boolean;
}

function frame(dir: Dir): Frame {
  switch (dir) {
    case 'LR':
      return { to: (p) => p, from: (p) => p, swap: false };
    case 'RL':
      return { to: (p) => ({ x: -p.x, y: p.y }), from: (p) => ({ x: -p.x, y: p.y }), swap: false };
    case 'TD':
    case 'TB':
      return { to: (p) => ({ x: p.y, y: p.x }), from: (p) => ({ x: p.y, y: p.x }), swap: true };
    case 'BT':
      return { to: (p) => ({ x: -p.y, y: p.x }), from: (p) => ({ x: p.y, y: -p.x }), swap: true };
  }
}

function toFrame(b: Box, f: Frame): Box {
  const c = f.to(b);
  return { id: b.id, x: c.x, y: c.y, w: f.swap ? b.h : b.w, h: f.swap ? b.w : b.h };
}

const left = (b: Box) => b.x - b.w / 2;
const right = (b: Box) => b.x + b.w / 2;
const top = (b: Box) => b.y - b.h / 2;
const bottom = (b: Box) => b.y + b.h / 2;

// ---- Routes ----------------------------------------------------------------------

export interface Route {
  edge: DiagramEdge;
  points: Point[];
  /** Where a label chip goes (the middle of the longest segment). */
  labelAt: Point;
  /** For a sign at a junction: beside the arrowhead. */
  signAt?: Point;
}

/** Drops repeated points and merges collinear runs. */
function simplify(ps: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of ps) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    const prev = out[out.length - 2];
    if (prev && last) {
      const col =
        (Math.abs(prev.x - last.x) < 0.01 && Math.abs(last.x - p.x) < 0.01) ||
        (Math.abs(prev.y - last.y) < 0.01 && Math.abs(last.y - p.y) < 0.01);
      if (col) out.pop();
    }
    out.push(p);
  }
  return out;
}

function longestMid(ps: Point[]): Point {
  let best = { x: ps[0]!.x, y: ps[0]!.y };
  let len = -1;
  for (let i = 1; i < ps.length; i++) {
    const a = ps[i - 1]!;
    const b = ps[i]!;
    const l = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (l > len) {
      len = l;
      best = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  return best;
}

/**
 * Routes every edge. `boxes` holds each node's centre and size in canvas px. Feedback
 * paths are placed narrowest first, each in a lane below the nodes and paths it spans.
 */
export function routeEdges(d: Diagram, boxes: Map<string, Box>): Route[] {
  const f = frame(d.dir);
  const fb = new Map([...boxes].map(([id, b]) => [id, toFrame(b, f)]));
  const all = [...fb.values()];
  const lanes: Array<{ a: number; b: number; y: number }> = [];
  const routes = new Map<DiagramEdge, Point[]>();

  const backward: DiagramEdge[] = [];
  for (const e of d.edges) {
    const s = fb.get(e.from);
    const t = fb.get(e.to);
    if (!s || !t) continue;
    if (e.from === e.to) {
      // A self-loop: out the bottom, round, and back in from below.
      const y = bottom(s) + LANE;
      routes.set(e, [
        { x: s.x + s.w / 4, y: bottom(s) },
        { x: s.x + s.w / 4, y },
        { x: s.x - s.w / 4, y },
        { x: s.x - s.w / 4, y: bottom(s) },
      ]);
    } else if (left(t) >= right(s) - 1) {
      // Along the flow: right side to left side, straight or with one jog.
      const xm = (right(s) + left(t)) / 2;
      routes.set(e, [
        { x: right(s), y: s.y },
        { x: xm, y: s.y },
        { x: xm, y: t.y },
        { x: left(t), y: t.y },
      ]);
    } else if (right(t) <= left(s) + 1) {
      backward.push(e);
    } else {
      // Overlapping in x: stacked, so bottom to top (or top to bottom), with one jog.
      const down = t.y >= s.y;
      const sy = down ? bottom(s) : top(s);
      const ty = down ? top(t) : bottom(t);
      const ym = (sy + ty) / 2;
      routes.set(e, [
        { x: s.x, y: sy },
        { x: s.x, y: ym },
        { x: t.x, y: ym },
        { x: t.x, y: ty },
      ]);
    }
  }

  // Feedback: narrowest span first, so nested loops sit inside the outer ones.
  const span = (e: DiagramEdge) => fb.get(e.from)!.x - fb.get(e.to)!.x;
  backward.sort((a, b) => span(a) - span(b));
  for (const e of backward) {
    const s = fb.get(e.from)!;
    const t = fb.get(e.to)!;
    const a = Math.min(t.x, s.x);
    const b = Math.max(t.x, s.x);
    // Step down past whatever the lane would run through: nodes in the span whose box it
    // crosses, and earlier lanes it would overlap. Nodes further down do not matter.
    let y = Math.max(bottom(s), bottom(t)) + LANE;
    for (let moved = true; moved;) {
      moved = false;
      for (const n of all) {
        if (n.id === s.id || n.id === t.id || right(n) < a || left(n) > b) continue;
        if (top(n) - LANE < y && bottom(n) + LANE > y) {
          y = bottom(n) + LANE;
          moved = true;
        }
      }
      for (const l of lanes) {
        if (l.a <= b && l.b >= a && Math.abs(l.y - y) < LANE) {
          y = l.y + LANE;
          moved = true;
        }
      }
    }
    lanes.push({ a, b, y });
    routes.set(e, [
      { x: s.x, y: bottom(s) },
      { x: s.x, y },
      { x: t.x, y },
      { x: t.x, y: bottom(t) },
    ]);
  }

  const out: Route[] = [];
  for (const e of d.edges) {
    const ps = routes.get(e);
    if (!ps) continue;
    const points = simplify(ps.map((p) => f.from(p)));
    const route: Route = { edge: e, points, labelAt: longestMid(points) };
    if (isSign(d, e)) route.signAt = signPoint(points);
    out.push(route);
  }
  return out;
}

/** Beside the arrowhead, on the side away from the segment's turn: above a horizontal arrival, left of a vertical one. */
function signPoint(ps: Point[]): Point {
  const end = ps[ps.length - 1]!;
  const prev = ps[ps.length - 2] ?? end;
  const horizontal = Math.abs(prev.y - end.y) < 0.01;
  const back = 14;
  if (horizontal) {
    const dx = Math.sign(end.x - prev.x) || 1;
    return { x: end.x - dx * back, y: end.y - 10 };
  }
  const dy = Math.sign(end.y - prev.y) || 1;
  return { x: end.x - 11, y: end.y - dy * back };
}

/** The points of a route as an SVG path. */
export const pathOf = (ps: Point[]) =>
  ps.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');

/** Every node's box, from its position and measured size. */
export function boxesOf(d: Diagram, measure: Measure): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const n of d.nodes) {
    const s = nodeSize(n, measure);
    out.set(n.id, { id: n.id, x: n.x ?? 0, y: n.y ?? 0, w: s.w, h: s.h });
  }
  return out;
}

/** The bounding box of nodes, routes and labels, with a margin. */
export function extentOf(
  boxes: Iterable<Box>,
  routes: Route[],
  margin = 16,
): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const b of boxes) {
    add(left(b), top(b));
    add(right(b), bottom(b));
  }
  for (const r of routes) for (const p of r.points) add(p.x, p.y);
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 2 * margin, h: 2 * margin };
  return { x: x0 - margin, y: y0 - margin, w: x1 - x0 + 2 * margin, h: y1 - y0 + 2 * margin };
}
