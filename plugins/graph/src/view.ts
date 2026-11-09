/**
 * The graph view (SPECS 13.11): a canvas, laid out by d3-force, with pan, zoom, hover,
 * search and click-to-open. The layout is kept in the plugin's library storage per scope,
 * so reopening is instant and the shape does not jump.
 */
import type { Domain, IndexQuery, PluginContext, ViewHost } from '@ephemeris-notes/plugin-api';
import {
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { quadtree, type Quadtree } from 'd3-quadtree';
import {
  baseName,
  buildGraph,
  localGraph,
  placeNodes,
  savePositions,
  search,
  type Drawn,
  type GraphNode,
} from './model';

export interface GraphState {
  scope: 'vault' | 'domain' | 'all';
  vaultPath: string | null;
  domain: Domain | null;
  /** The note a local graph is around; null for the whole scope. */
  center: string | null;
  depth: 1 | 2;
  attachments: boolean;
  orphans: boolean;
  /** The note open when the graph was opened: it gets a ring. */
  focus: string | null;
}

type SimNode = GraphNode & SimulationNodeDatum;
type SimLink = SimulationLinkDatum<SimNode> & { count: number };

export function normalize(raw: unknown): GraphState {
  const s = (raw ?? {}) as Partial<GraphState>;
  const domain = s.domain === 'academic' || s.domain === 'work' || s.domain === 'personal' ? s.domain : null;
  const vaultPath = typeof s.vaultPath === 'string' ? s.vaultPath : null;
  const scope =
    s.scope === 'vault' && vaultPath ? 'vault' : s.scope === 'domain' && domain ? 'domain' : 'all';
  return {
    scope,
    vaultPath,
    domain,
    center: typeof s.center === 'string' ? s.center : null,
    depth: s.depth === 2 ? 2 : 1,
    attachments: s.attachments === true,
    orphans: s.orphans !== false,
    focus: typeof s.focus === 'string' ? s.focus : null,
  };
}

export function viewTitle(s: GraphState): string {
  if (s.center) return `Local graph: ${baseName(s.center)}`;
  if (s.scope === 'vault' && s.vaultPath) return `Graph: ${s.vaultPath.split('/').pop()}`;
  if (s.scope === 'domain' && s.domain) return `Graph: ${s.domain[0]!.toUpperCase()}${s.domain.slice(1)}`;
  return 'Graph: All notes';
}

/** Where the layout of a scope is kept; local graphs are small and not kept. */
function layoutFile(s: GraphState): string | null {
  if (s.center) return null;
  const key =
    s.scope === 'vault' ? `vault-${s.vaultPath}` : s.scope === 'domain' ? `domain-${s.domain}` : 'all';
  return `layout/${key.replace(/[^\p{L}\p{N}_-]+/gu, '_')}${s.attachments ? '+files' : ''}.json`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = `graph-${cls}`;
  if (text !== undefined) e.textContent = text;
  return e;
}

const radius = (n: GraphNode) => 3 + Math.sqrt(n.inbound) * 1.6;

/** A short fingerprint of the notes and links drawn (FNV-1a). */
function graphKey(d: Drawn): string {
  let h = 0x811c9dc5;
  const add = (s: string) => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  };
  for (const n of d.nodes) add(`${n.id}\t${n.title}\n`);
  for (const e of d.edges) add(`${e.source}\t${e.target}\n`);
  return `${d.nodes.length}:${d.edges.length}:${(h >>> 0).toString(36)}`;
}

export function renderGraphView(
  ctx: PluginContext,
  root: HTMLElement,
  raw: unknown,
  host: ViewHost,
  lastNote: () => string | null,
): void {
  let state = normalize(raw);
  const page = el('div', 'view');
  const bar = el('div', 'bar');
  const wrap = el('div', 'canvas-wrap');
  const canvas = el('canvas', 'canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  const status = el('p', 'status');
  status.setAttribute('aria-live', 'polite');
  wrap.append(canvas);
  page.append(bar, wrap, status);
  root.append(page);
  const g = canvas.getContext('2d')!;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  // ---- Data and layout ------------------------------------------------------------------
  let nodes: SimNode[] = [];
  let links: SimLink[] = [];
  let neighbours = new Map<string, Set<string>>();
  let tree: Quadtree<SimNode> | null = null;
  let sim: Simulation<SimNode, SimLink> | null = null;
  let running = false;
  let fitted = false;
  let generation = 0;
  /** What is drawn now, to skip reloads that change nothing (the index changes for many reasons). */
  let drawnKey = '';

  const scopeQuery = (): IndexQuery['scope'] =>
    state.center
      ? { kind: 'all' }
      : state.scope === 'vault' && state.vaultPath
        ? { kind: 'vault', vaultPath: state.vaultPath }
        : state.scope === 'domain' && state.domain
          ? { kind: 'domain', domain: state.domain }
          : { kind: 'all' };

  const load = async (keepPositions: boolean) => {
    const mine = ++generation;
    // A refresh as links change keeps what is shown until there is something new.
    if (!keepPositions) status.textContent = 'Reading links…';
    let drawn: Drawn;
    try {
      const graph = await ctx.index.links({ scope: scopeQuery() });
      drawn = buildGraph(graph, {
        attachments: state.attachments,
        orphans: state.center ? true : state.orphans,
      });
      if (state.center) drawn = localGraph(drawn, state.center, state.depth);
    } catch (err) {
      status.textContent = `Could not read the links: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    if (mine !== generation || host.signal.aborted) return;
    // Positions: the dots drawn now, then the saved layout.
    const saved: Record<string, [number, number]> = keepPositions ? savePositions(nodes) : {};
    const file = layoutFile(state);
    if (file && !keepPositions)
      Object.assign(saved, await ctx.storage.library.readJson<Record<string, [number, number]>>(file, {}));
    if (mine !== generation || host.signal.aborted) return;
    const key = graphKey(drawn);
    if (keepPositions && key === drawnKey) return;
    drawnKey = key;
    nodes = drawn.nodes.map((n) => ({ ...n }));
    links = drawn.edges.map((e) => ({ source: e.source, target: e.target, count: e.count }));
    neighbours = new Map();
    for (const e of drawn.edges) {
      for (const [a, b] of [
        [e.source, e.target],
        [e.target, e.source],
      ] as const) {
        if (!neighbours.has(a)) neighbours.set(a, new Set());
        neighbours.get(a)!.add(b);
      }
    }
    const placed = placeNodes(nodes, drawn.edges, saved);
    sim?.stop();
    // A large graph cools faster and approximates more: one step of 5,000 notes outlasts a frame.
    const big = nodes.length > 1500;
    sim = forceSimulation<SimNode, SimLink>(nodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(36),
      )
      .force(
        'charge',
        forceManyBody<SimNode>()
          .strength(-50)
          .distanceMax(500)
          .theta(big ? 1.2 : 0.9),
      )
      .force('x', forceX<SimNode>(0).strength(0.05))
      .force('y', forceY<SimNode>(0).strength(0.05))
      .alphaMin(0.02)
      .alphaDecay(big ? 0.06 : 0.0228)
      .stop();
    // Mostly where it was: settle gently, so the shape does not jump.
    if (nodes.length && placed / nodes.length > 0.9) sim.alpha(0.08);
    canvas.setAttribute('aria-label', `${viewTitle(state)}: ${nodes.length} notes`);
    describe();
    if (!keepPositions) fitted = false;
    start();
  };

  /** Runs the layout: a few milliseconds per frame, drawing as it goes (settled first, with reduced motion). */
  const start = () => {
    if (running) return;
    running = true;
    const step = () => {
      if (!sim || host.signal.aborted) return void (running = false);
      const until = performance.now() + (reduced ? 40 : 10);
      while (sim.alpha() > sim.alphaMin() && performance.now() < until) sim.tick();
      tree = null;
      const settled = sim.alpha() <= sim.alphaMin() && !dragging;
      if (!reduced || settled) {
        if (!fitted) fit();
        draw();
      } else status.textContent = 'Laying out…';
      if (settled) {
        running = false;
        describe();
        const file = layoutFile(state);
        if (file) void ctx.storage.library.writeJson(file, savePositions(nodes));
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const describe = () => {
    const shown = nodes.filter((n) => n.inScope).length;
    status.textContent =
      `${shown} ${shown === 1 ? 'note' : 'notes'}, ${links.length} ${links.length === 1 ? 'link' : 'links'}` +
      (hovered ? ` · ${hovered.title}` : '') +
      (matches.length ? ` · ${matches.length} found` : '');
  };

  // ---- View transform -----------------------------------------------------------------
  let view = { k: 1, x: 0, y: 0 };
  let size = { w: 0, h: 0 };
  const toGraph = (px: number, py: number) => ({ x: (px - view.x) / view.k, y: (py - view.y) / view.k });

  const fit = () => {
    if (!nodes.length || !size.w) return;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const n of nodes) {
      x0 = Math.min(x0, n.x!);
      y0 = Math.min(y0, n.y!);
      x1 = Math.max(x1, n.x!);
      y1 = Math.max(y1, n.y!);
    }
    const k = Math.min(4, 0.9 * Math.min(size.w / Math.max(1, x1 - x0), size.h / Math.max(1, y1 - y0)));
    view = { k, x: size.w / 2 - ((x0 + x1) / 2) * k, y: size.h / 2 - ((y0 + y1) / 2) * k };
    fitted = true;
  };

  const zoom = (factor: number, px = size.w / 2, py = size.h / 2) => {
    const k = Math.min(8, Math.max(0.03, view.k * factor));
    const p = toGraph(px, py);
    view = { k, x: px - p.x * k, y: py - p.y * k };
    draw();
  };

  const resize = () => {
    const r = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    size = { w: r.width, h: r.height };
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    canvas.style.width = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
    if (!fitted) fit();
    draw();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(wrap);

  // ---- Drawing ----------------------------------------------------------------------------
  let hovered: SimNode | null = null;
  let matches: SimNode[] = [];
  const colours = () => ({
    edge: ctx.theme.token('line'),
    strong: ctx.theme.token('ink'),
    text: ctx.theme.token('text'),
    halo: ctx.theme.token('surface'),
    other: ctx.theme.token('muted'),
    domain: {
      academic: ctx.theme.token('domain-academic'),
      work: ctx.theme.token('domain-work'),
      personal: ctx.theme.token('domain-personal'),
    } as Record<Domain, string>,
    font: ctx.theme.token('font-ui') || 'sans-serif',
  });
  let palette = colours();

  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    if (!nodes.length) return;
    g.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.x, dpr * view.y);
    // What stands out: the hovered dot and its neighbours, or the search's matches.
    const lit = hovered
      ? new Set([hovered.id, ...(neighbours.get(hovered.id) ?? [])])
      : matches.length
        ? new Set(matches.map((m) => m.id))
        : null;
    g.lineWidth = 1 / view.k;
    g.strokeStyle = palette.edge;
    g.globalAlpha = lit ? 0.15 : 0.6;
    g.beginPath();
    for (const l of links) {
      const s = l.source as SimNode;
      const t = l.target as SimNode;
      g.moveTo(s.x!, s.y!);
      g.lineTo(t.x!, t.y!);
    }
    g.stroke();
    if (hovered) {
      g.globalAlpha = 0.9;
      g.strokeStyle = palette.strong;
      g.beginPath();
      for (const l of links) {
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        if (s !== hovered && t !== hovered) continue;
        g.moveTo(s.x!, s.y!);
        g.lineTo(t.x!, t.y!);
      }
      g.stroke();
    }
    for (const n of nodes) {
      const r = radius(n);
      const dim = lit && !lit.has(n.id);
      g.globalAlpha = dim ? 0.15 : n.inScope ? 1 : 0.45;
      g.beginPath();
      g.arc(n.x!, n.y!, r, 0, Math.PI * 2);
      const fill = n.domain ? palette.domain[n.domain] : palette.other;
      if (n.kind === 'attachment') {
        g.lineWidth = 1.5 / view.k;
        g.strokeStyle = fill;
        g.stroke();
      } else {
        g.fillStyle = fill;
        g.fill();
      }
      if (n.id === state.focus || n.id === state.center) {
        g.globalAlpha = 1;
        g.lineWidth = 2 / view.k;
        g.strokeStyle = palette.strong;
        g.beginPath();
        g.arc(n.x!, n.y!, r + 3 / view.k, 0, Math.PI * 2);
        g.stroke();
      }
    }
    // Labels: zoomed in, or for what stands out.
    const all = view.k >= 1.6 || nodes.length <= 40;
    g.font = `${12 / view.k}px ${palette.font}`;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.lineWidth = 3 / view.k;
    g.strokeStyle = palette.halo;
    g.fillStyle = palette.text;
    const left = -view.x / view.k;
    const top = -view.y / view.k;
    const right = left + size.w / view.k;
    const bottom = top + size.h / view.k;
    for (const n of nodes) {
      if (!(lit ? lit.has(n.id) : all)) continue;
      if (n.x! < left || n.x! > right || n.y! < top || n.y! > bottom) continue;
      g.globalAlpha = n.inScope ? 1 : 0.6;
      const y = n.y! + radius(n) + 2 / view.k;
      g.strokeText(n.title, n.x!, y);
      g.fillText(n.title, n.x!, y);
    }
    g.globalAlpha = 1;
  };

  // ---- Pointer and keys -------------------------------------------------------------------
  const hit = (px: number, py: number): SimNode | null => {
    if (!nodes.length) return null;
    tree ??= quadtree<SimNode>()
      .x((d) => d.x!)
      .y((d) => d.y!)
      .addAll(nodes);
    const p = toGraph(px, py);
    const n = tree.find(p.x, p.y, 12 / view.k + 8) ?? null;
    return n && Math.hypot(n.x! - p.x, n.y! - p.y) <= radius(n) + 6 / view.k ? n : null;
  };
  const local = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };

  let dragging: { node: SimNode | null; px: number; py: number; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    const { px, py } = local(e);
    canvas.setPointerCapture(e.pointerId);
    dragging = { node: hit(px, py), px, py, moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    const { px, py } = local(e);
    if (!dragging) {
      const n = hit(px, py);
      if (n !== hovered) {
        hovered = n;
        canvas.style.cursor = n ? 'pointer' : 'grab';
        describe();
        draw();
      }
      return;
    }
    if (Math.hypot(px - dragging.px, py - dragging.py) > 3) dragging.moved = true;
    if (!dragging.moved) return;
    if (dragging.node) {
      const p = toGraph(px, py);
      [dragging.node.fx, dragging.node.fy] = [p.x, p.y];
      sim?.alpha(Math.max(sim.alpha(), 0.15));
      start();
    } else {
      view = { ...view, x: view.x + px - dragging.px, y: view.y + py - dragging.py };
      [dragging.px, dragging.py] = [px, py];
      draw();
    }
  });
  canvas.addEventListener('pointerup', () => {
    const d = dragging;
    dragging = null;
    if (!d) return;
    if (d.node && !d.moved) return void open(d.node);
    if (d.node) [d.node.fx, d.node.fy] = [null, null];
  });
  canvas.addEventListener('pointerleave', () => {
    if (!hovered || dragging) return;
    hovered = null;
    describe();
    draw();
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const { px, py } = local(e);
      zoom(Math.exp(-e.deltaY * 0.0015), px, py);
    },
    { passive: false },
  );
  canvas.addEventListener('keydown', (e) => {
    const pan = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[e.key];
    if (pan) {
      view = { ...view, x: view.x + pan[0]!, y: view.y + pan[1]! };
      draw();
    } else if (e.key === '+' || e.key === '=') zoom(1.25);
    else if (e.key === '-') zoom(0.8);
    else if (e.key === '0') {
      fit();
      draw();
    } else return;
    e.preventDefault();
  });

  // Where a note's dot is on screen, relative to the canvas: a canvas has no elements to
  // find, so the contract test and debugging use this.
  (
    canvas as HTMLCanvasElement & { graphPoint?: (path: string) => { x: number; y: number } | null }
  ).graphPoint = (path) => {
    const n = nodes.find((o) => o.id === path);
    return n ? { x: n.x! * view.k + view.x, y: n.y! * view.k + view.y } : null;
  };

  const open = (n: GraphNode) => {
    if (n.kind === 'attachment') return ctx.ui.notify('Attachments open from the notes that link to them.');
    void ctx.ui.openNote(n.id);
  };

  // ---- Controls ---------------------------------------------------------------------------
  const change = (next: Partial<GraphState>, reload = true) => {
    state = { ...state, ...next };
    host.saveState(state);
    host.setTitle(viewTitle(state));
    if (reload) void load(false);
  };
  const select = <T extends string>(
    label: string,
    value: T,
    options: Array<[T, string, boolean?]>,
    set: (v: T) => void,
  ) => {
    const w = el('label', 'control');
    w.append(el('span', 'control-label', label));
    const s = document.createElement('select');
    for (const [v, text, disabled] of options) {
      const o = new Option(text, v, false, v === value);
      o.disabled = disabled ?? false;
      s.append(o);
    }
    s.addEventListener('change', () => set(s.value as T));
    w.append(s);
    bar.append(w);
  };
  const toggle = (label: string, value: boolean, set: (v: boolean) => void) => {
    const w = el('label', 'toggle');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = value;
    box.addEventListener('change', () => set(box.checked));
    w.append(box, document.createTextNode(` ${label}`));
    bar.append(w);
  };
  if (state.center) {
    select<'1' | '2'>(
      'Depth',
      String(state.depth) as '1' | '2',
      [
        ['1', '1 link'],
        ['2', '2 links'],
      ],
      (v) => change({ depth: v === '2' ? 2 : 1 }),
    );
    const recentre = el('button', 'button', 'Centre on Last Note');
    recentre.type = 'button';
    recentre.title = 'Centre the graph on the note you last had open';
    recentre.addEventListener('click', () => {
      const path = lastNote();
      if (!path) return ctx.ui.notify('Open a note first, then come back to the graph.');
      change({ center: path, focus: path });
    });
    bar.append(recentre);
  } else {
    select<GraphState['scope']>(
      'Scope',
      state.scope,
      [
        ['vault', 'This Vault', !state.vaultPath],
        ['domain', 'This Domain', !state.domain],
        ['all', 'All notes'],
      ],
      (scope) => change({ scope }),
    );
    toggle('Notes without links', state.orphans, (orphans) => change({ orphans }));
  }
  toggle('Attachments', state.attachments, (attachments) => change({ attachments }));
  const find = el('input', 'search');
  find.type = 'search';
  find.placeholder = 'Find a note';
  find.setAttribute('aria-label', 'Find a note in the graph');
  find.addEventListener('input', () => {
    matches = search(nodes, find.value);
    describe();
    draw();
  });
  find.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && matches[0]) open(matches[0]);
    if (e.key === 'Escape') {
      find.value = '';
      matches = [];
      describe();
      draw();
    }
  });
  bar.append(find);

  // ---- Lifetime -----------------------------------------------------------------------
  const subs = [
    ctx.index.onLinksChanged(() => void load(true)),
    ctx.theme.onChange(() => {
      palette = colours();
      draw();
    }),
  ];
  host.signal.addEventListener(
    'abort',
    () => {
      sim?.stop();
      observer.disconnect();
      for (const s of subs) s.dispose();
    },
    { once: true },
  );
  void load(false);
}
