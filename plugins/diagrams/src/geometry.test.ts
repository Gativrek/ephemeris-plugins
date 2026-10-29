import { describe, expect, it } from 'vitest';
import { boxesOf, nodeSize, routeEdges, type Measure } from './geometry';
import { layeredLayout, straighten } from './layout';
import { parseDiagram, type Diagram } from './syntax';

/** 8px per character, 20px tall. */
const measure: Measure = (label) => ({ w: label.length * 8, h: 20 });

const parse = (s: string): Diagram => {
  const r = parseDiagram(s);
  if (!r.ok) throw new Error(r.reason);
  return r.diagram;
};

const routes = (src: string) => {
  const d = parse(src);
  return routeEdges(d, boxesOf(d, measure)).map((r) => r.points.map((p) => [p.x, p.y]));
};

describe('node sizes', () => {
  it('grow with the label, with a minimum', () => {
    const n = (shape: 'rect' | 'circle' | 'diamond', label: string) =>
      nodeSize({ id: 'a', shape, label }, measure);
    expect(n('rect', 'G')).toEqual({ w: 72, h: 40 });
    expect(n('rect', 'A long label here')).toEqual({ w: 17 * 8 + 28, h: 40 });
    expect(n('circle', 'x').w).toBe(48);
    const d = n('diamond', 'Is it ready yet?');
    // The label's corners are inside the diamond.
    expect(128 / d.w + 20 / d.h).toBeLessThanOrEqual(1);
    expect(nodeSize({ id: 's', shape: 'junction', label: '' }, measure)).toEqual({ w: 20, h: 20 });
  });
});

describe('orthogonal routes', () => {
  it('run straight between aligned nodes, side to side', () => {
    expect(routes('flowchart LR\nA --> B\n%% @pos A 50 50\n%% @pos B 200 50')).toEqual([
      [
        [86, 50],
        [164, 50],
      ],
    ]);
  });

  it('take one jog between offset nodes', () => {
    expect(routes('flowchart LR\nA --> B\n%% @pos A 50 50\n%% @pos B 200 110')).toEqual([
      [
        [86, 50],
        [125, 50],
        [125, 110],
        [164, 110],
      ],
    ]);
  });

  it('send a feedback path under every node it spans, into the bottom of the target', () => {
    const src = [
      'flowchart LR',
      'e@{ shape: cross-circ } --> G[G]',
      'G --> b@{ shape: f-circ }',
      'b -->|-| e',
      '%% @pos e 50 50',
      '%% @pos G 150 50',
      '%% @pos b 250 50',
    ].join('\n');
    const d = parse(src);
    const rs = routeEdges(d, boxesOf(d, measure));
    // G's bottom is at 70; the lane is 22 below it.
    expect(rs[2]!.points).toEqual([
      { x: 250, y: 53 },
      { x: 250, y: 92 },
      { x: 50, y: 92 },
      { x: 50, y: 60 },
    ]);
    // The sign sits left of the upward arrival into the junction.
    expect(rs[2]!.signAt).toEqual({ x: 39, y: 74 });
  });

  it('nest loops: the wider loop runs below the narrower one', () => {
    const src = [
      'flowchart LR',
      'A --> B',
      'B --> C',
      'C --> B',
      'C --> A',
      '%% @pos A 50 50',
      '%% @pos B 150 50',
      '%% @pos C 250 50',
    ].join('\n');
    const [, , inner, outer] = routes(src);
    expect(inner![1]![1]).toBe(92);
    expect(outer![1]![1]).toBe(114);
  });

  it('run feedback on the right in a top-down chart', () => {
    const [back] = routes('flowchart TD\nB --> A\n%% @pos A 50 50\n%% @pos B 50 150');
    // Out of B's right side, up past A, into A's right side.
    expect(back).toEqual([
      [86, 150],
      [108, 150],
      [108, 50],
      [86, 50],
    ]);
  });

  it('join stacked nodes bottom to top', () => {
    expect(routes('flowchart LR\nA --> B\n%% @pos A 50 50\n%% @pos B 60 150')).toEqual([
      [
        [50, 70],
        [50, 100],
        [60, 100],
        [60, 130],
      ],
    ]);
  });
});

describe('the fallback layout', () => {
  it('puts nodes in layers along the flow, ignoring feedback', () => {
    const d = parse('flowchart LR\nA --> B\nB --> C\nC --> A\nB --> D');
    const p = layeredLayout(d, measure);
    expect(p.get('A')!.x).toBeLessThan(p.get('B')!.x);
    expect(p.get('B')!.x).toBeLessThan(p.get('C')!.x);
    expect(p.get('C')!.x).toBe(p.get('D')!.x);
    expect(p.get('C')!.y).not.toBe(p.get('D')!.y);
  });

  it('stacks layers downwards in a top-down chart', () => {
    const p = layeredLayout(parse('flowchart TD\nA --> B'), measure);
    expect(p.get('A')!.x).toBe(p.get('B')!.x);
    expect(p.get('A')!.y).toBeLessThan(p.get('B')!.y);
  });
});

describe('straightening a layout', () => {
  it('puts nearly aligned nodes in line across the flow, on the grid', () => {
    const p = straighten(
      new Map([
        ['a', { x: 41, y: 100 }],
        ['b', { x: 150, y: 92 }],
        ['c', { x: 260, y: 160 }],
      ]),
      'LR',
    );
    expect(p.get('a')).toEqual({ x: 40, y: 104 });
    expect(p.get('b')).toEqual({ x: 152, y: 104 });
    expect(p.get('c')).toEqual({ x: 264, y: 160 });
  });
});

describe('feedback lanes', () => {
  it('ignore nodes below the lane', () => {
    const [, back] = routes(
      'flowchart LR\nA --> B\nB --> A\nH[H]\n%% @pos A 50 50\n%% @pos B 200 50\n%% @pos H 120 400',
    );
    expect(back![1]![1]).toBe(92);
  });
});
