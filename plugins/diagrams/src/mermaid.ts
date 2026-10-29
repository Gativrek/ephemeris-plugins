/**
 * Mermaid, loaded on first use (SPECS 13.1): `securityLevel: 'strict'`, the base theme
 * with variables from the design tokens, and linear edges. Renders are queued, since
 * Mermaid keeps global state.
 */
import type { ThemeService } from '@ephemeris-notes/plugin-api';
import { FONT_SIZE } from './labels';

type Mermaid = typeof import('mermaid').default;
let mermaid: Promise<Mermaid> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let seq = 0;

const load = () => (mermaid ??= import('mermaid').then((m) => m.default));

/** Theme variables from tokens. Diagram colors never use cyan or gold (GOALS 20). */
function themeVariables(theme: ThemeService): Record<string, string> {
  const t = (name: string, fallback: string) => theme.token(name) || fallback;
  const surface = t('surface', '#ffffff');
  const raised = t('surface-raised', surface);
  const ink = t('ink', '#1b1b1b');
  const text = t('text', ink);
  const line = t('muted', text);
  const font =
    getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif';
  return {
    darkMode: String(theme.current === 'dark'),
    background: surface,
    fontFamily: font,
    fontSize: `${FONT_SIZE}px`,
    primaryColor: raised,
    primaryTextColor: ink,
    primaryBorderColor: ink,
    secondaryColor: raised,
    tertiaryColor: surface,
    lineColor: line,
    textColor: text,
    mainBkg: raised,
    nodeBorder: ink,
    clusterBkg: surface,
    clusterBorder: t('line', line),
    edgeLabelBackground: surface,
    titleColor: ink,
  };
}

/** Renders Mermaid source to an SVG string. Throws Mermaid's message on a syntax error. */
export function renderMermaid(source: string, theme: ThemeService): Promise<string> {
  const run = async () => {
    const m = await load();
    m.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: themeVariables(theme),
      flowchart: { curve: 'linear', htmlLabels: true },
    });
    const id = `diagrams-mermaid-${++seq}`;
    try {
      const { svg } = await m.render(id, source);
      return svg;
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err), { cause: err });
    } finally {
      // Mermaid leaves its scratch element (and, on errors, an error SVG) in the body.
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * Node centres from a Mermaid SVG, so the canvas starts from the layout the note
 * showed (SPECS 13.1). Returns null when the SVG has no recognizable nodes.
 */
export function positionsFromSvg(
  svgText: string,
  ids: string[],
): Map<string, { x: number; y: number }> | null {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;width:2000px;visibility:hidden';
  host.innerHTML = svgText;
  document.body.append(host);
  try {
    const out = new Map<string, { x: number; y: number }>();
    const svg = host.querySelector('svg');
    if (!svg) return null;
    for (const g of svg.querySelectorAll<SVGGElement>('g.node')) {
      const id = g.dataset.id ?? /flowchart-(.+)-\d+$/.exec(g.id)?.[1];
      if (!id || !ids.includes(id)) continue;
      // Mermaid places nodes with translate() on the node and its parent groups.
      let x = 0;
      let y = 0;
      for (let el: Element | null = g; el && el !== svg; el = el.parentElement) {
        const m = (el as SVGGraphicsElement).transform?.baseVal.consolidate()?.matrix;
        if (m) {
          x += m.e;
          y += m.f;
        }
      }
      out.set(id, { x, y });
    }
    return out.size === ids.length ? out : null;
  } finally {
    host.remove();
  }
}
