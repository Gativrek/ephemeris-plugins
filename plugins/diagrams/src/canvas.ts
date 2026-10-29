/**
 * The canvas (SPECS 13.1), in a full-size overlay: place, move, connect, relabel and
 * delete nodes, with undo and redo while it is open. Done writes the block once (one
 * undo step in the note). A diagram outside the editable subset opens read-only.
 */
import type { BlockHost, BlockInfo, OverlayHandle, PluginContext } from '@ephemeris-notes/plugin-api';
import { nodeSize, pathOf, routeEdges } from './geometry';
import { nearestInDirection, nextFreeSpot, type Direction } from './keyboard';
import { layeredLayout, normalize, straighten } from './layout';
import { loadMath, makeLabels, mathLoaded, needsMath } from './labels';
import { positionsFromSvg, renderMermaid } from './mermaid';
import { drawDiagram, svgEl, type Drawing } from './render';
import { isSign, parseDiagram, serializeDiagram, type Diagram, type DiagramNode, type Shape } from './syntax';

type Tool = 'select' | 'connect' | Shape;
type Selection = { kind: 'node'; id: string } | { kind: 'edge'; index: number } | null;

const GRID = 8;
const TOOLS: Array<{ tool: Tool; label: string; key: string }> = [
  { tool: 'select', label: 'Select', key: 'v' },
  { tool: 'rect', label: 'Rectangle', key: 'r' },
  { tool: 'circle', label: 'Circle', key: 'c' },
  { tool: 'diamond', label: 'Diamond', key: 'd' },
  { tool: 'junction', label: 'Junction', key: 'j' },
  { tool: 'branch', label: 'Branch', key: 'b' },
  { tool: 'text', label: 'Text', key: 't' },
  { tool: 'connect', label: 'Connect', key: 'l' },
];
const ARROWS: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};
const SHAPE_NAME: Record<Shape, string> = {
  rect: 'rectangle',
  circle: 'circle',
  diamond: 'diamond',
  junction: 'junction',
  branch: 'branch point',
  text: 'text label',
};
/** The shortcut list behind the Keys button and `?`. */
const KEYS: Array<{ group: string; keys: Array<[string, string]> }> = [
  {
    group: 'Tools',
    keys: [
      ['V', 'Select'],
      ['R  C  D', 'Rectangle, circle, diamond'],
      ['J  B  T', 'Junction, branch point, text'],
      ['L', 'Connect (with a node selected: connect from it)'],
      ['Enter', 'With a shape tool: place it next to the selection, connected'],
    ],
  },
  {
    group: 'Selection',
    keys: [
      ['Tab  Shift+Tab', 'Next or previous node, then edges'],
      ['Alt+Arrows', 'The nearest node in that direction'],
      ['Arrows', 'Move the selected node (Shift: further)'],
      ['Enter', 'Rename; on a junction sign, flip it'],
      ['Delete', 'Remove the selection'],
      ['Esc', 'Clear the selection or the tool'],
    ],
  },
  {
    group: 'Connecting from the keyboard',
    keys: [
      ['Arrows  Tab', 'Choose the target'],
      ['Enter', 'Connect'],
      ['Esc', 'Cancel'],
    ],
  },
  {
    group: 'View and history',
    keys: [
      ['Wheel', 'Zoom'],
      ['Drag  Space+drag', 'Pan'],
      ['G', 'Snap to the grid on or off'],
      ['Ctrl+Z  Ctrl+Shift+Z', 'Undo, redo'],
      ['?', 'Show or hide this list'],
    ],
  },
];
const DEFAULT_LABEL: Partial<Record<Shape, string>> = {
  rect: 'Block',
  circle: 'State',
  diamond: 'Choice?',
  text: 'Text',
};
const ID_PREFIX: Record<Shape, string> = {
  rect: 'n',
  circle: 'n',
  diamond: 'n',
  junction: 'sum',
  branch: 'pt',
  text: 't',
};

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls
    .split(' ')
    .map((c) => (c.startsWith('vx-') ? c : `diagrams-${c}`))
    .join(' ');
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Places nodes without `@pos`: Mermaid's layout first, so the canvas starts from what the note showed. */
async function placeMissing(d: Diagram, source: string, ctx: PluginContext): Promise<void> {
  const missing = d.nodes.filter((n) => n.x === undefined || n.y === undefined);
  if (!missing.length) return;
  let pos: Map<string, { x: number; y: number }> | null = null;
  try {
    pos = positionsFromSvg(
      await renderMermaid(source, ctx.theme),
      d.nodes.map((n) => n.id),
    );
    if (pos) pos = straighten(normalize(pos), d.dir);
  } catch (err) {
    ctx.log.warn('Mermaid layout unavailable, using the layered layout', err);
  }
  pos ??= layeredLayout(d, makeLabels().measure);
  for (const n of missing) Object.assign(n, pos.get(n.id) ?? { x: 80, y: 60 });
}

export async function openCanvas(info: BlockInfo, host: BlockHost, ctx: PluginContext): Promise<void> {
  const parsed = parseDiagram(info.source);
  if (!parsed.ok) return openReadOnly(info, host, ctx, parsed.line, parsed.reason);
  const d = parsed.diagram;
  await placeMissing(d, info.source, ctx);
  const labels = () => [...d.nodes.map((n) => n.label), ...d.edges.map((e) => e.label)];
  if (needsMath(labels())) await loadMath();
  // Placing nodes is not a change: Done without edits writes nothing (SPECS 13.1).
  new CanvasEditor(d, serializeDiagram(d), info, host, ctx).open();
}

function openReadOnly(
  info: BlockInfo,
  host: BlockHost,
  ctx: PluginContext,
  line: number,
  reason: string,
): void {
  host.openOverlay({
    title: 'Diagram',
    size: 'large',
    render: (root) => {
      const wrap = el('div', 'canvas-readonly');
      const note = el('p', 'canvas-note', 'This diagram uses Mermaid features the editor does not support.');
      const why = el('p', 'canvas-why', `Line ${line}: ${reason}.`);
      const view = el('div', 'canvas-mermaid');
      wrap.append(note, why, view);
      root.append(wrap);
      renderMermaid(info.source, ctx.theme).then(
        (svg) => {
          view.innerHTML = svg;
        },
        (err: unknown) => {
          view.textContent = err instanceof Error ? err.message : String(err);
        },
      );
    },
  });
}

class CanvasEditor {
  private tool: Tool = 'select';
  private sel: Selection = null;
  private snap = true;
  private view = { tx: 0, ty: 0, k: 1 };
  private history: string[] = [];
  private at = 0;
  private drawing: Drawing | null = null;
  private overlay: OverlayHandle | null = null;
  private root!: HTMLElement;
  private stage!: SVGSVGElement;
  private content!: SVGGElement;
  private preview!: SVGPathElement;
  private toolButtons = new Map<Tool, HTMLButtonElement>();
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private snapBtn!: HTMLButtonElement;
  private status!: HTMLElement;
  private editing: HTMLInputElement | null = null;
  private space = false;
  private closing: ((ok: boolean) => void) | null = null;
  /** Set once the changes are applied, so closing does not ask again. */
  private forceClose = false;
  /** Connecting from the keyboard: the source and the chosen target. */
  private linking: { from: string; to: string | null } | null = null;
  private keysPanel!: HTMLElement;
  private keysBtn!: HTMLButtonElement;

  constructor(
    private d: Diagram,
    private readonly initial: string,
    private readonly info: BlockInfo,
    private readonly host: BlockHost,
    private readonly ctx: PluginContext,
  ) {
    this.history = [JSON.stringify(d)];
  }

  open(): void {
    this.overlay = this.host.openOverlay({
      title: 'Edit diagram',
      size: 'full',
      render: (root) => this.mount(root),
      onRequestClose: () => this.requestClose(),
    });
  }

  // ---- State -------------------------------------------------------------------

  private get dirty(): boolean {
    return serializeDiagram(this.d) !== this.initial;
  }

  /** Records the current diagram as one undo step. */
  private commit(): void {
    const snap = JSON.stringify(this.d);
    if (snap === this.history[this.at]) return this.redraw();
    this.history = this.history.slice(0, this.at + 1);
    this.history.push(snap);
    this.at = this.history.length - 1;
    this.redraw();
  }

  private restore(i: number): void {
    if (i < 0 || i >= this.history.length) return;
    this.at = i;
    this.d = JSON.parse(this.history[i]!) as Diagram;
    if (this.sel?.kind === 'node' && !this.node(this.sel.id)) this.sel = null;
    if (this.sel?.kind === 'edge' && !this.d.edges[this.sel.index]) this.sel = null;
    this.redraw();
  }

  private node(id: string): DiagramNode | undefined {
    return this.d.nodes.find((n) => n.id === id);
  }

  private newId(shape: Shape): string {
    const prefix = ID_PREFIX[shape];
    let i = 1;
    while (this.node(`${prefix}${i}`)) i++;
    return `${prefix}${i}`;
  }

  private snapped(v: number): number {
    return this.snap ? Math.round(v / GRID) * GRID : Math.round(v);
  }

  // ---- DOM ---------------------------------------------------------------------

  private mount(root: HTMLElement): () => void {
    this.root = el('div', 'canvas');
    this.root.tabIndex = 0;
    const bar = el('div', 'canvas-bar');
    const tools = el('div', 'vx-segmented vx-segmented--small');
    tools.setAttribute('role', 'toolbar');
    tools.setAttribute('aria-label', 'Tools');
    for (const t of TOOLS) {
      const b = el('button', 'tool', t.label);
      b.append(el('kbd', 'kbd', t.key.toUpperCase()));
      b.type = 'button';
      b.title = `${t.label} (${t.key.toUpperCase()})`;
      b.addEventListener('click', () => {
        this.setTool(t.tool);
        this.root.focus();
      });
      this.toolButtons.set(t.tool, b);
      tools.append(b);
    }
    const button = (label: string, title: string, run: () => void, cls = 'vx-btn vx-btn--small') => {
      const b = el('button', cls, label);
      b.type = 'button';
      b.title = title;
      b.addEventListener('click', run);
      return b;
    };
    this.undoBtn = button('Undo', 'Undo (Ctrl+Z)', () => this.restore(this.at - 1));
    this.redoBtn = button('Redo', 'Redo (Ctrl+Shift+Z)', () => this.restore(this.at + 1));
    this.snapBtn = button('Snap', 'Snap to an 8px grid (G)', () => {
      this.snap = !this.snap;
      this.redraw();
    });
    this.keysBtn = button('Keys', 'Keyboard shortcuts (?)', () => this.toggleKeys());
    this.keysBtn.append(el('kbd', 'kbd', '?'));
    const spacer = el('div', 'canvas-spacer');
    const cancel = button('Cancel', 'Close without applying', () => this.overlay?.close());
    const done = button(
      'Done',
      'Apply and close',
      () => void this.apply(),
      'vx-btn vx-btn--small vx-btn--primary',
    );
    bar.append(tools, this.undoBtn, this.redoBtn, this.snapBtn, this.keysBtn, spacer, cancel, done);

    this.keysPanel = el('div', 'canvas-keys');
    this.keysPanel.hidden = true;
    this.keysPanel.setAttribute('aria-label', 'Keyboard shortcuts');
    for (const g of KEYS) {
      this.keysPanel.append(el('p', 'canvas-keys-group', g.group));
      const list = el('dl', 'canvas-keys-list');
      for (const [k, what] of g.keys) {
        const dt = el('dt', 'canvas-keys-key');
        for (const part of k.split('  ')) dt.append(el('kbd', 'kbd', part));
        list.append(dt, el('dd', 'canvas-keys-what', what));
      }
      this.keysPanel.append(list);
    }

    this.stage = svgEl('svg', {}, 'stage');
    const defs = svgEl('defs');
    const grid = svgEl('pattern', {
      id: 'diagrams-grid',
      width: GRID,
      height: GRID,
      patternUnits: 'userSpaceOnUse',
    });
    grid.append(svgEl('circle', { cx: 0.5, cy: 0.5, r: 0.5 }, 'grid-dot'));
    defs.append(grid);
    this.stage.append(defs);
    this.content = svgEl('g', {}, 'viewport');
    this.stage.append(this.content);
    this.preview = svgEl('path', { d: '' }, 'preview');

    this.status = el('div', 'canvas-status');
    this.status.setAttribute('aria-live', 'polite');
    this.root.append(bar, this.stage, this.keysPanel, this.status);
    root.append(this.root);

    this.bind();
    // The overlay closes on Esc from a window capture listener. This one is added first
    // (the canvas mounts before the overlay's listener), so Esc cancels what is in
    // progress on the canvas and only closes the overlay when there is nothing left.
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !this.root.contains(document.activeElement)) return;
      if (!this.cancelSomething()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onEscape, true);
    requestAnimationFrame(() => {
      this.redraw();
      this.fit();
      this.root.focus();
    });
    return () => {
      window.removeEventListener('keydown', onEscape, true);
      this.editing?.remove();
    };
  }

  /** Esc: the innermost thing in progress, if any. True when something was cancelled. */
  private cancelSomething(): boolean {
    if (this.root.querySelector('.diagrams-ask')) return false;
    if (this.editing) this.finishEdit(false);
    else if (this.linking) {
      this.linking = null;
      this.redraw();
    } else if (!this.keysPanel.hidden) this.toggleKeys(false);
    else if (this.tool !== 'select' || this.sel) {
      this.tool = 'select';
      this.sel = null;
      this.redraw();
    } else return false;
    return true;
  }

  private setTool(t: Tool): void {
    this.tool = t;
    this.redrawChrome();
  }

  private redrawChrome(): void {
    for (const [t, b] of this.toolButtons) b.setAttribute('aria-pressed', String(t === this.tool));
    this.undoBtn.disabled = this.at === 0;
    this.redoBtn.disabled = this.at === this.history.length - 1;
    this.snapBtn.setAttribute('aria-pressed', String(this.snap));
    this.overlay?.setDirty(this.dirty);
    this.stage.dataset.tool = this.tool;
    this.keysBtn.setAttribute('aria-pressed', String(!this.keysPanel.hidden));
    this.drawStatus();
  }

  /** What can be done now, with the keys that do it. */
  private drawStatus(): void {
    const parts: Array<[string, string] | string> = [];
    const name = (id: string) => {
      const n = this.node(id);
      if (n?.shape === 'junction' || n?.shape === 'branch') return `${SHAPE_NAME[n.shape]} ${id}`;
      return n?.label || id;
    };
    if (this.linking) {
      const to = this.linking.to;
      parts.push(`Connect ${name(this.linking.from)} to ${to ? name(to) : '…'}`);
      parts.push(['Arrows  Tab', 'choose'], ['Enter', 'connect'], ['Esc', 'cancel']);
    } else if (this.tool === 'connect') {
      parts.push('Drag from one node to another', ['Esc', 'back to Select']);
    } else if (this.tool !== 'select') {
      const what = SHAPE_NAME[this.tool];
      parts.push(`Click to place a ${what}`);
      if (this.sel?.kind === 'node') parts.push(['Enter', `place it after ${name(this.sel.id)}, connected`]);
      else parts.push(['Enter', 'place it in the middle']);
      parts.push(['Esc', 'back to Select']);
    } else if (this.sel?.kind === 'node') {
      const n = this.node(this.sel.id);
      parts.push(`${name(this.sel.id)} selected`);
      if (n && n.shape !== 'junction' && n.shape !== 'branch') parts.push(['Enter', 'rename']);
      parts.push(
        ['L', 'connect'],
        ['R…  Enter', 'add one after it'],
        ['Arrows', 'move'],
        ['Alt+Arrows', 'select nearby'],
      );
      parts.push(['Tab', 'next'], ['Delete', 'remove']);
    } else if (this.sel?.kind === 'edge') {
      const e = this.d.edges[this.sel.index];
      parts.push(e ? `Edge ${name(e.from)} → ${name(e.to)} selected` : 'Edge selected');
      parts.push(
        ['Enter', e && isSign(this.d, e) ? 'flip the sign' : 'rename'],
        ['Tab', 'next'],
        ['Delete', 'remove'],
      );
    } else {
      parts.push(
        ['V R C D J B T L', 'tools'],
        ['Tab', 'select a node'],
        ['Ctrl+Z', 'undo'],
        ['?', 'all keys'],
      );
    }
    this.status.replaceChildren();
    for (const p of parts) {
      const item = el('span', 'canvas-hint');
      if (typeof p === 'string') item.textContent = p;
      else {
        for (const k of p[0].split('  ')) item.append(el('kbd', 'kbd', k));
        item.append(` ${p[1]}`);
      }
      this.status.append(item);
    }
  }

  private toggleKeys(show = this.keysPanel.hidden): void {
    this.keysPanel.hidden = !show;
    this.redrawChrome();
  }

  /** Redraws the diagram, the selection and its handles. */
  private redraw(): void {
    // Math typed into a new label needs KaTeX: draw it as text now, and again once loaded.
    const labels = [...this.d.nodes.map((n) => n.label), ...this.d.edges.map((e) => e.label)];
    if (needsMath(labels) && !mathLoaded()) void loadMath().then(() => this.redraw());
    this.drawing = drawDiagram(this.d, makeLabels());
    const parts = [...this.drawing.svg.childNodes];
    this.content.replaceChildren(
      svgEl('rect', { x: -5000, y: -5000, width: 10000, height: 10000, fill: 'url(#diagrams-grid)' }, 'grid'),
      ...parts,
    );
    // Wide invisible strokes make edges easy to hit.
    for (const g of this.content.querySelectorAll<SVGGElement>('.diagrams-edge')) {
      const p = g.querySelector('path');
      if (p) g.prepend(svgEl('path', { d: p.getAttribute('d') ?? '' }, 'edge-hit'));
    }
    if (this.sel?.kind === 'node') {
      const g = this.content.querySelector(`[data-id="${this.sel.id}"]`);
      g?.classList.add('diagrams-is-selected');
      const b = this.drawing.boxes.get(this.sel.id);
      if (b) {
        const handles = svgEl('g', {}, 'handles');
        for (const [hx, hy] of [
          [b.x + b.w / 2, b.y],
          [b.x, b.y + b.h / 2],
          [b.x - b.w / 2, b.y],
          [b.x, b.y - b.h / 2],
        ] as const)
          handles.append(svgEl('circle', { cx: hx, cy: hy, r: 5, 'data-handle': this.sel.id }, 'handle'));
        this.content.append(handles);
      }
    } else if (this.sel?.kind === 'edge') {
      for (const g of this.content.querySelectorAll(`[data-edge="${this.sel.index}"]`))
        g.classList.add('diagrams-is-selected');
    }
    // Connecting from the keyboard: the chosen target, and the route the edge would take.
    const to = this.linking?.to;
    let preview = '';
    if (this.linking && to) {
      this.content.querySelector(`[data-id="${to}"]`)?.classList.add('diagrams-is-target');
      const edge = { from: this.linking.from, to, label: '', arrow: true };
      const routes = routeEdges({ ...this.d, edges: [...this.d.edges, edge] }, this.drawing.boxes);
      const r = routes.find((x) => x.edge === edge);
      if (r) preview = pathOf(r.points);
    }
    this.preview.setAttribute('d', preview);
    this.content.append(this.preview);
    this.applyView();
    this.redrawChrome();
  }

  private applyView(): void {
    const { tx, ty, k } = this.view;
    this.content.setAttribute('transform', `translate(${tx},${ty}) scale(${k})`);
  }

  /** Fits the diagram in the stage, at most at 100%. */
  private fit(): void {
    if (!this.drawing) return;
    const r = this.stage.getBoundingClientRect();
    const e = this.drawing.extent;
    const k = Math.min(1, (r.width - 80) / e.w, (r.height - 80) / e.h);
    this.view = { k, tx: (r.width - e.w * k) / 2 - e.x * k, ty: (r.height - e.h * k) / 2 - e.y * k };
    this.applyView();
  }

  private toWorld(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.stage.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - this.view.tx) / this.view.k,
      y: (e.clientY - r.top - this.view.ty) / this.view.k,
    };
  }

  private toScreen(p: { x: number; y: number }): { x: number; y: number } {
    return { x: p.x * this.view.k + this.view.tx, y: p.y * this.view.k + this.view.ty };
  }

  // ---- Input -------------------------------------------------------------------

  private bind(): void {
    let drag:
      | { kind: 'move'; id: string; dx: number; dy: number; moved: boolean }
      | { kind: 'pan'; x: number; y: number; tx: number; ty: number }
      | { kind: 'connect'; from: string }
      | null = null;
    let lastPress: { key: string | null; t: number; x: number; y: number } = { key: null, t: 0, x: 0, y: 0 };

    const hit = (t: EventTarget | null) => {
      const target = t as Element | null;
      const handle = target?.closest('[data-handle]')?.getAttribute('data-handle');
      if (handle) return { handle };
      const id = target?.closest('[data-id]')?.getAttribute('data-id');
      if (id) return { id };
      const edge = target?.closest('[data-edge]')?.getAttribute('data-edge');
      if (edge !== null && edge !== undefined) return { edge: Number(edge) };
      return {};
    };

    this.stage.addEventListener('pointerdown', (e) => {
      // Focus is managed here: the browser's own focus change on press would take it
      // from a label input opened by this same press (placing a node).
      e.preventDefault();
      this.finishEdit(true);
      this.root.focus();
      const p = this.toWorld(e);
      const h = hit(e.target);
      // Double-clicks are detected here: every press redraws the SVG, so the browser's
      // dblclick would land on an element that no longer exists.
      const key = h.id ?? (h.edge !== undefined ? `edge:${h.edge}` : null);
      const now = performance.now();
      const double =
        e.button === 0 &&
        key !== null &&
        key === lastPress.key &&
        now - lastPress.t < 450 &&
        Math.hypot(e.clientX - lastPress.x, e.clientY - lastPress.y) < 6;
      lastPress = double ? { key: null, t: 0, x: 0, y: 0 } : { key, t: now, x: e.clientX, y: e.clientY };
      if (double && this.tool === 'select') {
        this.doubleClick(h);
        return;
      }
      if (e.button === 1 || (e.button === 0 && this.space)) {
        drag = { kind: 'pan', x: e.clientX, y: e.clientY, tx: this.view.tx, ty: this.view.ty };
      } else if (e.button !== 0) {
        return;
      } else if (this.tool !== 'select' && this.tool !== 'connect') {
        this.place(this.tool, p);
        return;
      } else if (h.handle || (this.tool === 'connect' && h.id)) {
        drag = { kind: 'connect', from: (h.handle ?? h.id)! };
      } else if (h.id) {
        const n = this.node(h.id)!;
        this.sel = { kind: 'node', id: h.id };
        drag = { kind: 'move', id: h.id, dx: p.x - n.x!, dy: p.y - n.y!, moved: false };
        this.redraw();
      } else if (h.edge !== undefined) {
        this.sel = { kind: 'edge', index: h.edge };
        this.redraw();
        return;
      } else {
        this.sel = null;
        this.redraw();
        drag = { kind: 'pan', x: e.clientX, y: e.clientY, tx: this.view.tx, ty: this.view.ty };
      }
      this.stage.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    this.stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (drag.kind === 'pan') {
        this.view.tx = drag.tx + e.clientX - drag.x;
        this.view.ty = drag.ty + e.clientY - drag.y;
        this.applyView();
      } else if (drag.kind === 'move') {
        const p = this.toWorld(e);
        const n = this.node(drag.id)!;
        const x = this.snapped(p.x - drag.dx);
        const y = this.snapped(p.y - drag.dy);
        if (x !== n.x || y !== n.y) {
          Object.assign(n, { x, y });
          drag.moved = true;
          this.redraw();
        }
      } else {
        const from = this.drawing?.boxes.get(drag.from);
        const p = this.toWorld(e);
        if (from) this.preview.setAttribute('d', `M${from.x},${from.y}L${p.x},${p.y}`);
      }
    });

    this.stage.addEventListener('pointerup', (e) => {
      const done = drag;
      drag = null;
      if (!done) return;
      if (done.kind === 'move' && done.moved) this.commit();
      if (done.kind === 'connect') {
        this.preview.setAttribute('d', '');
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const to = under?.closest('[data-id]')?.getAttribute('data-id');
        if (to && to !== done.from) this.connect(done.from, to);
      }
    });

    this.stage.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = this.stage.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const k = Math.min(4, Math.max(0.25, this.view.k * Math.exp(-e.deltaY * 0.0015)));
        this.view.tx = mx - ((mx - this.view.tx) * k) / this.view.k;
        this.view.ty = my - ((my - this.view.ty) * k) / this.view.k;
        this.view.k = k;
        this.applyView();
      },
      { passive: false },
    );

    this.root.addEventListener('keydown', (e) => {
      // A focused button keeps Enter and Space; every other key is a canvas shortcut.
      const onButton = (e.target as Element).closest('button');
      if (this.editing || (onButton && (e.key === 'Enter' || e.key === ' '))) return;
      if (this.onKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    this.root.addEventListener('keyup', (e) => {
      if (e.key === ' ') this.space = false;
    });
  }

  /** Handles a key on the canvas; false lets it through. Esc is handled in cancelSomething(). */
  private onKey(e: KeyboardEvent): boolean {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const arrow = ARROWS[e.key];
    if (this.linking) {
      if (arrow) this.moveTarget(arrow);
      else if (e.key === 'Tab') this.cycleTarget(e.shiftKey ? -1 : 1);
      else if (e.key === 'Enter') {
        const { from, to } = this.linking;
        this.linking = null;
        if (to) this.connect(from, to);
        else this.redraw();
      }
      // Every other key is held while choosing, so a stray letter does not switch tools.
      return true;
    }
    if (mod && key === 'z') this.restore(e.shiftKey ? this.at + 1 : this.at - 1);
    else if (mod && key === 'y') this.restore(this.at + 1);
    else if (mod) return false;
    else if (e.key === '?') this.toggleKeys();
    else if (e.key === 'Tab') this.cycleSelection(e.shiftKey ? -1 : 1);
    else if (e.key === 'Delete' || e.key === 'Backspace') this.deleteSelection();
    else if (e.key === ' ') this.space = true;
    else if (e.key === 'Enter') {
      if (this.tool !== 'select' && this.tool !== 'connect') this.placeNext(this.tool);
      else if (this.sel?.kind === 'node') this.editNodeLabel(this.sel.id);
      else if (this.sel?.kind === 'edge') this.doubleClick({ edge: this.sel.index });
      else return false;
    } else if (arrow && e.altKey) this.selectNearby(arrow);
    else if (arrow && this.sel?.kind === 'node')
      this.nudge(e.key, e.shiftKey ? GRID * 2 : this.snap ? GRID : 1);
    else if (e.altKey) return false;
    else if (key === 'g') {
      this.snap = !this.snap;
      this.redrawChrome();
    } else if (key === 'l' && this.sel?.kind === 'node') this.startLinking(this.sel.id);
    else {
      const t = TOOLS.find((x) => x.key === key);
      if (!t) return false;
      this.setTool(t.tool);
    }
    return true;
  }

  // ---- Keyboard selection and connecting ---------------------------------------

  /** Tab order: nodes in creation order, then edges. */
  private cycleSelection(step: 1 | -1): void {
    const items: Selection[] = [
      ...this.d.nodes.map((n): Selection => ({ kind: 'node', id: n.id })),
      ...this.d.edges.map((_, index): Selection => ({ kind: 'edge', index })),
    ];
    if (!items.length) return;
    const keyOf = (s: Selection) => (s ? (s.kind === 'node' ? `n:${s.id}` : `e:${s.index}`) : '');
    const i = items.findIndex((s) => keyOf(s) === keyOf(this.sel));
    // From nothing selected, Tab starts at the first item and Shift+Tab at the last.
    const next = i < 0 ? (step > 0 ? 0 : items.length - 1) : (i + step + items.length) % items.length;
    this.sel = items[next]!;
    this.reveal();
    this.redraw();
  }

  private selectNearby(dir: Direction): void {
    const boxes = this.drawing?.boxes;
    if (!boxes) return;
    if (this.sel?.kind !== 'node') return this.cycleSelection(1);
    const id = nearestInDirection(boxes.get(this.sel.id)!, boxes.values(), dir);
    if (!id) return;
    this.sel = { kind: 'node', id };
    this.reveal();
    this.redraw();
  }

  private startLinking(from: string): void {
    const boxes = this.drawing?.boxes;
    if (!boxes) return;
    const start = boxes.get(from)!;
    // Start at the next node along the flow, else the nearest one.
    const flow: Direction = { LR: 'right', RL: 'left', TD: 'down', TB: 'down', BT: 'up' }[
      this.d.dir
    ] as Direction;
    let to = nearestInDirection(start, boxes.values(), flow);
    if (!to) {
      let best = Infinity;
      for (const b of boxes.values()) {
        const dist = Math.hypot(b.x - start.x, b.y - start.y);
        if (b.id !== from && dist < best) {
          best = dist;
          to = b.id;
        }
      }
    }
    this.linking = { from, to };
    this.redraw();
  }

  private moveTarget(dir: Direction): void {
    const boxes = this.drawing?.boxes;
    if (!boxes || !this.linking) return;
    const at = boxes.get(this.linking.to ?? this.linking.from)!;
    const id = nearestInDirection(at, boxes.values(), dir, [this.linking.from]);
    if (id) this.linking.to = id;
    this.redraw();
  }

  private cycleTarget(step: 1 | -1): void {
    if (!this.linking) return;
    const ids = this.d.nodes.map((n) => n.id).filter((id) => id !== this.linking!.from);
    if (!ids.length) return;
    const i = this.linking.to ? ids.indexOf(this.linking.to) : -1;
    this.linking.to = ids[(i + step + ids.length) % ids.length]!;
    this.redraw();
  }

  /** Pans so the selected node is on screen. */
  private reveal(): void {
    if (this.sel?.kind !== 'node') return;
    const n = this.node(this.sel.id);
    if (!n) return;
    const r = this.stage.getBoundingClientRect();
    const s = this.toScreen({ x: n.x!, y: n.y! });
    const pad = 60;
    if (s.x < pad) this.view.tx += pad - s.x;
    if (s.x > r.width - pad) this.view.tx -= s.x - (r.width - pad);
    if (s.y < pad) this.view.ty += pad - s.y;
    if (s.y > r.height - pad) this.view.ty -= s.y - (r.height - pad);
  }

  // ---- Edits -------------------------------------------------------------------

  /**
   * Places a node from the keyboard: after the selected node along the flow, connected
   * from it, in one undo step; with nothing selected, in the middle of the view.
   */
  private placeNext(shape: Shape): void {
    const labels = makeLabels();
    const size = nodeSize({ id: '', shape, label: DEFAULT_LABEL[shape] ?? '' }, labels.measure);
    const boxes = this.drawing?.boxes ?? new Map();
    const anchor = this.sel?.kind === 'node' ? boxes.get(this.sel.id) : undefined;
    let p: { x: number; y: number };
    if (anchor) p = nextFreeSpot(anchor, size, boxes.values(), this.d.dir);
    else {
      const r = this.stage.getBoundingClientRect();
      p = this.toWorld({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
    }
    const id = this.newId(shape);
    this.d.nodes.push({
      id,
      shape,
      label: DEFAULT_LABEL[shape] ?? '',
      x: this.snapped(p.x),
      y: this.snapped(p.y),
    });
    if (anchor)
      this.d.edges.push({ from: anchor.id, to: id, label: shape === 'junction' ? '+' : '', arrow: true });
    this.sel = { kind: 'node', id };
    this.tool = 'select';
    this.commit();
    this.reveal();
    this.applyView();
    if (DEFAULT_LABEL[shape] !== undefined) this.editNodeLabel(id);
  }

  /** Renames a node or an edge label; on a junction's sign, flips it. */
  private doubleClick(h: { id?: string; edge?: number }): void {
    if (h.id) return this.editNodeLabel(h.id);
    if (h.edge === undefined) return;
    const edge = this.d.edges[h.edge];
    if (!edge) return;
    if (isSign(this.d, edge)) {
      edge.label = edge.label === '+' ? '-' : '+';
      this.commit();
    } else this.editEdgeLabel(h.edge);
  }

  private place(shape: Shape, p: { x: number; y: number }): void {
    const id = this.newId(shape);
    this.d.nodes.push({
      id,
      shape,
      label: DEFAULT_LABEL[shape] ?? '',
      x: this.snapped(p.x),
      y: this.snapped(p.y),
    });
    this.sel = { kind: 'node', id };
    this.tool = 'select';
    this.commit();
    if (DEFAULT_LABEL[shape] !== undefined) this.editNodeLabel(id);
  }

  private connect(from: string, to: string): void {
    // A new edge into a junction is a + input; double-click its sign to flip it.
    const label = this.node(to)?.shape === 'junction' ? '+' : '';
    this.d.edges.push({ from, to, label, arrow: true });
    this.sel = { kind: 'edge', index: this.d.edges.length - 1 };
    this.commit();
  }

  private deleteSelection(): void {
    const s = this.sel;
    if (!s) return;
    if (s.kind === 'node') {
      this.d.nodes = this.d.nodes.filter((n) => n.id !== s.id);
      this.d.edges = this.d.edges.filter((e) => e.from !== s.id && e.to !== s.id);
    } else this.d.edges.splice(s.index, 1);
    this.sel = null;
    this.commit();
  }

  private nudge(key: string, step: number): void {
    if (this.sel?.kind !== 'node') return;
    const n = this.node(this.sel.id)!;
    if (key === 'ArrowLeft') n.x! -= step;
    if (key === 'ArrowRight') n.x! += step;
    if (key === 'ArrowUp') n.y! -= step;
    if (key === 'ArrowDown') n.y! += step;
    this.commit();
  }

  private editNodeLabel(id: string): void {
    const n = this.node(id);
    if (!n || n.shape === 'junction' || n.shape === 'branch') return;
    this.startEdit(n.label, { x: n.x!, y: n.y! }, (v) => {
      n.label = v;
    });
  }

  private editEdgeLabel(index: number): void {
    const r = this.drawing?.routes.find((x) => x.edge === this.d.edges[index]);
    const edge = this.d.edges[index];
    if (!r || !edge) return;
    this.startEdit(edge.label, r.labelAt, (v) => {
      edge.label = v;
    });
  }

  /** An input over the label; Enter or leaving applies, Escape cancels. */
  private startEdit(value: string, at: { x: number; y: number }, set: (v: string) => void): void {
    this.finishEdit(true);
    const input = el('input', 'canvas-input');
    input.value = value;
    input.setAttribute('aria-label', 'Label');
    const s = this.toScreen(at);
    input.style.left = `${s.x}px`;
    input.style.top = `${s.y + this.stage.getBoundingClientRect().top - this.root.getBoundingClientRect().top}px`;
    (input as HTMLInputElement & { apply?: (ok: boolean) => void }).apply = (ok) => {
      if (ok && input.value.trim() !== value) {
        set(input.value.trim());
        this.commit();
      }
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.finishEdit(true);
      else if (e.key === 'Escape') {
        e.preventDefault();
        this.finishEdit(false);
      }
    });
    input.addEventListener('blur', () => this.finishEdit(true));
    this.root.append(input);
    this.editing = input;
    input.focus();
    input.select();
  }

  private finishEdit(ok: boolean): void {
    const input = this.editing as (HTMLInputElement & { apply?: (ok: boolean) => void }) | null;
    if (!input) return;
    this.editing = null;
    input.remove();
    input.apply?.(ok);
    this.root.focus();
  }

  // ---- Closing -----------------------------------------------------------------

  private async apply(): Promise<void> {
    this.finishEdit(true);
    if (this.dirty) {
      const ok = await this.host.updateSource(serializeDiagram(this.d), {
        expectedVersion: this.info.version,
      });
      if (!ok) {
        this.ctx.ui.notify(
          'The block changed while the editor was open, so the changes were not applied.',
          'error',
        );
        return;
      }
    }
    this.history = [JSON.stringify(this.d)];
    this.at = 0;
    this.closeNow();
  }

  private closeNow(): void {
    this.closing = null;
    this.forceClose = true;
    this.overlay?.close();
  }

  private requestClose(): boolean | Promise<boolean> {
    this.finishEdit(true);
    if (this.forceClose || !this.dirty) return true;
    return new Promise<boolean>((resolve) => {
      this.closing = resolve;
      this.askApply();
    });
  }

  /** Apply changes? Apply / Discard / Keep editing (SPECS 13.1). */
  private askApply(): void {
    this.root.querySelector('.diagrams-ask')?.remove();
    const ask = el('div', 'ask');
    ask.setAttribute('role', 'alertdialog');
    ask.setAttribute('aria-label', 'Apply changes?');
    const box = el('div', 'ask-box');
    box.append(el('p', 'ask-title', 'Apply changes?'));
    const row = el('div', 'ask-row');
    const choose = (label: string, cls: string, run: () => void) => {
      const b = el('button', cls, label);
      b.type = 'button';
      b.addEventListener('click', () => {
        ask.remove();
        run();
      });
      row.append(b);
      return b;
    };
    choose('Keep editing', 'vx-btn vx-btn--small', () => {
      this.closing?.(false);
      this.closing = null;
      this.root.focus();
    });
    choose('Discard', 'vx-btn vx-btn--small vx-btn--danger', () => {
      this.closing?.(true);
      this.closing = null;
    });
    const apply = choose('Apply', 'vx-btn vx-btn--small vx-btn--primary', () => {
      const resolve = this.closing;
      this.closing = null;
      resolve?.(false);
      void this.apply();
    });
    box.append(row);
    ask.append(box);
    this.root.append(ask);
    apply.focus();
  }
}
