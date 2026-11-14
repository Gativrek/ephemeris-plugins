/**
 * The graph to draw (SPECS 13.11), from the core's link graph (12.13.1): notes in the scope,
 * the notes they link to elsewhere (faded), attachments and orphans as toggles, and the
 * local graph around one note. Pure functions.
 */
import type { Domain, LinkGraph } from '@ephemeris-notes/plugin-api';

export interface GraphNode {
  /** The library path. */
  id: string;
  title: string;
  domain: Domain | null;
  kind: 'note' | 'attachment';
  /** False for notes outside the scope that notes in it link to. */
  inScope: boolean;
  /** How many drawn notes link here: sets the dot's size. */
  inbound: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  count: number;
}

export interface Drawn {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphOptions {
  attachments: boolean;
  orphans: boolean;
}

const DOMAINS: Record<string, Domain> = { academic: 'academic', work: 'work', personal: 'personal' };

/** The Domain of a library path, from its first folder; null outside the Domains. */
export function domainOf(path: string): Domain | null {
  return DOMAINS[path.split('/')[0]!.toLowerCase()] ?? null;
}

export const isNote = (path: string) => /\.md$/i.test(path);

/** A file's name without its folder or `.md`. */
export const baseName = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '');

/**
 * Templates (`_templates/`, SPECS 4.5) are blueprints, not notes of the Vault: their
 * `{{date}}` titles and placeholder links stay out of the graph.
 */
export const isTemplate = (path: string): boolean => path.split('/').includes('_templates');

export function buildGraph(graph: LinkGraph, opts: GraphOptions): Drawn {
  const nodes = new Map<string, GraphNode>();
  const add = (id: string, title: string, inScope: boolean) => {
    if (!nodes.has(id))
      nodes.set(id, {
        id,
        title,
        domain: domainOf(id),
        kind: isNote(id) ? 'note' : 'attachment',
        inScope,
        inbound: 0,
      });
  };
  for (const n of graph.notes) if (!isTemplate(n.path)) add(n.path, n.title || baseName(n.path), true);
  const edges: GraphEdge[] = [];
  for (const l of graph.links) {
    if (!isNote(l.to) && !opts.attachments) continue;
    if (!nodes.has(l.from) || isTemplate(l.to)) continue;
    add(l.to, isNote(l.to) ? baseName(l.to) : l.to.split('/').pop()!, false);
    edges.push({ source: l.from, target: l.to, count: l.count });
  }
  for (const e of edges) nodes.get(e.target)!.inbound++;
  if (!opts.orphans) {
    const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
    for (const id of [...nodes.keys()]) if (!linked.has(id)) nodes.delete(id);
  }
  return { nodes: [...nodes.values()], edges };
}

/** The note at `center` and the nodes within `depth` links of it, either way. */
export function localGraph(drawn: Drawn, center: string, depth: number): Drawn {
  const near = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!near.has(a)) near.set(a, new Set());
    near.get(a)!.add(b);
  };
  for (const e of drawn.edges) {
    link(e.source, e.target);
    link(e.target, e.source);
  }
  const keep = new Set([center]);
  let ring = [center];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of ring)
      for (const o of near.get(id) ?? []) {
        if (keep.has(o)) continue;
        keep.add(o);
        next.push(o);
      }
    ring = next;
  }
  const nodes = drawn.nodes.filter((n) => keep.has(n.id)).map((n) => ({ ...n, inScope: true, inbound: 0 }));
  const edges = drawn.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) byId.get(e.target)!.inbound++;
  return { nodes, edges };
}

/** Folds case and accents, for the search box. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Titles matching a search, in title order. */
export function search(nodes: GraphNode[], query: string): GraphNode[] {
  const q = fold(query.trim());
  if (!q) return [];
  return nodes.filter((n) => fold(n.title).includes(q)).sort((a, b) => a.title.localeCompare(b.title));
}

/** Saved positions: rounded, for the nodes drawn now. */
export function savePositions(
  nodes: Array<{ id: string; x?: number; y?: number }>,
): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const n of nodes)
    if (Number.isFinite(n.x) && Number.isFinite(n.y)) out[n.id] = [Math.round(n.x!), Math.round(n.y!)];
  return out;
}

/**
 * Places nodes at their saved positions; a new node goes beside a placed neighbour, or near
 * the middle. Returns how many were placed from the save.
 */
export function placeNodes(
  nodes: Array<{ id: string; x?: number; y?: number }>,
  edges: GraphEdge[],
  saved: Record<string, [number, number]>,
): number {
  let placed = 0;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    const p = saved[n.id];
    if (p) [n.x, n.y, placed] = [p[0], p[1], placed + 1];
  }
  for (const e of edges) {
    for (const [a, b] of [
      [e.source, e.target],
      [e.target, e.source],
    ] as const) {
      const n = byId.get(a);
      const o = byId.get(b);
      if (n && o && n.x === undefined && o.x !== undefined) [n.x, n.y] = [o.x + jitter(), o.y! + jitter()];
    }
  }
  return placed;
}

const jitter = () => (Math.random() - 0.5) * 20;
