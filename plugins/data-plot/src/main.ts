/**
 * Data Plot (SPECS 13.4): ```plot blocks over CSV files in the Vault, or CSV written in
 * the block. The block redraws when the file changes and when the note's width does. A
 * problem on first render is thrown, so the host shows its error state; a problem after
 * the file changes is shown in the block until the file is fixed.
 */
import type { BlockInfo, BlockView, Plugin, PluginContext, PluginFactory } from '@ephemeris-notes/plugin-api';
import { html, setPrefix, type Figure } from '@ephemeris-plugins/chart';
import { BlockError, parseBlock, resolveFile, type PlotBlock } from './block';
import { parseCsv } from './csv';
import { HELP } from './help';
import { renderPlot } from './view';

const STARTER = 'x: t\ny: y\n---\nt, y\n0, 0\n1, 1\n2, 4\n3, 9';

class DataPlot implements Plugin {
  onload(ctx: PluginContext): void {
    setPrefix('data-plot');
    ctx.blocks.register('plot', {
      starter: STARTER,
      render: (el, info, host) => this.render(ctx, el, info, host.signal),
    });
    ctx.help.register([{ id: 'guide', title: 'Data Plot guide', markdown: HELP }]);
  }

  private async load(
    ctx: PluginContext,
    block: PlotBlock,
    info: BlockInfo,
  ): Promise<{ text: string; path: string | null }> {
    if (!block.file) return { text: block.inline!, path: null };
    const path = resolveFile(block.file, info.note.path, info.note.vaultPath);
    if (path === null) throw new BlockError(`${block.file} is outside the Vault.`);
    try {
      return { text: await ctx.vault.readText(path), path };
    } catch {
      throw new BlockError(`Cannot read ${block.file} (looked for ${path}).`);
    }
  }

  private draw(el: HTMLElement, block: PlotBlock, text: string, info: BlockInfo): Figure {
    const table = parseCsv(text, {
      ...(block.delimiter ? { delimiter: block.delimiter } : {}),
      ...(block.decimal ? { decimal: block.decimal } : {}),
    });
    el.replaceChildren();
    const box = html('div', 'block');
    el.append(box);
    const fig = renderPlot(box, block, table);
    const title = info.args.named.title?.trim();
    if (title) {
      const caption = document.createElement('p');
      caption.className = 'vx-plugin-block__caption';
      caption.textContent = title;
      box.append(caption);
    }
    return fig;
  }

  private async render(
    ctx: PluginContext,
    el: HTMLElement,
    info: BlockInfo,
    signal: AbortSignal,
  ): Promise<BlockView> {
    const block = parseBlock(info.source);
    let { text, path } = await this.load(ctx, block, info);
    let fig = this.draw(el, block, text, info);

    const redraw = () => {
      try {
        const next = this.draw(el, block, text, info);
        fig.dispose();
        fig = next;
      } catch (err) {
        // Shown in place of the plot until the data is readable again.
        el.replaceChildren(html('p', 'problem', err instanceof Error ? err.message : String(err)));
      }
    };
    // The note's width changed: draw again at the new width.
    let width = el.clientWidth;
    const resize = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - width) < 2) return;
      width = el.clientWidth;
      redraw();
    });
    resize.observe(el);
    // The file changed on disk (MATLAB wrote a new run, a sync arrived): read it again.
    const watch = path
      ? ctx.vault.watch(path, () => {
          void this.load(ctx, block, info).then(
            (r) => {
              ({ text, path } = r);
              redraw();
            },
            (err: unknown) =>
              el.replaceChildren(html('p', 'problem', err instanceof Error ? err.message : String(err))),
          );
        })
      : null;
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      resize.disconnect();
      watch?.dispose();
      fig.dispose();
    };
    signal.addEventListener('abort', stop);
    return { dispose: stop };
  }
}

const factory: PluginFactory = () => new DataPlot();
export default factory;
