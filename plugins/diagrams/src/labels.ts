/**
 * Label measuring and math. Text is measured with a canvas in the UI font; math is
 * rendered by KaTeX (loaded on first use) and measured in a hidden element, so the
 * app's KaTeX styles and fonts apply.
 */
import type { Size } from './geometry';
import type { Labels } from './render';
import { isMath } from './syntax';

export const FONT_SIZE = 14;
const LINE = 20;

type Katex = typeof import('katex').default;
let katex: Katex | null = null;
let loading: Promise<void> | null = null;

/** Loads KaTeX once; resolves immediately when it is already loaded. */
export function loadMath(): Promise<void> {
  loading ??= import('katex').then((m) => {
    katex = m.default;
  });
  return loading;
}

export const needsMath = (labels: string[]) => labels.some(isMath);

function uiFont(): string {
  const family =
    getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif';
  return `${FONT_SIZE}px ${family}`;
}

let ctx2d: CanvasRenderingContext2D | null = null;
let probe: HTMLDivElement | null = null;
const cache = new Map<string, Size>();

function mathHtml(tex: string): string | null {
  if (!katex) return null;
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode: false, output: 'html' });
  } catch {
    return null;
  }
}

function measureMath(html: string): Size {
  if (!probe) {
    probe = document.createElement('div');
    probe.className = 'diagrams-math diagrams-probe';
    document.body.append(probe);
  }
  probe.innerHTML = html;
  const r = probe.getBoundingClientRect();
  return { w: Math.ceil(r.width), h: Math.max(LINE, Math.ceil(r.height)) };
}

/** Labels in the current UI font. Sizes are cached per font and text. */
export function makeLabels(): Labels {
  const font = uiFont();
  const measure = (label: string): Size => {
    const key = `${font}\n${katex ? 'tex' : 'text'}\n${label}`;
    const hit = cache.get(key);
    if (hit) return hit;
    let size: Size;
    const html = isMath(label) ? mathHtml(label.slice(2, -2)) : null;
    if (html !== null) size = measureMath(html);
    else {
      ctx2d ??= document.createElement('canvas').getContext('2d');
      const text = isMath(label) ? label.slice(2, -2) : label;
      let w = text.length * 8;
      if (ctx2d) {
        ctx2d.font = font;
        w = ctx2d.measureText(text).width;
      }
      size = { w: Math.ceil(w), h: LINE };
    }
    cache.set(key, size);
    return size;
  };
  return { measure, math: mathHtml };
}
