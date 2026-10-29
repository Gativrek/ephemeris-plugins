/**
 * The plot frame shared by the plot plugins: panels with grid, axes and 2px lines;
 * a legend for two or more series and end labels for up to four (each series named in
 * text, SPECS 13.3 and 13.4); a crosshair with a tooltip on hover. Series colours come from
 * classes (s1 … s6) over the design system's viz-1 … viz-6.
 */
import { getPrefix, html, label, linePath, pointsPath, svg } from './dom';
import { tickLabel, type Scale } from './scale';

export interface Series {
  name: string;
  /** 1-based palette slot. */
  slot: number;
  xs: number[];
  ys: number[];
  /** Points draw a round dot per sample instead of a line (scatter plots). */
  mark?: 'line' | 'points';
}

export interface Panel {
  x: Scale;
  y: Scale;
  top: number;
  height: number;
  series: Series[];
  yLabel: string;
  xLabel?: string;
  /** A reference line in data units (0 dB, -180°, the final value). */
  refs?: number[];
}

export const MARGIN = { left: 60, top: 8, bottomAxis: 34 };
export const END_LABELS_MAX = 4;

let clipSeq = 0;

export class Figure {
  readonly root: HTMLElement;
  readonly svg: SVGSVGElement;
  readonly width: number;
  readonly right: number;
  private readonly tip: HTMLElement;
  private readonly notes: HTMLElement;
  private readonly cleanups: Array<() => void> = [];

  constructor(
    target: HTMLElement,
    opts: { title: string | null; series: Array<{ name: string; slot: number }>; height: number },
  ) {
    this.root = html('div', 'figure');
    if (opts.title) this.root.append(html('div', 'title', opts.title));
    if (opts.series.length >= 2) {
      const legend = html('div', 'legend');
      for (const s of opts.series) {
        const item = html('span', 'legend-item');
        item.append(html('span', `key s${s.slot}`), document.createTextNode(s.name));
        legend.append(item);
      }
      this.root.append(legend);
    }
    target.append(this.root);
    this.width = Math.max(320, Math.round(target.clientWidth || 700));
    this.right = this.width - (opts.series.length >= 2 && opts.series.length <= END_LABELS_MAX ? 56 : 16);
    this.svg = svg('svg', {
      width: this.width,
      height: opts.height,
      viewBox: `0 0 ${this.width} ${opts.height}`,
      role: 'img',
    });
    this.tip = html('div', 'tooltip');
    this.tip.hidden = true;
    this.notes = html('div', 'notes');
    this.root.append(this.svg, this.tip, this.notes);
  }

  setLabel(text: string): void {
    this.svg.setAttribute('aria-label', text);
  }

  note(text: string, cls = 'note'): HTMLElement {
    const p = html('p', cls, text);
    this.notes.append(p);
    return p;
  }

  noteTable(): HTMLElement {
    const t = html('div', 'table');
    this.notes.append(t);
    return t;
  }

  /** Grid, frame, ticks, reference lines, series lines and end labels. */
  drawPanel(p: Panel, grid: boolean, showX: boolean): SVGGElement {
    const g = svg('g');
    const { left } = MARGIN;
    const right = this.right;
    const bottom = p.top + p.height;
    if (grid) {
      for (const v of p.x.minor)
        g.append(svg('line', { x1: p.x(v), x2: p.x(v), y1: p.top, y2: bottom }, 'grid-minor'));
      for (const v of p.x.ticks)
        g.append(svg('line', { x1: p.x(v), x2: p.x(v), y1: p.top, y2: bottom }, 'grid'));
      for (const v of p.y.ticks)
        g.append(svg('line', { x1: left, x2: right, y1: p.y(v), y2: p.y(v) }, 'grid'));
    }
    for (const r of p.refs ?? [])
      if (r >= p.y.domain[0] && r <= p.y.domain[1])
        g.append(svg('line', { x1: left, x2: right, y1: p.y(r), y2: p.y(r) }, 'ref'));
    g.append(svg('rect', { x: left, y: p.top, width: right - left, height: p.height }, 'frame'));
    for (const v of p.y.ticks) g.append(label(left - 6, p.y(v) + 4, tickLabel(v), 'tick', 'end'));
    if (showX) for (const v of p.x.ticks) g.append(label(p.x(v), bottom + 15, tickLabel(v), 'tick'));
    if (showX && p.xLabel) g.append(label((left + right) / 2, bottom + 30, p.xLabel, 'axis-label'));
    const yl = label(0, 0, p.yLabel, 'axis-label');
    yl.setAttribute('transform', `translate(14 ${p.top + p.height / 2}) rotate(-90)`);
    g.append(yl);

    const clip = `${getPrefix()}-clip-${++clipSeq}`;
    const cp = svg('clipPath', { id: clip });
    cp.append(svg('rect', { x: left, y: p.top, width: right - left, height: p.height }));
    g.append(cp);
    const lines = svg('g', { 'clip-path': `url(#${clip})` });
    for (const s of p.series)
      lines.append(
        s.mark === 'points'
          ? svg('path', { d: pointsPath(s.xs.map(p.x), s.ys.map(p.y)) }, `points s${s.slot}`)
          : svg('path', { d: linePath(s.xs.map(p.x), s.ys.map(p.y)) }, `line s${s.slot}`),
      );
    g.append(lines);
    this.endLabels(g, p);
    this.svg.append(g);
    return g;
  }

  /** Labels at each line's end, when they do not collide (else the legend carries identity). */
  private endLabels(g: SVGGElement, p: Panel): void {
    if (p.series.length < 2 || p.series.length > END_LABELS_MAX) return;
    if (p.series.some((s) => s.mark === 'points')) return;
    const ends = p.series.map((s) => {
      let i = s.ys.length - 1;
      while (i > 0 && !Number.isFinite(s.ys[i]!)) i--;
      const y = Math.min(p.top + p.height, Math.max(p.top, p.y(s.ys[i]!)));
      return { s, y };
    });
    const sorted = [...ends].sort((a, b) => a.y - b.y);
    if (sorted.some((e, i) => i > 0 && e.y - sorted[i - 1]!.y < 13)) return;
    for (const { s, y } of ends) g.append(label(this.right + 6, y + 4, s.name, 'end-label', 'start'));
  }

  /**
   * Hover over the panels: a vertical crosshair, a dot on each line, and a tooltip
   * with the rows `describe` returns for the nearest sample. `ysOf` gives a series' full
   * data when the drawn line is thinned out, so the dot sits on the real sample.
   */
  crosshair(
    panels: Panel[],
    describe: (i: number) => { head: string; rows: Array<{ slot: number; name: string; value: string }> },
    xs: number[],
    ysOf: (s: Series) => number[] = (s) => s.ys,
  ): void {
    const top = Math.min(...panels.map((p) => p.top));
    const bottom = Math.max(...panels.map((p) => p.top + p.height));
    const x = panels[0]!.x;
    const layer = svg('g', {}, 'hover');
    layer.style.display = 'none';
    const vline = svg('line', { y1: top, y2: bottom }, 'crosshair');
    layer.append(vline);
    const dots = panels.flatMap((p) =>
      p.series.map((s) => ({ p, s, dot: svg('circle', { r: 4 }, `dot s${s.slot}`) })),
    );
    for (const d of dots) layer.append(d.dot);
    const values = new Map(dots.map((d) => [d.s, ysOf(d.s)]));
    const hit = svg(
      'rect',
      { x: MARGIN.left, y: top, width: this.right - MARGIN.left, height: bottom - top },
      'hit',
    );
    this.svg.append(layer, hit);
    const px = xs.map(x);
    const sorted = px.every((v, k) => Number.isFinite(v) && (k === 0 || v >= px[k - 1]!));
    const move = (e: PointerEvent) => {
      const r = this.svg.getBoundingClientRect();
      const i = nearest(px, e.clientX - r.left, sorted);
      const cx = px[i]!;
      vline.setAttribute('x1', String(cx));
      vline.setAttribute('x2', String(cx));
      for (const d of dots) {
        const v = values.get(d.s)![i]!;
        const cy = d.p.y(v);
        const visible = Number.isFinite(v) && cy >= d.p.top && cy <= d.p.top + d.p.height;
        d.dot.style.display = visible ? '' : 'none';
        if (visible) {
          d.dot.setAttribute('cx', String(cx));
          d.dot.setAttribute('cy', String(cy));
        }
      }
      layer.style.display = '';
      this.showTip(describe(i), cx, e.clientY - r.top);
    };
    const leave = () => {
      layer.style.display = 'none';
      this.tip.hidden = true;
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerleave', leave);
    this.cleanups.push(() => {
      hit.removeEventListener('pointermove', move);
      hit.removeEventListener('pointerleave', leave);
    });
  }

  showTip(
    c: { head: string; rows: Array<{ slot: number; name: string; value: string }> },
    x: number,
    y: number,
  ): void {
    this.tip.replaceChildren(html('div', 'tooltip-head', c.head));
    for (const r of c.rows) {
      const row = html('div', 'tooltip-row');
      row.append(
        html('span', `key s${r.slot}`),
        html('span', 'tooltip-name', r.name),
        html('span', 'tooltip-value', r.value),
      );
      this.tip.append(row);
    }
    this.tip.hidden = false;
    const w = this.tip.offsetWidth;
    const left = x + 14 + w > this.width ? x - 14 - w : x + 14;
    this.tip.style.left = `${Math.max(0, left)}px`;
    this.tip.style.top = `${Math.max(0, y - 10) + this.svg.getBoundingClientRect().top - this.root.getBoundingClientRect().top}px`;
  }

  hideTip(): void {
    this.tip.hidden = true;
  }

  onDispose(fn: () => void): void {
    this.cleanups.push(fn);
  }

  dispose(): void {
    for (const fn of this.cleanups.splice(0)) fn();
  }
}

/** The index of the value nearest `v`: a binary search when `px` ascends, else a scan. */
export function nearest(px: number[], v: number, sorted: boolean): number {
  let best = 0;
  let dist = Infinity;
  const consider = (k: number) => {
    const d = Math.abs(px[k]! - v);
    if (d < dist) {
      dist = d;
      best = k;
    }
  };
  if (!sorted) {
    for (let k = 0; k < px.length; k++) consider(k);
    return best;
  }
  let lo = 0;
  let hi = px.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (px[mid]! < v) lo = mid;
    else hi = mid;
  }
  consider(lo);
  consider(hi);
  return best;
}
