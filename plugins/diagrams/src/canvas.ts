/**
 * The canvas (SPECS 13.1), in a full-size overlay: place, move, connect, relabel and
 * delete nodes, with undo and redo while it is open. Done writes the block once (one
 * undo step in the note). A diagram outside the editable subset opens read-only.
 */
import type { BlockHost, BlockInfo, OverlayHandle, PluginContext } from '@ephemeris-notes/plugin-api';
import { layeredLayout, normalize, straighten } from './layout';
import { loadMath, makeLabels, needsMath } from './labels';
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
      b.type = 'button';
      b.title = `${t.label} (${t.key.toUpperCase()})`;
      b.addEventListener('click', () => this.setTool(t.tool));
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
    const spacer = el('div', 'canvas-spacer');
    const cancel = button('Cancel', 'Close without applying', () => this.overlay?.close());
    const done = button(
      'Done',
      'Apply and close',
      () => void this.apply(),
      'vx-btn vx-btn--small vx-btn--primary',
    );
    bar.append(tools, this.undoBtn, this.redoBtn, this.snapBtn, spacer, cancel, done);

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
    this.root.append(bar, this.stage, this.status);
    root.append(this.root);

    this.bind();
    requestAnimationFrame(() => {
      this.redraw();
      this.fit();
      this.root.focus();
    });
    return () => this.editing?.remove();
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
    const hint: Record<string, string> = {
      select: 'Drag to move · drag a handle to connect · double-click to rename · Delete removes',
      connect: 'Drag from one node to another',
    };
    this.status.textContent = hint[this.tool] ?? 'Click to place';
  }

  /** Redraws the diagram, the selection and its handles. */
  private redraw(): void {
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
      if (this.editing) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') this.restore(e.shiftKey ? this.at + 1 : this.at - 1);
      else if (mod && key === 'y') this.restore(this.at + 1);
      else if (e.key === 'Delete' || e.key === 'Backspace') this.deleteSelection();
      else if (e.key === ' ') this.space = true;
      else if (e.key === 'Escape' && (this.tool !== 'select' || this.sel)) {
        this.tool = 'select';
        this.sel = null;
        this.redraw();
      } else if (e.key === 'Enter' && this.sel?.kind === 'node') this.editNodeLabel(this.sel.id);
      else if (e.key.startsWith('Arrow') && this.sel?.kind === 'node')
        this.nudge(e.key, e.shiftKey ? GRID * 2 : this.snap ? GRID : 1);
      else if (!mod && key === 'g') {
        this.snap = !this.snap;
        this.redrawChrome();
      } else if (!mod && !e.altKey) {
        const t = TOOLS.find((x) => x.key === key);
        if (!t) return;
        this.setTool(t.tool);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    });
    this.root.addEventListener('keyup', (e) => {
      if (e.key === ' ') this.space = false;
    });
  }

  // ---- Edits -------------------------------------------------------------------

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
