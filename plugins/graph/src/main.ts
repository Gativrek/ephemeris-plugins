/**
 * Graph view (SPECS 13.11): the library's notes and their links, from the core's link graph
 * (12.13.1), drawn on a canvas. Reads only.
 */
import type { Plugin, PluginContext, PluginFactory } from '@ephemeris-notes/plugin-api';
import { HELP } from './help';
import { normalize, renderGraphView, viewTitle, type GraphState } from './view';

class Graph implements Plugin {
  /** The note the editor last showed: a local graph centres on it. */
  private lastNote: string | null = null;

  onload(ctx: PluginContext): void {
    // The outline is built for each note the editor shows, including while a view is
    // in front; it adds nothing here, it only remembers the note.
    ctx.outline.contribute(({ note }) => {
      this.lastNote = note.path;
      return [];
    });

    ctx.views.register('graph', {
      title: (state) => viewTitle(normalize(state)),
      icon: 'graph',
      render: (root, state, host) => renderGraphView(ctx, root, state, host, () => this.lastNote),
    });
    const open = (state: GraphState) =>
      void ctx.views.open('graph', { key: state.center ? 'local' : 'global', state });

    ctx.commands.register({
      id: 'open',
      title: 'Open Graph',
      run: () => {
        const note = ctx.editor.activeNote();
        open({
          ...normalize(null),
          scope: note?.vaultPath ? 'vault' : 'all',
          vaultPath: note?.vaultPath ?? null,
          domain: note?.domain ?? null,
          focus: note?.path ?? null,
        });
      },
    });
    ctx.commands.register({
      id: 'local',
      title: 'Open Local Graph',
      run: () => {
        const path = ctx.editor.activeNote()?.path ?? this.lastNote;
        if (!path) return ctx.ui.notify('Open a note first: the local graph is around it.');
        open({ ...normalize(null), center: path, focus: path });
      },
    });

    ctx.help.register([{ id: 'guide', title: 'Graph view guide', markdown: HELP }]);
  }
}

const factory: PluginFactory = () => new Graph();
export default factory;
