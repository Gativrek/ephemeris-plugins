import type { LinkGraph } from '@ephemeris-notes/plugin-api';
import { describe, expect, it } from 'vitest';
import { buildGraph, domainOf, localGraph, placeNodes, savePositions, search } from './model';

const G: LinkGraph = {
  notes: [
    { path: 'Academic/V/A.md', title: 'Alpha' },
    { path: 'Academic/V/B.md', title: 'Beta' },
    { path: 'Academic/V/C.md', title: 'Ça va' },
    { path: 'Academic/V/Orphan.md', title: 'Orphan' },
  ],
  links: [
    { from: 'Academic/V/A.md', to: 'Academic/V/B.md', count: 2 },
    { from: 'Academic/V/B.md', to: 'Academic/V/C.md', count: 1 },
    { from: 'Academic/V/C.md', to: 'Work/W/Far.md', count: 1 },
    { from: 'Academic/V/A.md', to: 'Academic/V/_attachments/paper.pdf', count: 1 },
  ],
};

const ids = (d: { nodes: Array<{ id: string }> }) => d.nodes.map((n) => n.id).sort();

describe('buildGraph', () => {
  it('draws the scope, the notes it links to elsewhere, and counts links in', () => {
    const d = buildGraph(G, { attachments: false, orphans: true });
    expect(ids(d)).toEqual([
      'Academic/V/A.md',
      'Academic/V/B.md',
      'Academic/V/C.md',
      'Academic/V/Orphan.md',
      'Work/W/Far.md',
    ]);
    const far = d.nodes.find((n) => n.id === 'Work/W/Far.md')!;
    expect(far).toMatchObject({ inScope: false, domain: 'work', title: 'Far', kind: 'note', inbound: 1 });
    expect(d.nodes.find((n) => n.id === 'Academic/V/B.md')!.inbound).toBe(1);
    expect(d.edges).toHaveLength(3);
  });
  it('adds attachments, and leaves orphans out, on request', () => {
    const d = buildGraph(G, { attachments: true, orphans: false });
    expect(ids(d)).toContain('Academic/V/_attachments/paper.pdf');
    expect(d.nodes.find((n) => n.kind === 'attachment')!.title).toBe('paper.pdf');
    expect(ids(d)).not.toContain('Academic/V/Orphan.md');
  });
});

describe('localGraph', () => {
  const d = buildGraph(G, { attachments: false, orphans: true });
  it('keeps the note and its neighbours to the depth, either way', () => {
    expect(ids(localGraph(d, 'Academic/V/B.md', 1))).toEqual([
      'Academic/V/A.md',
      'Academic/V/B.md',
      'Academic/V/C.md',
    ]);
    expect(ids(localGraph(d, 'Academic/V/B.md', 2))).toEqual([
      'Academic/V/A.md',
      'Academic/V/B.md',
      'Academic/V/C.md',
      'Work/W/Far.md',
    ]);
    expect(ids(localGraph(d, 'Academic/V/Orphan.md', 2))).toEqual(['Academic/V/Orphan.md']);
  });
});

describe('helpers', () => {
  it('knows Domains from the first folder', () => {
    expect(domainOf('Personal/Trips/Lisbon.md')).toBe('personal');
    expect(domainOf('Inbox/capture.md')).toBeNull();
  });
  it('searches titles, case and accents folded', () => {
    const d = buildGraph(G, { attachments: false, orphans: true });
    expect(search(d.nodes, 'ca').map((n) => n.title)).toEqual(['Ça va']);
    expect(search(d.nodes, 'A').map((n) => n.title)).toEqual(['Alpha', 'Beta', 'Ça va', 'Far', 'Orphan']);
    expect(search(d.nodes, '  ')).toEqual([]);
  });
  it('saves positions and places new nodes beside a placed neighbour', () => {
    const saved = savePositions([{ id: 'a', x: 10.4, y: -3.6 }, { id: 'b' }]);
    expect(saved).toEqual({ a: [10, -4] });
    const nodes: Array<{ id: string; x?: number; y?: number }> = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(placeNodes(nodes, [{ source: 'b', target: 'a', count: 1 }], saved)).toBe(1);
    expect(nodes[0]).toMatchObject({ x: 10, y: -4 });
    expect(Math.abs(nodes[1]!.x! - 10)).toBeLessThanOrEqual(10);
    expect(nodes[2]!.x).toBeUndefined();
  });
});
