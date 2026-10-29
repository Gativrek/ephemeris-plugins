/**
 * The plugin's own renderer (SPECS 13.1): a diagram in the editable subset, with every
 * node placed, drawn as SVG with orthogonal edges. The canvas draws with it too.
 */
import { boxesOf, extentOf, pathOf, routeEdges, type Box, type Measure, type Route } from './geometry';
import { isMath, type Diagram, type DiagramNode } from './syntax';

const SVG = 'http://www.w3.org/2000/svg';
const PREFIX = 'diagrams';

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  cls?: string,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (cls)
    e.setAttribute(
      'class',
      cls
        .split(' ')
        .map((c) => `${PREFIX}-${c}`)
        .join(' '),
    );
  return e;
}

/** Text and math labels, measured and drawn. Math HTML comes from KaTeX, loaded on demand. */
export interface Labels {
  measure: Measure;
  /** KaTeX HTML for `$$…$$`, or null when math is not loaded (drawn as text). */
  math(tex: string): string | null;
}

const texOf = (label: string) => label.slice(2, -2);

let markerSeq = 0;

export interface Drawing {
  svg: SVGSVGElement;
  boxes: Map<string, Box>;
  routes: Route[];
  /** The drawing's own coordinates: canvas px, before any viewBox scaling. */
  extent: { x: number; y: number; w: number; h: number };
}

function drawLabel(
  parent: SVGElement,
  text: string,
  cx: number,
  cy: number,
  labels: Labels,
  cls: string,
): void {
  const html = isMath(text) ? labels.math(texOf(text)) : null;
  if (html !== null) {
    const s = labels.measure(text);
    const fo = svgEl(
      'foreignObject',
      { x: cx - s.w / 2 - 1, y: cy - s.h / 2, width: s.w + 2, height: s.h },
      cls,
    );
    const div = document.createElement('div');
    div.className = `${PREFIX}-math`;
    div.innerHTML = html;
    fo.append(div);
    parent.append(fo);
    return;
  }
  const t = svgEl('text', { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, cls);
  t.textContent = isMath(text) ? texOf(text) : text;
  parent.append(t);
}

function drawShape(n: DiagramNode, b: Box): SVGElement {
  const { x, y, w, h } = b;
  switch (n.shape) {
    case 'rect':
      return svgEl('rect', { x: x - w / 2, y: y - h / 2, width: w, height: h, rx: 4 }, 'shape');
    case 'circle':
      return svgEl('circle', { cx: x, cy: y, r: w / 2 }, 'shape');
    case 'diamond':
      return svgEl(
        'path',
        { d: `M${x},${y - h / 2}L${x + w / 2},${y}L${x},${y + h / 2}L${x - w / 2},${y}Z` },
        'shape',
      );
    case 'junction': {
      const g = svgEl('g', {}, 'junction');
      const r = w / 2;
      const k = r * Math.SQRT1_2;
      g.append(
        svgEl('circle', { cx: x, cy: y, r }, 'shape'),
        svgEl(
          'path',
          { d: `M${x - k},${y - k}L${x + k},${y + k}M${x - k},${y + k}L${x + k},${y - k}` },
          'cross',
        ),
      );
      return g;
    }
    case 'branch':
      return svgEl('circle', { cx: x, cy: y, r: w / 2 }, 'branch');
    case 'text':
      // No outline; the box only makes the label easy to grab on the canvas.
      return svgEl('rect', { x: x - w / 2, y: y - h / 2, width: w, height: h }, 'text-box');
  }
}

/** Draws a diagram whose nodes all have positions. */
export function drawDiagram(d: Diagram, labels: Labels): Drawing {
  const boxes = boxesOf(d, labels.measure);
  const routes = routeEdges(d, boxes);
  const extent = extentOf(boxes.values(), routes, 24);

  const svg = svgEl('svg', { viewBox: `${extent.x} ${extent.y} ${extent.w} ${extent.h}` }, 'svg');
  const marker = `${PREFIX}-arrow-${++markerSeq}`;
  const defs = svgEl('defs');
  const m = svgEl('marker', {
    id: marker,
    viewBox: '0 0 10 10',
    refX: 10,
    refY: 5,
    markerWidth: 8,
    markerHeight: 8,
    markerUnits: 'userSpaceOnUse',
    orient: 'auto-start-reverse',
  });
  m.append(svgEl('path', { d: 'M0,0L10,5L0,10Z' }, 'arrowhead'));
  defs.append(m);
  svg.append(defs);

  const edgeLayer = svgEl('g', {}, 'edges');
  for (const r of routes) {
    const g = svgEl('g', { 'data-edge': d.edges.indexOf(r.edge) }, 'edge');
    const p = svgEl('path', { d: pathOf(r.points) }, 'line');
    if (r.edge.arrow) p.setAttribute('marker-end', `url(#${marker})`);
    g.append(p);
    edgeLayer.append(g);
  }
  svg.append(edgeLayer);

  const nodeLayer = svgEl('g', {}, 'nodes');
  for (const n of d.nodes) {
    const b = boxes.get(n.id)!;
    const g = svgEl('g', { 'data-id': n.id }, `node ${n.shape}`);
    g.append(drawShape(n, b));
    if (n.shape !== 'junction' && n.shape !== 'branch' && n.label)
      drawLabel(g, n.label, b.x, b.y, labels, 'label');
    nodeLayer.append(g);
  }
  svg.append(nodeLayer);

  const labelLayer = svgEl('g', {}, 'edge-labels');
  for (const r of routes) {
    if (!r.edge.label) continue;
    const idx = d.edges.indexOf(r.edge);
    if (r.signAt) {
      const t = svgEl(
        'text',
        {
          x: r.signAt.x,
          y: r.signAt.y,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          'data-edge': idx,
        },
        'sign',
      );
      t.textContent = r.edge.label === '+' ? '+' : '−';
      labelLayer.append(t);
      continue;
    }
    const s = labels.measure(r.edge.label);
    const g = svgEl('g', { 'data-edge': idx }, 'chip');
    g.append(
      svgEl(
        'rect',
        {
          x: r.labelAt.x - s.w / 2 - 4,
          y: r.labelAt.y - s.h / 2 - 1,
          width: s.w + 8,
          height: s.h + 2,
          rx: 3,
        },
        'chip-bg',
      ),
    );
    drawLabel(g, r.edge.label, r.labelAt.x, r.labelAt.y, labels, 'edge-label');
    labelLayer.append(g);
  }
  svg.append(labelLayer);
  return { svg, boxes, routes, extent };
}
