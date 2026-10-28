/** The three plots (SPECS 13.3): Bode, step and pole-zero map. */
import {
  analyze,
  autoRange,
  autoT,
  bode,
  dcGain,
  ImproperError,
  logspace,
  margins,
  stability,
  stepResponse,
  type Analysis,
} from './analysis';
import { Figure, MARGIN, type Panel, type Series } from './chart';
import { BlockError, type Block } from './parse';
import { fixed, fmt, linear, log } from './scale';
import { svg } from './svg';
import type { Complex } from './poly';

const BODE_POINTS = 600;
const STEP_SAMPLES = 2001;
const TWO_PI = 2 * Math.PI;

const finite = (vs: number[]) => vs.filter((v) => Number.isFinite(v) && Math.abs(v) < 1e6);
const extent = (vs: number[]): [number, number] => {
  const f = finite(vs);
  return f.length ? [Math.min(...f), Math.max(...f)] : [-1, 1];
};

function analyses(block: Block): Array<{ name: string; slot: number; a: Analysis }> {
  return block.systems.map((s, i) => ({ name: s.name, slot: i + 1, a: analyze(s.tf) }));
}

// ---- Bode ------------------------------------------------------------------------

export function renderBode(target: HTMLElement, block: Block): Figure {
  const { options } = block;
  const systems = analyses(block);
  const unit = options.hz ? 'Hz' : 'rad/s';
  // Ranges and axes in the display unit; the response is always evaluated at ω in rad/s.
  let [lo, hi] = options.w ?? autoRange(systems.map((s) => s.a));
  if (!options.w && options.hz) [lo, hi] = [lo / TWO_PI, hi / TWO_PI];
  const xs = logspace(lo, hi, BODE_POINTS);
  const ws = xs.map((x) => (options.hz ? x * TWO_PI : x));
  const responses = systems.map((s) => ({
    ...s,
    r: bode(s.a, ws),
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
    series: responses.map((s): Series => ({ name: s.name, slot: s.slot, xs, ys: s.r.magDb })),
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
    series: responses.map((s): Series => ({ name: s.name, slot: s.slot, xs, ys: s.r.phaseDeg })),
    yLabel: 'Phase (°)',
    xLabel: `Frequency (${unit})`,
    ...(options.margins ? { refs: [-180] } : {}),
  };
  fig.drawPanel(mag, options.grid, false);
  fig.drawPanel(phase, options.grid, true);

  if (options.margins) {
    const toX = (w: number) => (options.hz ? w / TWO_PI : w);
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
        value: `${fmt(s.r.magDb[i]!)} dB · ${fmt(s.r.phaseDeg[i]!)}°`,
      })),
    }),
    xs,
  );
  return fig;
}

// ---- Step ------------------------------------------------------------------------

export function renderStep(target: HTMLElement, block: Block): Figure {
  const { options } = block;
  const systems = analyses(block);
  const T = options.t ?? Math.max(...systems.map((s) => autoT(s.a)));
  const ts = Array.from({ length: STEP_SAMPLES }, (_, i) => (T * i) / (STEP_SAMPLES - 1));
  const responses = systems.map((s) => {
    try {
      return { ...s, y: stepResponse(s.a.tf, T, STEP_SAMPLES), st: stability(s.a) };
    } catch (err) {
      if (err instanceof ImproperError) throw new BlockError(`${s.name}: ${err.message}`);
      throw err;
    }
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
    series: responses.map((s): Series => ({ name: s.name, slot: s.slot, xs: ts, ys: s.y })),
    yLabel: 'Amplitude',
    xLabel: 'Time (s)',
    refs: finals,
  };
  fig.drawPanel(panel, options.grid, true);
  for (const s of responses) {
    const who = systems.length > 1 ? `${s.name}: ` : '';
    if (s.st === 'stable') fig.note(`${who}final value ${fmt(dcGain(s.a))}`);
    else fig.note(`${who}${s.st === 'unstable' ? 'Unstable system' : 'Marginally stable system'}`, 'warning');
  }
  fig.crosshair(
    [panel],
    (i) => ({
      head: `t = ${fmt(ts[i]!)} s`,
      rows: responses.map((s) => ({ slot: s.slot, name: s.name, value: fmt(s.y[i]!) })),
    }),
    ts,
  );
  return fig;
}

// ---- Pole-zero map ---------------------------------------------------------------

const rootText = (z: Complex) =>
  z.im === 0 ? fmt(z.re) : `${fmt(z.re)} ${z.im > 0 ? '+' : '−'} ${fmt(Math.abs(z.im))}j`;

export function renderPzmap(target: HTMLElement, block: Block): Figure {
  const { options } = block;
  const systems = analyses(block);
  const all = systems.flatMap((s) => [...s.a.poles, ...s.a.zeros]);
  const [reLo, reHi] = extent([...all.map((z) => z.re), 0]);
  const [imLo, imHi] = extent([...all.map((z) => z.im), 0]);
  const plotH = 300;
  const fig = new Figure(target, {
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
  // The imaginary axis.
  if (x.domain[0] <= 0 && x.domain[1] >= 0)
    g.append(svg('line', { x1: x(0), x2: x(0), y1: MARGIN.top, y2: MARGIN.top + plotH }, 'ref'));

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
