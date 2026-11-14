/**
 * The three plots (SPECS 13.3): Bode, step and pole-zero map. Discrete systems share them:
 * their Bode curves end at the Nyquist frequency, their steps are stairs, and the
 * pole-zero map draws the unit circle.
 */
import {
  analyze,
  autoRange,
  autoT,
  bode,
  dcGain,
  logspace,
  margins,
  nyquist,
  stability,
  stepDiscrete,
  stepResponse,
  type Analysis,
} from './analysis';
import {
  END_LABELS_MAX,
  Figure,
  fixed,
  fmt,
  html,
  label,
  linear,
  log,
  MARGIN,
  svg,
  type Panel,
  type Series,
} from '@ephemeris-plugins/chart';
import { BlockError, seconds, type Block, type System } from './parse';
import { degree, type Complex } from './poly';

const BODE_POINTS = 600;
const STEP_SAMPLES = 2001;
const TWO_PI = 2 * Math.PI;

const finite = (vs: number[]) => vs.filter((v) => Number.isFinite(v) && Math.abs(v) < 1e6);
const extent = (vs: number[]): [number, number] => {
  const f = finite(vs);
  return f.length ? [Math.min(...f), Math.max(...f)] : [-1, 1];
};

/** A discrete system carries its sample time in the legend and the hover: "Gd (Ts = 0.1 s)". */
export const legendName = (s: Pick<System, 'name' | 'ts'>): string =>
  s.ts === null ? s.name : `${s.name} (Ts = ${seconds(s.ts)} s)`;

/** `name` for the legend and hover; `short`, the system's own name, for labels at line ends. */
function analyses(block: Block): Array<{ name: string; short: string; slot: number; a: Analysis }> {
  return block.systems.map((s, i) => ({
    name: legendName(s),
    short: s.name,
    slot: i + 1,
    a: analyze(s.tf, s.ts),
  }));
}

// ---- Bode ------------------------------------------------------------------------

export function renderBode(target: HTMLElement, block: Block): Figure {
  const { options } = block;
  const systems = analyses(block);
  const unit = options.hz ? 'Hz' : 'rad/s';
  // Ranges and axes in the display unit; the response is always evaluated at ω in rad/s.
  let [lo, hi] = options.w ?? autoRange(systems.map((s) => s.a));
  if (!options.w && options.hz) [lo, hi] = [lo / TWO_PI, hi / TWO_PI];
  const toX = (w: number) => (options.hz ? w / TWO_PI : w);
  // Each Nyquist frequency in range is a sample, so discrete curves end exactly on it.
  const nyquists = [
    ...new Set(systems.filter((s) => s.a.ts !== null).map((s) => toX(nyquist(s.a.ts!)))),
  ].filter((v) => v >= lo && v <= hi);
  const xs = [...new Set([...logspace(lo, hi, BODE_POINTS), ...nyquists])].sort((a, b) => a - b);
  const ws = xs.map((x) => (options.hz ? x * TWO_PI : x));
  /** A discrete response stops at the Nyquist frequency (NaN beyond it, drawn as nothing). */
  const response = (a: Analysis) => {
    if (a.ts === null) return bode(a, ws);
    const nyq = nyquist(a.ts);
    const upTo = ws.filter((w) => w <= nyq * (1 + 1e-12)).map((w) => Math.min(w, nyq));
    const r = bode(a, upTo);
    const pad = new Array<number>(ws.length - upTo.length).fill(NaN);
    return { magDb: [...r.magDb, ...pad], phaseDeg: [...r.phaseDeg, ...pad] };
  };
  const responses = systems.map((s) => ({
    ...s,
    r: response(s.a),
    m: options.margins ? margins(s.a) : null,
  }));

  const panelH = 170;
  const gap = 14;
  const fig = new Figure(target, {
    title: options.title,
    series: systems,
    height: MARGIN.top + panelH * 2 + gap + MARGIN.bottomAxis,
  });
  fig.setLabel(`Bode plot of ${systems.map((s) => s.name).join(', ')}`);
  const x = log(lo, hi, MARGIN.left, fig.right);
  const [mLo, mHi] = extent(responses.flatMap((s) => s.r.magDb));
  const [pLo, pHi] = extent(responses.flatMap((s) => s.r.phaseDeg));
  const magTop = MARGIN.top;
  const phTop = magTop + panelH + gap;
  const mag: Panel = {
    x,
    y: linear(
      Math.min(mLo, options.margins ? 0 : mLo),
      Math.max(mHi, options.margins ? 0 : mHi),
      magTop + panelH,
      magTop,
      5,
      [1, 2, 5, 10, 20, 40, 50, 100, 200],
    ),
    top: magTop,
    height: panelH,
    series: responses.map((s): Series => ({ name: s.short, slot: s.slot, xs, ys: s.r.magDb })),
    yLabel: 'Magnitude (dB)',
    ...(options.margins ? { refs: [0] } : {}),
  };
  const phase: Panel = {
    x,
    y: linear(
      Math.min(pLo, options.margins ? -180 : pLo),
      Math.max(pHi, options.margins ? -180 : pHi),
      phTop + panelH,
      phTop,
      5,
      [5, 15, 30, 45, 90, 180, 360],
    ),
    top: phTop,
    height: panelH,
    series: responses.map((s): Series => ({ name: s.short, slot: s.slot, xs, ys: s.r.phaseDeg })),
    yLabel: 'Phase (°)',
    xLabel: `Frequency (${unit})`,
    ...(options.margins ? { refs: [-180] } : {}),
  };
  fig.drawPanel(mag, options.grid, false);
  fig.drawPanel(phase, options.grid, true);

  // The Nyquist frequency of each sample time, dashed across both panels.
  for (const v of nyquists) {
    const cx = x(v);
    const g = svg('g', {}, 'nyquist');
    for (const p of [mag, phase])
      g.append(svg('line', { x1: cx, x2: cx, y1: p.top, y2: p.top + p.height }, 'nyquist-line'));
    g.append(label(cx - 4, magTop + 13, 'Nyquist', 'nyquist-label', 'end'));
    fig.svg.append(g);
  }

  if (options.margins) {
    for (const s of responses) {
      const m = s.m!;
      const marks = svg('g', {}, `margin s${s.slot}`);
      const inRange = (w: number) => Number.isFinite(w) && toX(w) >= x.domain[0] && toX(w) <= x.domain[1];
      if (inRange(m.wcg) && Number.isFinite(m.gmDb)) {
        const cx = x(toX(m.wcg));
        marks.append(svg('line', { x1: cx, x2: cx, y1: mag.y(0), y2: mag.y(-m.gmDb) }, 'margin-line'));
        marks.append(svg('circle', { cx, cy: mag.y(-m.gmDb), r: 4 }, `dot s${s.slot}`));
      }
      if (inRange(m.wcp) && Number.isFinite(m.pmDeg)) {
        const cx = x(toX(m.wcp));
        const ph = m.pmDeg - 180;
        marks.append(svg('line', { x1: cx, x2: cx, y1: phase.y(-180), y2: phase.y(ph) }, 'margin-line'));
        marks.append(svg('circle', { cx, cy: phase.y(ph), r: 4 }, `dot s${s.slot}`));
      }
      fig.svg.append(marks);
      const gm = Number.isFinite(m.gmDb) ? `GM ${fmt(m.gmDb)} dB at ${fmt(toX(m.wcg))} ${unit}` : 'GM inf';
      const pm = Number.isFinite(m.pmDeg) ? `PM ${fmt(m.pmDeg)}° at ${fmt(toX(m.wcp))} ${unit}` : 'PM inf';
      fig.note(`${systems.length > 1 ? `${s.name}: ` : ''}${gm} · ${pm}`);
    }
  }

  fig.crosshair(
    [mag, phase],
    (i) => ({
      head: `${fmt(xs[i]!)} ${unit}`,
      rows: responses.map((s) => ({
        slot: s.slot,
        name: s.name,
        value: Number.isNaN(s.r.magDb[i]!)
          ? 'above Nyquist'
          : `${fmt(s.r.magDb[i]!)} dB · ${fmt(s.r.phaseDeg[i]!)}°`,
      })),
    }),
    xs,
  );
  return fig;
}

// ---- Step ------------------------------------------------------------------------

/**
 * Systems with more zeros than poles have no step response. They are left out and named
 * under the plot, since a loop's building blocks (L = s^2 + 2s + 1) often are; only a
 * block with nothing else to plot is an error.
 */
export function stepSystems(block: Block): { plotted: Block; skipped: string[] } {
  const proper = block.systems.filter((s) => degree(s.tf.num) <= degree(s.tf.den));
  const skipped = block.systems.filter((s) => !proper.includes(s)).map((s) => s.name);
  if (!proper.length) {
    const which = skipped.length > 1 ? `${skipped.join(', ')} have` : `${skipped[0]} has`;
    throw new BlockError(`No step response: ${which} more zeros than poles.`);
  }
  return { plotted: { ...block, systems: proper }, skipped };
}

export function renderStep(target: HTMLElement, full: Block): Figure {
  const { plotted: block, skipped } = stepSystems(full);
  const { options } = block;
  const systems = analyses(block);
  // A continuous and a discrete system share the longer window.
  const T = options.t ?? Math.max(...systems.map((s) => autoT(s.a)));
  // All discrete at one sample time: hover moves sample by sample. Otherwise a fine time
  // grid, on which a discrete response holds its last sample.
  const one = systems[0]!.a.ts;
  const sampled = one !== null && systems.every((s) => s.a.ts === one) ? one : null;
  const ts =
    sampled !== null
      ? Array.from({ length: Math.floor(T / sampled + 1e-9) + 1 }, (_, k) => k * sampled)
      : Array.from({ length: STEP_SAMPLES }, (_, i) => (T * i) / (STEP_SAMPLES - 1));
  const responses = systems.map((s) => {
    const st = stability(s.a);
    if (s.a.ts === null) {
      const y = stepResponse(s.a.tf, T, STEP_SAMPLES);
      return { ...s, st, y, drawn: { xs: ts, ys: y }, k: null };
    }
    const h = s.a.ts;
    const K = Math.floor(T / h + 1e-9);
    const yk = stepDiscrete(s.a.tf, K + 1);
    const k = ts.map((t) => Math.min(K, Math.floor(t / h + 1e-9)));
    return { ...s, st, y: k.map((i) => yk[i]!), drawn: stairs(h, yk), k };
  });

  const panelH = 260;
  const fig = new Figure(target, {
    title: options.title,
    series: systems,
    height: MARGIN.top + panelH + MARGIN.bottomAxis,
  });
  fig.setLabel(`Step response of ${systems.map((s) => s.name).join(', ')}`);
  const finals = responses.filter((s) => s.st === 'stable').map((s) => dcGain(s.a));
  const [yLo, yHi] = extent([...responses.flatMap((s) => s.y), ...finals, 0]);
  const panel: Panel = {
    x: linear(0, T, MARGIN.left, fig.right, 6),
    y: linear(yLo, yHi, MARGIN.top + panelH, MARGIN.top, 5),
    top: MARGIN.top,
    height: panelH,
    series: responses.map((s): Series => ({ name: s.short, slot: s.slot, ...s.drawn })),
    yLabel: 'Amplitude',
    xLabel: 'Time (s)',
    refs: finals,
  };
  const onGrid = new Map(panel.series.map((series, i) => [series, responses[i]!.y]));
  fig.drawPanel(panel, options.grid, true);
  for (const s of responses) {
    const who = systems.length > 1 || skipped.length ? `${s.name}: ` : '';
    if (s.st === 'stable') fig.note(`${who}final value ${fmt(dcGain(s.a))}`);
    else fig.note(`${who}${s.st === 'unstable' ? 'Unstable system' : 'Marginally stable system'}`, 'warning');
  }
  if (skipped.length)
    fig.note(`Not plotted: ${skipped.join(', ')} (more zeros than poles, so no step response)`);
  fig.crosshair(
    [panel],
    (i) => ({
      head: sampled !== null ? `k = ${i} · t = ${fmt(ts[i]!)} s` : `t = ${fmt(ts[i]!)} s`,
      rows: responses.map((s) => ({
        slot: s.slot,
        name: s.name,
        value: s.k && sampled === null ? `${fmt(s.y[i]!)} (k = ${s.k[i]})` : fmt(s.y[i]!),
      })),
    }),
    ts,
    (series) => onGrid.get(series) ?? series.ys,
  );
  return fig;
}

/** Samples y[k] at t = k·h drawn as MATLAB's stairs: each held until the next. */
export function stairs(h: number, y: number[]): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  y.forEach((v, k) => {
    xs.push(k * h);
    ys.push(v);
    if (k + 1 < y.length) {
      xs.push((k + 1) * h);
      ys.push(v);
    }
  });
  return { xs, ys };
}

// ---- Pole-zero map ---------------------------------------------------------------

const rootText = (z: Complex) =>
  z.im === 0 ? fmt(z.re) : `${fmt(z.re)} ${z.im > 0 ? '+' : '−'} ${fmt(Math.abs(z.im))}j`;

export function renderPzmap(target: HTMLElement, block: Block): Figure {
  const { options } = block;
  const systems = analyses(block);
  const discrete = systems.some((s) => s.a.ts !== null);
  const continuous = systems.some((s) => s.a.ts === null);
  const all = systems.flatMap((s) => [...s.a.poles, ...s.a.zeros]);
  // The unit circle is always in view for a discrete system.
  const circle = discrete ? [-1, 1] : [];
  const [reLo, reHi] = extent([...all.map((z) => z.re), 0, ...circle]);
  const [imLo, imHi] = extent([...all.map((z) => z.im), 0, ...circle]);
  const plotH = 300;
  // With a discrete system the plot is square, as MATLAB's: the frame is narrowed to it.
  let host = target;
  if (discrete) {
    const reserve = systems.length >= 2 && systems.length <= END_LABELS_MAX ? 56 : 16;
    host = html('div', 'square');
    target.append(host);
    host.style.width = `${Math.min(target.clientWidth || 700, MARGIN.left + plotH + reserve)}px`;
  }
  const fig = new Figure(host, {
    title: options.title,
    series: systems,
    height: MARGIN.top + plotH + MARGIN.bottomAxis,
  });
  fig.setLabel(`Pole-zero map of ${systems.map((s) => s.name).join(', ')}`);
  const plotW = fig.right - MARGIN.left;
  // Equal units per pixel on both axes, with a margin around the outermost roots.
  const upp = (Math.max((reHi - reLo) / plotW, (imHi - imLo) / plotH) || 2 / plotH) * 1.25;
  const cRe = (reLo + reHi) / 2;
  const cIm = (imLo + imHi) / 2;
  const x = fixed(cRe - (upp * plotW) / 2, cRe + (upp * plotW) / 2, MARGIN.left, fig.right, 6);
  const yScale = fixed(cIm - (upp * plotH) / 2, cIm + (upp * plotH) / 2, MARGIN.top + plotH, MARGIN.top, 5);
  const panel: Panel = {
    x,
    y: yScale,
    top: MARGIN.top,
    height: plotH,
    series: [],
    yLabel: 'Imaginary',
    xLabel: 'Real',
    refs: [0],
  };
  const g = fig.drawPanel(panel, options.grid, true);
  // The stability boundaries: the imaginary axis for continuous systems, the unit circle
  // (dashed) for discrete ones; a mixed block shows both.
  if (continuous && x.domain[0] <= 0 && x.domain[1] >= 0)
    g.append(svg('line', { x1: x(0), x2: x(0), y1: MARGIN.top, y2: MARGIN.top + plotH }, 'ref'));
  if (discrete) g.append(svg('circle', { cx: x(0), cy: yScale(0), r: x(1) - x(0) }, 'unit-circle'));

  const marks: Array<{ cx: number; cy: number; name: string; slot: number; pole: boolean; z: Complex }> = [];
  for (const s of systems) {
    const layer = svg('g', {}, `marks s${s.slot}`);
    for (const [list, pole] of [
      [s.a.zeros, false],
      [s.a.poles, true],
    ] as const) {
      for (const z of list) {
        const cx = x(z.re);
        const cy = yScale(z.im);
        if (pole)
          layer.append(
            svg(
              'path',
              { d: `M${cx - 5},${cy - 5}L${cx + 5},${cy + 5}M${cx - 5},${cy + 5}L${cx + 5},${cy - 5}` },
              'pole',
            ),
          );
        else layer.append(svg('circle', { cx, cy, r: 5 }, 'zero'));
        marks.push({ cx, cy, name: s.name, slot: s.slot, pole, z });
      }
    }
    fig.svg.append(layer);
  }

  // Hover: the nearest root within 14px.
  const hit = svg('rect', { x: MARGIN.left, y: MARGIN.top, width: plotW, height: plotH }, 'hit');
  fig.svg.append(hit);
  const move = (e: PointerEvent) => {
    const r = fig.svg.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const near = marks
      .map((m) => ({ m, d: Math.hypot(m.cx - mx, m.cy - my) }))
      .filter((n) => n.d <= 14)
      .sort((a, b) => a.d - b.d);
    if (!near.length) return fig.hideTip();
    const at = near.filter((n) => Math.hypot(n.m.cx - near[0]!.m.cx, n.m.cy - near[0]!.m.cy) < 1);
    fig.showTip(
      {
        head: rootText(near[0]!.m.z),
        rows: at.map(({ m }) => ({ slot: m.slot, name: m.name, value: m.pole ? 'pole' : 'zero' })),
      },
      near[0]!.m.cx,
      near[0]!.m.cy,
    );
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerleave', () => fig.hideTip());

  // The roots, listed under the plot.
  const table = fig.noteTable();
  for (const s of systems) {
    const row = (kind: string, list: Complex[]) => {
      const line = document.createElement('div');
      line.className = 'control-plots-table-row';
      line.textContent = `${systems.length > 1 ? `${s.name} ` : ''}${kind}: ${list.length ? list.map(rootText).join(', ') : 'none'}`;
      table.append(line);
    };
    row('poles', s.a.poles);
    row('zeros', s.a.zeros);
  }
  return fig;
}
