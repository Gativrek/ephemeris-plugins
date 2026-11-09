/**
 * Kanban (SPECS 13.10): a note shown as a board of columns (headings) and cards (list
 * items), in a desk view beside the note. Moving, adding and ticking cards edit the note;
 * nothing else in it changes.
 */
import type { Plugin, PluginContext, PluginFactory } from '@ephemeris-notes/plugin-api';
import { isBoard } from './board';
import { HELP } from './help';
import { noteName, renderBoardView, type BoardState } from './view';

class Kanban implements Plugin {
  onload(ctx: PluginContext): void {
    ctx.views.register('board', {
      title: (state) => `Board: ${noteName((state as BoardState).path)}`,
      icon: 'panel',
      render: (root, state, host) => renderBoardView(ctx, root, state as BoardState, host),
    });
    const open = (path: string) =>
      void ctx.views.open('board', { key: path, state: { path } satisfies BoardState });

    ctx.commands.register({
      id: 'open',
      title: 'Open as Board',
      run: () => {
        const note = ctx.editor.activeNote();
        if (!note) return ctx.ui.notify('Open a note first.');
        if (!isBoard(note.frontmatter))
          return ctx.ui.notify('Add "kanban: true" to the note\'s frontmatter to use it as a board.');
        open(note.path);
      },
    });

    // At the end of a board note: a way to its board.
    ctx.footers.register({
      id: 'open',
      render: (el, note) => {
        if (!isBoard(note.frontmatter)) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'kanban-footer-open';
        button.textContent = 'Open as Board';
        button.addEventListener('click', () => open(note.path));
        el.append(button);
      },
    });

    ctx.help.register([{ id: 'guide', title: 'Kanban guide', markdown: HELP }]);
  }
}

const factory: PluginFactory = () => new Kanban();
export default factory;
