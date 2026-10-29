/**
 * DOM helpers. Classes are prefixed with the plugin id (SPECS 12.2): each plugin bundles
 * its own copy of this package and calls setPrefix() once, before drawing.
 */

let prefix = 'chart';

export function setPrefix(id: string): void {
  prefix = id;
}
export const getPrefix = () => prefix;
const NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  cls?: string,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (cls)
    e.setAttribute(
      'class',
      cls
        .split(' ')
        .map((c) => `${prefix}-${c}`)
        .join(' '),
    );
  return e;
}

export function html<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls
    .split(' ')
    .map((c) => `${prefix}-${c}`)
    .join(' ');
  if (text !== undefined) e.textContent = text;
  return e;
}

export function label(
  x: number,
  y: number,
  text: string,
  cls: string,
  anchor: 'start' | 'middle' | 'end' = 'middle',
): SVGTextElement {
  const t = svg('text', { x, y, 'text-anchor': anchor }, cls);
  t.textContent = text;
  return t;
}

/** A polyline path that breaks where a value is not finite (a zero on the axis: -∞ dB). */
export function linePath(xs: number[], ys: number[]): string {
  let d = '';
  let open = false;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(y) > 1e6) {
      open = false;
      continue;
    }
    d += `${open ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    open = true;
  }
  return d;
}

/** Scatter points: a zero-length segment per sample, drawn as a dot by a round line cap. */
export function pointsPath(xs: number[], ys: number[]): string {
  let d = '';
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    if (Number.isFinite(x) && Number.isFinite(y)) d += `M${x.toFixed(2)},${y.toFixed(2)}h0`;
  }
  return d;
}
