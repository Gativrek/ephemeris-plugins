/**
 * Tasks (SPECS 13.7): GFM task items in any note, with `due:` dates, listed across notes by
 * ```tasks blocks and the Tasks view. Ticking from a list writes `[x]` into the note; that
 * is the only note edit the plugin makes.
 */
import type { Plugin, PluginContext, PluginFactory } from '@ephemeris-notes/plugin-api';
import { HELP } from './help';
import { dueChip, mountList } from './list';
import { parseQuery } from './query';
import { localDate } from '@ephemeris-plugins/inline';
import { DUE_INLINE, TASK_LINE } from './tasks';
import { normalize, renderTasksView, viewTitle, type TasksViewState } from './view';

class Tasks implements Plugin {
  onload(ctx: PluginContext): void {
    // Every task item in the library: key is the checkbox character, value the text after it.
    ctx.index.registerExtractor({
      id: 'tasks',
      version: 1,
      kind: 'regex',
      pattern: TASK_LINE,
      key: 1,
      value: 2,
    });

    ctx.blocks.register('tasks', {
      starter: 'scope: vault\ndue: week',
      render: (root, block, host) => {
        const { query, problems } = parseQuery(block.source);
        mountList(ctx, root, {
          query,
          problems,
          from: block.note,
          readOnly: host.readOnly,
          signal: host.signal,
        });
        // A changed query draws a new list.
        return { update: () => false };
      },
    });

    ctx.inline.register({
      id: 'due',
      match: DUE_INLINE,
      // A ticked task's date is history, not a deadline: no Overdue on it.
      widget: (m) => dueChip(m.groups[2]!, localDate(new Date()), m.groups[1] !== ' '),
    });

    ctx.views.register('list', {
      title: (state) => viewTitle(normalize(state)),
      icon: 'calendar',
      render: (root, state, host) => renderTasksView(ctx, root, state, host),
    });
    const open = (state: TasksViewState) =>
      void ctx.views.open('list', { key: state.scope === 'all' ? 'all' : (state.vaultPath ?? 'all'), state });
    ctx.commands.register({
      id: 'open-vault',
      title: 'Show Open Tasks (This Vault)',
      run: () => {
        const note = ctx.editor.activeNote();
        if (!note?.vaultPath)
          return ctx.ui.notify('Open a note in a Vault first: the list covers that Vault.');
        open({ ...normalize(null), vaultPath: note.vaultPath, domain: note.domain });
      },
    });
    ctx.commands.register({
      id: 'open-all',
      title: 'Show Open Tasks (All Vaults)',
      run: () => {
        const note = ctx.editor.activeNote();
        open({
          ...normalize(null),
          scope: 'all',
          vaultPath: note?.vaultPath ?? null,
          domain: note?.domain ?? null,
        });
      },
    });

    ctx.help.register([{ id: 'guide', title: 'Tasks guide', markdown: HELP }]);
  }
}

const factory: PluginFactory = () => new Tasks();
export default factory;
