/**
 * Control Plots (SPECS 13.3): ```bode, ```step and ```pzmap blocks from transfer
 * functions. A parse or analysis error is thrown, so the host shows the plugin block
 * error state with the message (SPECS 12.8).
 */
import type { BlockInfo, BlockView, Plugin, PluginContext, PluginFactory } from '@ephemeris-notes/plugin-api';
import type { Figure } from './chart';
import { HELP } from './help';
import { parseBlock, type Kind } from './parse';
import { html } from './svg';
import { renderBode, renderPzmap, renderStep } from './views';

const RENDER: Record<Kind, (el: HTMLElement, block: ReturnType<typeof parseBlock>) => Figure> = {
  bode: renderBode,
  step: renderStep,
  pzmap: renderPzmap,
};

function draw(el: HTMLElement, kind: Kind, info: BlockInfo): Figure {
  const block = parseBlock(info.source);
  el.replaceChildren();
  const box = html('div', 'block');
  el.append(box);
  const fig = RENDER[kind](box, block);
  // The block's title="…" (SPECS 12.5): the outline's label, and the caption here.
  const title = info.args.named.title?.trim();
  if (title) {
    const caption = document.createElement('p');
    caption.className = 'vx-plugin-block__caption';
    caption.textContent = title;
    box.append(caption);
  }
  return fig;
}

class ControlPlots implements Plugin {
  onload(ctx: PluginContext): void {
    for (const kind of Object.keys(RENDER) as Kind[]) {
      ctx.blocks.register(kind, {
        render: (el, info, host): BlockView => {
          let current = info;
          let fig = draw(el, kind, current);
          let width = el.clientWidth;
          // Plots are drawn at the note's width; redraw when it changes.
          const resize = new ResizeObserver(() => {
            if (Math.abs(el.clientWidth - width) < 2) return;
            width = el.clientWidth;
            try {
              fig.dispose();
              fig = draw(el, kind, current);
            } catch (err) {
              ctx.log.error('redraw failed', err);
            }
          });
          resize.observe(el);
          host.signal.addEventListener('abort', () => resize.disconnect());
          return {
            update: (next) => {
              // A new error falls through to the host's error state on re-render.
              try {
                const nextFig = draw(el, kind, next);
                fig.dispose();
                fig = nextFig;
                current = next;
                return true;
              } catch {
                return false;
              }
            },
            dispose: () => {
              resize.disconnect();
              fig.dispose();
            },
          };
        },
      });
    }
    ctx.help.register([{ id: 'guide', title: 'Control Plots guide', markdown: HELP }]);
  }
}

const factory: PluginFactory = () => new ControlPlots();
export default factory;
