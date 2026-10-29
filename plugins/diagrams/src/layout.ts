/**
 * The fallback layout (SPECS 13.1): layers along the flow by longest path, ignoring the
 * edges that close a cycle, and nodes of a layer stacked across it. Used for nodes
 * without `@pos` when Mermaid's own layout cannot be read.
 */
import { nodeSize, type Measure } from './geometry';
import type { Diagram, Dir } from './syntax';

const GAP_ALONG = 56;
const GAP_ACROSS = 36;

export function layeredLayout(d: Diagram, measure: Measure): Map<string, { x: number; y: number }> {
  const ids = d.nodes.map((n) => n.id);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of d.edges) out.get(e.from)?.push(e.to);

  // Depth-first, so edges back to a node on the current path (feedback) are ignored.
  const layer = new Map<string, number>();
  const onPath = new Set<string>();
  const forward: Array<[string, string]> = [];
  const visit = (id: string) => {
    onPath.add(id);
    for (const to of out.get(id) ?? []) {
      if (onPath.has(to)) continue;
      forward.push([id, to]);
      if (!layer.has(to) && !onPath.has(to)) visit(to);
    }
    onPath.delete(id);
    if (!layer.has(id)) layer.set(id, 0);
  };
  const incoming = new Set(d.edges.map((e) => e.to));
  for (const id of ids) if (!incoming.has(id)) visit(id);
  for (const id of ids) if (!layer.has(id)) visit(id);
  // Longest path over the forward edges.
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const [a, b] of forward) {
      const want = layer.get(a)! + 1;
      if (layer.get(b)! < want) {
        layer.set(b, want);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const vertical = d.dir === 'TD' || d.dir === 'TB' || d.dir === 'BT';
  const sizes = new Map(d.nodes.map((n) => [n.id, nodeSize(n, measure)]));
  const along = (id: string) => (vertical ? sizes.get(id)!.h : sizes.get(id)!.w);
  const across = (id: string) => (vertical ? sizes.get(id)!.w : sizes.get(id)!.h);
  const layers: string[][] = [];
  for (const id of ids) (layers[layer.get(id)!] ??= []).push(id);

  const pos = new Map<string, { x: number; y: number }>();
  let a = 0;
  for (const group of layers) {
    if (!group?.length) continue;
    const depth = Math.max(...group.map(along));
    const total = group.reduce((s, id) => s + across(id), 0) + GAP_ACROSS * (group.length - 1);
    let c = -total / 2;
    for (const id of group) {
      const p = { along: a + depth / 2, across: c + across(id) / 2 };
      pos.set(id, place(d.dir, p.along, p.across));
      c += across(id) + GAP_ACROSS;
    }
    a += depth + GAP_ALONG;
  }
  return normalize(pos);
}

function place(dir: Dir, along: number, across: number): { x: number; y: number } {
  switch (dir) {
    case 'LR':
      return { x: along, y: across };
    case 'RL':
      return { x: -along, y: across };
    case 'BT':
      return { x: across, y: -along };
    default:
      return { x: across, y: along };
  }
}

/** Shifts positions so the top-left node centre sits at (80, 60). */
export function normalize(pos: Map<string, { x: number; y: number }>): Map<string, { x: number; y: number }> {
  const xs = [...pos.values()].map((p) => p.x);
  const ys = [...pos.values()].map((p) => p.y);
  const dx = 80 - Math.min(...xs);
  const dy = 60 - Math.min(...ys);
  return new Map([...pos].map(([id, p]) => [id, { x: Math.round(p.x + dx), y: Math.round(p.y + dy) }]));
}

/**
 * Snaps positions to the 8px grid and puts nodes that are nearly in line across the flow
 * (within 12px) exactly in line, so edges between them run straight. Mermaid's layout
 * centres nodes of different sizes a few pixels apart.
 */
export function straighten(
  pos: Map<string, { x: number; y: number }>,
  dir: Dir,
): Map<string, { x: number; y: number }> {
  const axis = dir === 'LR' || dir === 'RL' ? 'y' : 'x';
  const snap = (v: number) => Math.round(v / 8) * 8;
  const out = new Map([...pos].map(([id, p]) => [id, { x: snap(p.x), y: snap(p.y) }]));
  const order = [...out.values()].sort((a, b) => a[axis] - b[axis]);
  let group: Array<{ x: number; y: number }> = [];
  const flush = () => {
    if (!group.length) return;
    const v = snap(group.reduce((s, p) => s + p[axis], 0) / group.length);
    for (const p of group) p[axis] = v;
    group = [];
  };
  for (const p of order) {
    if (group.length && p[axis] - group[0]![axis] > 12) flush();
    group.push(p);
  }
  flush();
  return out;
}
