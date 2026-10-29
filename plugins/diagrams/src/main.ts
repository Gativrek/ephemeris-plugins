/**
 * Diagrams (SPECS 13.1): ```mermaid blocks. A flowchart in the editable subset with every
 * node placed is drawn by the plugin; anything else goes through Mermaid. The Edit
 * button opens the canvas. Errors are thrown, so the host shows its error state.
 */
import type {
  BlockHost,
  BlockInfo,
  BlockView,
  Plugin,
  PluginContext,
  PluginFactory,
} from '@ephemeris-notes/plugin-api';
import { openCanvas } from './canvas';
import { HELP } from './help';
import { loadMath, makeLabels, needsMath } from './labels';
import { renderMermaid } from './mermaid';
import { drawDiagram } from './render';
import { hasAllPositions, parseDiagram } from './syntax';

const STARTER = 'flowchart LR\n  A[Start] --> B{Ready?}\n  B -->|yes| C[Done]';

class Diagrams implements Plugin {
  private ctx!: PluginContext;
  private readonly redraws = new Set<() => void>();

  onload(ctx: PluginContext): void {
    this.ctx = ctx;
    ctx.blocks.register('mermaid', {
      starter: STARTER,
      render: (el, info, host) => this.render(el, info, host),
    });
    ctx.theme.onChange(() => {
      for (const r of this.redraws) r();
    });
    ctx.help.register([{ id: 'tutorial', title: 'Mermaid quick tutorial', markdown: HELP }]);
  }

  /** Draws into a fresh element, then swaps it in, so a redraw never leaves the block empty. */
  private async draw(info: BlockInfo): Promise<HTMLElement> {
    const box = document.createElement('div');
    box.className = 'diagrams-block';
    const parsed = parseDiagram(info.source);
    if (parsed.ok && hasAllPositions(parsed.diagram)) {
      const d = parsed.diagram;
      const all = [...d.nodes.map((n) => n.label), ...d.edges.map((e) => e.label)];
      if (needsMath(all)) await loadMath();
      const { svg, extent } = drawDiagram(d, makeLabels());
      svg.setAttribute('width', String(Math.round(extent.w)));
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', `Diagram of ${d.nodes.length} nodes`);
      svg.style.maxWidth = '100%';
      svg.style.height = 'auto';
      box.dataset.renderer = 'own';
      box.append(svg);
    } else {
      const svg = await renderMermaid(info.source, this.ctx.theme);
      const wrap = document.createElement('div');
      wrap.className = 'diagrams-mermaid';
      wrap.innerHTML = svg;
      box.dataset.renderer = 'mermaid';
      box.append(wrap);
    }
    const title = info.args.named.title?.trim();
    if (title) {
      const caption = document.createElement('p');
      caption.className = 'vx-plugin-block__caption';
      caption.textContent = title;
      box.append(caption);
    }
    return box;
  }

  /** No update(): an edit re-renders, so a new syntax error reaches the host's error state. */
  private async render(el: HTMLElement, info: BlockInfo, host: BlockHost): Promise<BlockView> {
    const show = (box: HTMLElement) => {
      if (!host.readOnly) box.append(this.editButton(info, host));
      el.replaceChildren(box);
    };
    show(await this.draw(info));
    const redraw = () => {
      this.draw(info).then(show, (err: unknown) => this.ctx.log.error('redraw failed', err));
    };
    this.redraws.add(redraw);
    host.signal.addEventListener('abort', () => this.redraws.delete(redraw));
    return { dispose: () => this.redraws.delete(redraw) };
  }

  private editButton(info: BlockInfo, host: BlockHost): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'diagrams-edit vx-btn vx-btn--small';
    btn.textContent = 'Edit';
    btn.title = 'Edit on the canvas';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void openCanvas(info, host, this.ctx);
    });
    return btn;
  }
}

const factory: PluginFactory = () => new Diagrams();
export default factory;
