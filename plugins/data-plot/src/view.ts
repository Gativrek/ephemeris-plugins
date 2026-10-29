/** Draws a ```plot block (SPECS 13.4) with the shared plot frame. */
import {
  Figure,
  fixed,
  fmt,
  getPrefix,
  linear,
  log,
  MARGIN,
  svg,
  type Panel,
  type Scale,
  type Series,
} from '@ephemeris-plugins/chart';
import { BlockError, MAX_SERIES, type PlotBlock } from './block';
import { column, type Table } from './csv';
import { THRESHOLD, thin } from './lttb';

const PANEL_H = 280;

interface Data {
  xName: string;
  xs: number[];
  series: Array<{ name: string; slot: number; ys: number[] }>;
  notes: string[];
}

/** Columns to numbers, with log axes leaving out values at or below zero. */
export function prepare(block: PlotBlock, table: Table): Data {
  const xRef = block.x ?? table.names[0]!;
  const x = column(table, xRef);
  const notes: string[] = [];
  let yRefs = block.y;
  if (!yRefs.length) {
    yRefs = table.names.filter((n) => n !== x.name);
    if (!yRefs.length) throw new BlockError('Only one column: add another for y, or set x and y.');
    if (yRefs.length > MAX_SERIES) {
      notes.push(`Showing the first ${MAX_SERIES} of ${yRefs.length} columns; choose them with y: [a, b].`);
      yRefs = yRefs.slice(0, MAX_SERIES);
    }
  }
  const xs = [...x.values];
  const series = yRefs.map((ref, i) => {
    const c = column(table, ref);
    return { name: c.name, slot: i + 1, ys: [...c.values] };
  });
  const drop = (vs: number[]) => {
    let n = 0;
    for (let i = 0; i < vs.length; i++)
      if (vs[i]! <= 0) {
        vs[i] = NaN;
        n++;
      }
    return n;
  };
  if (block.logx) {
    const n = drop(xs);
    if (n) notes.push(`${n} ${n === 1 ? 'row' : 'rows'} with ${x.name} ≤ 0 left out of the log axis.`);
  }
  if (block.logy)
    for (const s of series) {
      const n = drop(s.ys);
      if (n) notes.push(`${n} ${n === 1 ? 'value' : 'values'} of ${s.name} ≤ 0 left out of the log axis.`);
    }
  return { xName: x.name, xs, series, notes };
}

const finite = (vs: number[]) => vs.filter((v) => Number.isFinite(v));

function range(vs: number[], what: string): [number, number] {
  const f = finite(vs);
  if (!f.length) throw new BlockError(`No numbers to plot in ${what}.`);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of f) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

/** Steps after each sample: x_i → x_{i+1} at y_i, then up or down to y_{i+1}. */
export function stepPoints(xs: number[], ys: number[]): { xs: number[]; ys: number[] } {
  const ox: number[] = [];
  const oy: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    ox.push(xs[i]!);
    oy.push(ys[i]!);
    const nx = xs[i + 1];
    if (nx !== undefined && Number.isFinite(nx) && Number.isFinite(ys[i + 1]!)) {
      ox.push(nx);
      oy.push(ys[i]!);
    }
  }
  return { xs: ox, ys: oy };
}

const ascending = (vs: number[]) => {
  let last = -Infinity;
  for (const v of vs) {
    if (!Number.isFinite(v)) continue;
    if (v < last) return false;
    last = v;
  }
  return true;
};

export function renderPlot(target: HTMLElement, block: PlotBlock, table: Table): Figure {
  const data = prepare(block, table);
  const { xs } = data;
  const fig = new Figure(target, {
    title: block.title,
    series: data.series,
    height: MARGIN.top + PANEL_H + MARGIN.bottomAxis,
  });
  fig.setLabel(`${block.kind} plot of ${data.series.map((s) => s.name).join(', ')} against ${data.xName}`);

  const [xLo, xHi] = range(xs, data.xName);
  const [yLo, yHi] = range(
    data.series.flatMap((s) => finite(s.ys)),
    data.series.map((s) => s.name).join(', '),
  );
  const flat = (lo: number, hi: number) => !(hi > lo);
  // Values axes get 5% room at each end, so nothing sits on the frame. A line's x axis
  // keeps the data's exact range, as time series usually want.
  const pad = (lo: number, hi: number, isLog: boolean): [number, number] => {
    if (isLog) {
      const k = (hi / lo) ** 0.05;
      return [lo / k, hi * k];
    }
    const d = (hi - lo) * 0.05;
    return [lo - d, hi + d];
  };
  let x: Scale;
  if (block.kind !== 'scatter' && !flat(xLo, xHi))
    x = block.logx ? log(xLo, xHi, MARGIN.left, fig.right) : fixed(xLo, xHi, MARGIN.left, fig.right, 6);
  else {
    const [a, b] = pad(xLo, xHi, block.logx);
    x = block.logx ? log(a, b, MARGIN.left, fig.right) : linear(a, b, MARGIN.left, fig.right, 6);
  }
  const top = MARGIN.top;
  const [ya, yb] = pad(yLo, yHi, block.logy);
  const y = block.logy ? log(ya, yb, top + PANEL_H, top) : linear(ya, yb, top + PANEL_H, top, 5);

  // Long sorted lines are thinned for drawing; hover still reads every sample.
  const sorted = ascending(xs);
  let thinned = false;
  const drawn: Series[] = data.series.map((s) => {
    if (block.kind === 'scatter') return { name: s.name, slot: s.slot, xs, ys: s.ys, mark: 'points' };
    let pts = { xs, ys: s.ys };
    if (sorted && xs.length > THRESHOLD) {
      pts = thin(xs, s.ys);
      thinned = true;
    }
    if (block.kind === 'step') pts = stepPoints(pts.xs, pts.ys);
    return { name: s.name, slot: s.slot, xs: pts.xs, ys: pts.ys };
  });

  const panel: Panel = {
    x,
    y,
    top,
    height: PANEL_H,
    series: drawn,
    yLabel: block.ylabel ?? (data.series.length === 1 ? data.series[0]!.name : ''),
    xLabel: block.xlabel ?? data.xName,
  };
  fig.drawPanel(panel, block.grid, true);

  const head = (i: number) => `${data.xName} = ${fmt(xs[i]!)}`;
  if (block.kind === 'scatter') hoverPoints(fig, panel, data, head);
  else {
    const full = new Map(data.series.map((s) => [s.slot, s.ys]));
    fig.crosshair(
      [panel],
      (i) => ({
        head: head(i),
        rows: data.series.map((s) => ({ slot: s.slot, name: s.name, value: fmt(s.ys[i]!) })),
      }),
      xs,
      (s) => full.get(s.slot) ?? s.ys,
    );
  }
  if (thinned)
    fig.note(
      `Drawn from ${THRESHOLD.toLocaleString('en-US')} of ${xs.length.toLocaleString('en-US')} samples per line; hover reads every sample.`,
    );
  for (const n of data.notes) fig.note(n);
  return fig;
}

/** Scatter hover: the nearest point within 14px, across every series. */
function hoverPoints(fig: Figure, p: Panel, data: Data, head: (i: number) => string): void {
  const px = data.xs.map(p.x);
  const pys = data.series.map((s) => s.ys.map(p.y));
  const ring = svg('circle', { r: 5 }, 'dot');
  ring.style.display = 'none';
  const hit = svg(
    'rect',
    { x: MARGIN.left, y: p.top, width: fig.right - MARGIN.left, height: p.height },
    'hit',
  );
  fig.svg.append(ring, hit);
  const move = (e: PointerEvent) => {
    const r = fig.svg.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    let best: { k: number; i: number; d: number } | null = null;
    for (let k = 0; k < pys.length; k++)
      for (let i = 0; i < px.length; i++) {
        const d = Math.hypot(px[i]! - mx, pys[k]![i]! - my);
        if (d <= 14 && (!best || d < best.d)) best = { k, i, d };
      }
    if (!best) {
      ring.style.display = 'none';
      return fig.hideTip();
    }
    const s = data.series[best.k]!;
    ring.setAttribute('class', `${getPrefix()}-dot ${getPrefix()}-s${s.slot}`);
    ring.setAttribute('cx', String(px[best.i]));
    ring.setAttribute('cy', String(pys[best.k]![best.i]));
    ring.style.display = '';
    fig.showTip(
      { head: head(best.i), rows: [{ slot: s.slot, name: s.name, value: fmt(s.ys[best.i]!) }] },
      px[best.i]!,
      pys[best.k]![best.i]!,
    );
  };
  const leave = () => {
    ring.style.display = 'none';
    fig.hideTip();
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerleave', leave);
  fig.onDispose(() => {
    hit.removeEventListener('pointermove', move);
    hit.removeEventListener('pointerleave', leave);
  });
}
