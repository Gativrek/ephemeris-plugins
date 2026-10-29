import { describe, expect, it } from 'vitest';
import { hasAllPositions, isSign, parseDiagram, serializeDiagram, type Diagram } from './syntax';

const parse = (s: string): Diagram => {
  const r = parseDiagram(s);
  if (!r.ok) throw new Error(`line ${r.line}: ${r.reason}`);
  return r.diagram;
};

describe('the editable subset', () => {
  it('reads the three shapes, both arrows, labels and positions', () => {
    const d = parse(
      [
        'flowchart TD',
        '  A[Start] --> B{Ready?}',
        '  B -->|yes| C((Done))',
        '  B --- A',
        '  %% @pos A 100 40',
        '  %% a note',
      ].join('\n'),
    );
    expect(d.dir).toBe('TD');
    expect(d.nodes).toEqual([
      { id: 'A', shape: 'rect', label: 'Start', x: 100, y: 40 },
      { id: 'B', shape: 'diamond', label: 'Ready?' },
      { id: 'C', shape: 'circle', label: 'Done' },
    ]);
    expect(d.edges).toEqual([
      { from: 'A', to: 'B', label: '', arrow: true },
      { from: 'B', to: 'C', label: 'yes', arrow: true },
      { from: 'B', to: 'A', label: '', arrow: false },
    ]);
    expect(d.comments).toEqual(['  %% a note']);
    expect(hasAllPositions(d)).toBe(false);
  });

  it('reads junctions, branch points, signs and math labels', () => {
    const d = parse(
      [
        'flowchart LR',
        '  r[r] --> e@{ shape: cross-circ }',
        '  e --> G["$$G(s)$$"]',
        '  G --> b@{ shape: f-circ }',
        '  b -->|-| e',
        '  b -->|"$$y$$"| y[ ]',
      ].join('\n'),
    );
    expect(d.nodes.map((n) => [n.id, n.shape, n.label])).toEqual([
      ['r', 'rect', 'r'],
      ['e', 'junction', ''],
      ['G', 'rect', '$$G(s)$$'],
      ['b', 'branch', ''],
      ['y', 'rect', ''],
    ]);
    expect(isSign(d, d.edges[3]!)).toBe(true);
    expect(isSign(d, d.edges[4]!)).toBe(false);
    expect(d.edges[4]!.label).toBe('$$y$$');
  });

  it('a node referenced before it is defined takes the later shape', () => {
    const d = parse('graph LR\nA --> B\nB((Hi))');
    expect(d.nodes[1]).toEqual({ id: 'B', shape: 'circle', label: 'Hi' });
    expect(d.nodes[0]).toEqual({ id: 'A', shape: 'rect', label: 'A' });
  });

  it.each([
    ['flowchart', 'no direction'],
    ['sequenceDiagram\nA->>B: hi', 'another diagram type'],
    ['flowchart LR\nA --> B --> C', 'a chain'],
    ['flowchart LR\nA -.-> B', 'a dotted arrow'],
    ['flowchart LR\nA ==> B', 'a thick arrow'],
    ['flowchart LR\nA -- text --> B', 'the long label form'],
    ['flowchart LR\nA(round)', 'a rounded node'],
    ['flowchart LR\nA[(db)]', 'a cylinder'],
    ['flowchart LR\nA{{hex}}', 'a hexagon'],
    ['flowchart LR\nA(((x)))', 'a double circle'],
    ['flowchart LR\nA@{ shape: stadium }', 'another @-shape'],
    ['flowchart LR\nsubgraph S\nA\nend', 'a subgraph'],
    ['flowchart LR\nA --> B\nstyle A fill:#f00', 'styles'],
    ['%%{init: {}}%%\nflowchart LR\nA', 'a directive'],
    ['flowchart LR\nend --> A', 'the end keyword'],
  ])('%s is outside the subset (%s)', (src) => {
    expect(parseDiagram(src).ok).toBe(false);
  });
});

describe('serializing', () => {
  it('writes header, nodes, edges, positions, then comments', () => {
    const d = parse(
      'flowchart LR\n%% keep me\nA[Plant] -->|u| B((x))\nB --- A\n%% @pos B 200 50\n%% @pos A 80 50\n%% @pos Gone 1 1',
    );
    expect(serializeDiagram(d)).toBe(
      [
        'flowchart LR',
        '  A[Plant]',
        '  B((x))',
        '  A -->|u| B',
        '  B --- A',
        '  %% @pos A 80 50',
        '  %% @pos B 200 50',
        '%% keep me',
      ].join('\n'),
    );
  });

  it('quotes labels Mermaid would misread, and round-trips them', () => {
    const d = parse('flowchart LR\nA["G(s) [1]"] -->|"a|b"| B["say #quot;hi#quot;"]\nC["$$\\frac{1}{s}$$"]');
    const text = serializeDiagram(d);
    expect(text).toContain('A["G(s) [1]"]');
    expect(text).toContain('-->|"a|b"|');
    expect(text).toContain('B["say #quot;hi#quot;"]');
    expect(text).toContain('C["$$\\frac{1}{s}$$"]');
    expect(parse(text)).toEqual(d);
  });

  it('writes junction shapes and ASCII signs', () => {
    const d = parse('flowchart LR\ne@{ shape: cross-circ } --> b@{ shape: f-circ }\nb -->|−| e');
    expect(serializeDiagram(d)).toBe(
      'flowchart LR\n  e@{ shape: cross-circ }\n  b@{ shape: f-circ }\n  e --> b\n  b -->|-| e',
    );
  });

  it('round-trips a whole control loop', () => {
    const src = [
      'flowchart LR',
      '  r[ ]',
      '  e@{ shape: cross-circ }',
      '  C["$$C(s)$$"]',
      '  G["$$G(s)$$"]',
      '  b@{ shape: f-circ }',
      '  y[ ]',
      '  r -->|r| e',
      '  e -->|+| C',
      '  C --> G',
      '  G --- b',
      '  b --> y',
      '  b -->|-| e',
      '  %% @pos r 40 60',
    ].join('\n');
    expect(serializeDiagram(parse(src))).toBe(
      src.replace('  r[ ]', '  r[" "]').replace('  y[ ]', '  y[" "]'),
    );
  });
});
