/**
 * Clip (SPECS 13.8): ```clip blocks playing a segment of a local video, for guide
 * production. Plugin API 1.0 only; the block's text is the one thing it writes.
 */
import type { Plugin, PluginContext, PluginFactory } from '@ephemeris-notes/plugin-api';
import { HELP } from './help';
import { renderClip } from './player';

class Clip implements Plugin {
  onload(ctx: PluginContext): void {
    ctx.blocks.register('clip', {
      starter: 'file: \nstart: 0:00\nend: 0:10',
      render: (root, block, host) => renderClip(ctx, root, block, host),
    });
    ctx.help.register([{ id: 'guide', title: 'Clip guide', markdown: HELP }]);
  }
}

const factory: PluginFactory = () => new Clip();
export default factory;
