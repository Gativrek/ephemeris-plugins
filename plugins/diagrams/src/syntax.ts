/**
 * The editable subset of Mermaid flowcharts (SPECS 13.1), with the control diagram
 * extensions: a header, nodes, edges, `%% @pos` lines and comments. Anything else is
 * not in the subset: the block renders through Mermaid and the canvas is read-only.
 */

export type Dir = 'TD' | 'TB' | 'LR' | 'RL' | 'BT';
export type Shape = 'rect' | 'circle' | 'diamond' | 'junction' | 'branch' | 'text';

export interface DiagramNode {
  id: string;
  shape: Shape;
  /** Shown text; `$$…$$` is math. Empty for junctions and branch points. */
  label: string;
  /** Centre, in canvas px, from `%% @pos`. */
  x?: number;
  y?: number;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label: string;
  /** `-->` draws an arrowhead, `---` does not. */
  arrow: boolean;
}

export interface Diagram {
  keyword: 'flowchart' | 'graph';
  dir: Dir;
  /** In creation order. */
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** `%%` comments other than `@pos`, kept verbatim. */
  comments: string[];
}

export type ParseResult = { ok: true; diagram: Diagram } | { ok: false; line: number; reason: string };

const ID = '[A-Za-z][A-Za-z0-9_]*';
const HEADER = /^(flowchart|graph)\s+(TD|TB|LR|RL|BT)\s*;?$/;
const POS = new RegExp(`^%%\\s*@pos\\s+(${ID})\\s+(-?\\d+(?:\\.\\d+)?)\\s+(-?\\d+(?:\\.\\d+)?)\\s*$`);
/** Mermaid reads `end` as a keyword, so it cannot name a node. */
const RESERVED = new Set([
  'end',
  'subgraph',
  'graph',
  'flowchart',
  'style',
  'classDef',
  'class',
  'click',
  'linkStyle',
]);

const SHAPES: Record<string, Shape> = { 'cross-circ': 'junction', 'f-circ': 'branch', text: 'text' };
const SIGNS = new Set(['+', '-', '−']);

/** True when an edge's label is a sign at a summing junction (drawn beside the arrowhead). */
export function isSign(d: Diagram, e: DiagramEdge): boolean {
  return SIGNS.has(e.label) && d.nodes.find((n) => n.id === e.to)?.shape === 'junction';
}

export const isMath = (label: string) => /^\$\$[\s\S]+\$\$$/.test(label);

/** Mermaid's entity for a double quote inside a quoted label. */
const decode = (s: string) => s.replace(/#quot;/g, '"');
const encode = (s: string) => s.replace(/"/g, '#quot;');

class Scanner {
  i = 0;
  constructor(readonly text: string) {}
  get rest(): string {
    return this.text.slice(this.i);
  }
  ws(): void {
    while (this.i < this.text.length && /\s/.test(this.text[this.i]!)) this.i++;
  }
  take(re: RegExp): RegExpExecArray | null {
    const m = re.exec(this.rest);
    if (!m || m.index !== 0) return null;
    this.i += m[0].length;
    return m;
  }
  done(): boolean {
    this.ws();
    if (this.text[this.i] === ';') this.i++;
    this.ws();
    return this.i >= this.text.length;
  }
}

/** A label between delimiters: quoted (`"…"`), or plain text without brackets, braces, pipes or quotes. */
function label(sc: Scanner, close: string): string | null {
  const quoted = sc.take(new RegExp(`^"([^"]*)"${escape(close)}`));
  if (quoted) return decode(quoted[1]!).trim();
  const plain = sc.take(new RegExp(`^([^\\[\\]{}()|"]*)${escape(close)}`));
  return plain ? plain[1]!.trim() : null;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type NodeRef = { id: string; shape?: Shape; label?: string };

function nodeRef(sc: Scanner): NodeRef | null {
  const id = sc.take(new RegExp(`^${ID}`))?.[0];
  if (!id || RESERVED.has(id)) return null;
  if (sc.take(/^\(\(/)) {
    const l = label(sc, '))');
    return l === null ? null : { id, shape: 'circle', label: l };
  }
  if (sc.take(/^\[/)) {
    const l = label(sc, ']');
    return l === null ? null : { id, shape: 'rect', label: l };
  }
  if (sc.take(/^\{/)) {
    const l = label(sc, '}');
    return l === null ? null : { id, shape: 'diamond', label: l };
  }
  const at = sc.take(/^@\{\s*shape:\s*([a-z-]+)\s*(?:,\s*label:\s*"([^"]*)"\s*)?\}/);
  if (at) {
    const shape = SHAPES[at[1]!];
    // Only text carries a label; a junction or branch point with one is outside the subset.
    if (!shape || (shape !== 'text' && at[2] !== undefined)) return null;
    return { id, shape, label: decode(at[2] ?? '').trim() };
  }
  // A bare reference must not run into another shape syntax: A(x), A>x], A[(x)].
  if (/^[([{>@]/.test(sc.rest)) return null;
  return { id };
}

export function parseDiagram(source: string): ParseResult {
  const lines = source.split('\n');
  let header: { keyword: 'flowchart' | 'graph'; dir: Dir } | null = null;
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const comments: string[] = [];
  const pos = new Map<string, [number, number]>();
  const fail = (line: number, reason: string): ParseResult => ({ ok: false, line, reason });

  const define = (ref: NodeRef) => {
    const known = nodes.get(ref.id);
    if (!known) nodes.set(ref.id, { id: ref.id, shape: ref.shape ?? 'rect', label: ref.label ?? ref.id });
    else if (ref.shape) Object.assign(known, { shape: ref.shape, label: ref.label ?? '' });
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = idx + 1;
    const text = lines[idx]!.trim();
    if (!text) continue;
    if (text.startsWith('%%')) {
      if (text.startsWith('%%{')) return fail(line, 'directives');
      const p = POS.exec(text);
      if (p) pos.set(p[1]!, [Number(p[2]), Number(p[3])]);
      else comments.push(lines[idx]!.trimEnd());
      continue;
    }
    if (!header) {
      const h = HEADER.exec(text);
      if (!h) return fail(line, 'the first line must be "flowchart" or "graph" and a direction');
      header = { keyword: h[1] as 'flowchart' | 'graph', dir: h[2] as Dir };
      continue;
    }
    const sc = new Scanner(text);
    const a = nodeRef(sc);
    if (!a) return fail(line, 'not a node or an edge the editor supports');
    sc.ws();
    if (sc.done()) {
      define(a);
      continue;
    }
    const arrow = sc.take(/^(-->|---)(?![-.>=])/);
    if (!arrow) return fail(line, 'only --> and --- arrows are supported');
    let edgeLabel = '';
    if (sc.take(/^\|/)) {
      const l = label(sc, '|');
      if (l === null) return fail(line, 'unclosed edge label');
      edgeLabel = l;
    }
    sc.ws();
    const b = nodeRef(sc);
    if (!b || !sc.done()) return fail(line, 'only one edge per line is supported');
    define(a);
    define(b);
    edges.push({ from: a.id, to: b.id, label: edgeLabel, arrow: arrow[1] === '-->' });
  }
  if (!header) return fail(1, 'no "flowchart" header');
  for (const [id, [x, y]] of pos) {
    const n = nodes.get(id);
    if (n) Object.assign(n, { x, y });
  }
  return { ok: true, diagram: { ...header, nodes: [...nodes.values()], edges, comments } };
}

/** Plain labels stay unquoted; anything Mermaid would misread is quoted. */
function quote(text: string): string {
  // Mermaid needs something between the brackets; a quoted space reads back as empty.
  if (!text) return '" "';
  const plain = /^[\p{L}\p{N} _.,:;!?'+\-−*/=]*$/u.test(text) && !/^[\s/\\]|\s$/.test(text);
  return plain ? text : `"${encode(text)}"`;
}

function nodeText(n: DiagramNode): string {
  switch (n.shape) {
    case 'rect':
      return `${n.id}[${quote(n.label)}]`;
    case 'circle':
      return `${n.id}((${quote(n.label)}))`;
    case 'diamond':
      return `${n.id}{${quote(n.label)}}`;
    case 'junction':
      return `${n.id}@{ shape: cross-circ }`;
    case 'branch':
      return `${n.id}@{ shape: f-circ }`;
    case 'text':
      return `${n.id}@{ shape: text, label: "${encode(n.label)}" }`;
  }
}

const round = (v: number) => Math.round(v);

/** Header, nodes in creation order, edges, `@pos` lines, then the other comments (SPECS 13.1). */
export function serializeDiagram(d: Diagram): string {
  const out = [`${d.keyword} ${d.dir}`];
  for (const n of d.nodes) out.push(`  ${nodeText(n)}`);
  for (const e of d.edges) {
    const l = isSign(d, e) ? (e.label === '+' ? '+' : '-') : e.label;
    out.push(`  ${e.from} ${e.arrow ? '-->' : '---'}${l ? `|${quote(l)}|` : ''} ${e.to}`);
  }
  for (const n of d.nodes)
    if (n.x !== undefined && n.y !== undefined) out.push(`  %% @pos ${n.id} ${round(n.x)} ${round(n.y)}`);
  for (const c of d.comments) out.push(c);
  return out.join('\n');
}

export const hasAllPositions = (d: Diagram) => d.nodes.every((n) => n.x !== undefined && n.y !== undefined);
