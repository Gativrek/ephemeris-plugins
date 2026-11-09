/**
 * The task list, shared by the ```tasks block and the Tasks view (SPECS 13.7): reads the
 * index, applies the query, draws one row per task, and ticks tasks in their notes.
 */
import type { IndexQuery, IndexRecord, NoteRef, PluginContext } from '@ephemeris-notes/plugin-api';
import { dueChip as chip, localDate, renderInline } from '@ephemeris-plugins/inline';
import { applyQuery, type TaskQuery } from './query';
import { parseTask, toggleEdit, type Task } from './tasks';

export interface ListOptions {
  query: TaskQuery;
  /** Messages about the query itself, shown above the list. */
  problems?: string[];
  /** Where the list is: its Vault and Domain give the `vault` and `domain` scopes. */
  from: Pick<NoteRef, 'path' | 'vaultPath' | 'domain'> | null;
  readOnly: boolean;
  signal: AbortSignal;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls
    .split(' ')
    .map((c) => `tasks-${c}`)
    .join(' ');
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The due date as a chip: "Overdue · 1 Nov", "Today" or "10 Nov" (text, not colour alone). */
export const dueChip = (due: string, today: string): HTMLElement => chip(due, today, 'tasks');

const CHANGED = 'This task changed in its note, so it was not ticked.';

const noteName = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '');
/** The Vault's folder name (Domain/Vault/…), for lists that cross Vaults. */
const vaultName = (path: string) => path.split('/')[1] ?? '';

export function mountList(ctx: PluginContext, root: HTMLElement, opts: ListOptions): void {
  const box = el('div', 'list');
  root.append(box);
  let generation = 0;
  let pending = false;

  const scope = (): IndexQuery['scope'] | string => {
    const { scope } = opts.query;
    if (scope === 'all') return { kind: 'all' };
    if (scope === 'vault')
      return opts.from?.vaultPath
        ? { kind: 'vault', vaultPath: opts.from.vaultPath }
        : 'This note is not in a Vault: use "scope: all".';
    return opts.from?.domain
      ? { kind: 'domain', domain: opts.from.domain }
      : 'This note is not in a Domain: use "scope: all".';
  };

  const load = async (): Promise<Task[] | string> => {
    const s = scope();
    if (typeof s === 'string') return s;
    const keys =
      opts.query.status === 'open' ? [' '] : opts.query.status === 'done' ? ['x', 'X'] : [undefined];
    const records: IndexRecord[] = [];
    for (const key of keys)
      records.push(
        ...(await ctx.index.query({ extractor: 'tasks', scope: s, limit: 10_000, ...(key ? { key } : {}) })),
      );
    return records.flatMap((r) => parseTask(r.path, r.line, r.key, r.value) ?? []);
  };

  const draw = async () => {
    const mine = ++generation;
    let tasks: Task[] | string;
    try {
      tasks = await load();
    } catch (err) {
      tasks = `Could not read tasks: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (mine !== generation || opts.signal.aborted) return;
    const today = localDate(new Date());
    box.replaceChildren();
    for (const p of opts.problems ?? []) box.append(el('p', 'problem', p));
    if (typeof tasks === 'string') {
      box.append(el('p', 'problem', tasks));
      return;
    }
    const all = applyQuery(tasks, opts.query, today);
    const shown = all.slice(0, opts.query.limit);
    if (shown.length === 0) {
      box.append(el('p', 'empty', opts.query.status === 'done' ? 'No done tasks here.' : 'No tasks here.'));
      return;
    }
    const crossVault = opts.query.scope !== 'vault';
    if (opts.query.group === 'note') {
      const byNote = new Map<string, Task[]>();
      for (const t of shown) byNote.set(t.path, [...(byNote.get(t.path) ?? []), t]);
      for (const [path, group] of byNote) {
        const head = el('h4', 'group');
        head.append(noteLink(path, group[0]!.line, crossVault));
        box.append(head, rows(group, today, false));
      }
    } else box.append(rows(shown, today, crossVault));
    if (all.length > shown.length) box.append(el('p', 'more', `${all.length - shown.length} more`));
  };

  const refresh = () => {
    // A tick writes the note and the index fires: wait for the tick to finish first.
    if (pending) return;
    void draw();
  };

  const noteLink = (path: string, line: number, withVault: boolean): HTMLElement => {
    const a = el('button', 'note', withVault ? `${noteName(path)} · ${vaultName(path)}` : noteName(path));
    a.type = 'button';
    a.title = path;
    a.addEventListener('click', () => void ctx.ui.openNote(path, { line }));
    return a;
  };

  const rows = (tasks: Task[], today: string, withVault: boolean): HTMLElement => {
    const ul = el('ul', 'rows');
    for (const t of tasks) {
      const li = el('li', 'row');
      li.classList.toggle('is-done', t.done);
      const box = el('input', 'check');
      box.type = 'checkbox';
      box.checked = t.done;
      box.disabled = opts.readOnly;
      box.setAttribute('aria-label', t.text);
      box.addEventListener('change', () => void tick(t, box, li));
      const text = el('span', 'text');
      renderInline(
        text,
        t.text,
        (target) => {
          const path = ctx.vault.resolve(target.split('#')[0]!, t.path);
          if (path) void ctx.ui.openNote(path);
          else ctx.ui.notify(`No note for "${target}".`);
        },
        'tasks',
      );
      li.append(box, text);
      if (t.due) li.append(dueChip(t.due, today));
      li.append(noteLink(t.path, t.line, withVault));
      ul.append(li);
    }
    return ul;
  };

  const tick = async (t: Task, check: HTMLInputElement, li: HTMLElement) => {
    const done = check.checked;
    check.disabled = true;
    pending = true;
    const why = await write(t, done);
    pending = false;
    if (opts.signal.aborted) return;
    if (why === CHANGED) {
      // The row is out of date: show the note as it is now.
      ctx.ui.notify(why);
      void draw();
      return;
    }
    if (why) {
      check.checked = !done;
      check.disabled = opts.readOnly;
      li.querySelector('.tasks-problem')?.remove();
      li.append(el('span', 'problem', why));
      return;
    }
    li.classList.toggle('is-done', done);
    void draw();
  };

  /** Writes the tick into the note; returns why it could not, or null. */
  const write = async (t: Task, done: boolean): Promise<string | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      let fresh: { text: string; hash: string };
      try {
        fresh = await ctx.notes.read(t.path);
      } catch {
        return 'The note is gone.';
      }
      const edit = toggleEdit(fresh.text, t, done);
      if (!edit) return CHANGED;
      const r = await ctx.notes.edit(t.path, [edit], {
        expectedHash: fresh.hash,
        reason: done ? 'Tasks: tick a task from the list' : 'Tasks: untick a task from the list',
      });
      if (r.ok) return null;
      if (r.reason === 'readOnly') return 'The note is read-only.';
      if (r.reason === 'notFound') return 'The note is gone.';
      if (r.reason === 'notAllowed') return 'Click the box again to tick it.';
      if (r.reason !== 'conflict') return 'The note could not be written.';
    }
    return 'The note kept changing: try again.';
  };

  const sub = ctx.index.onChanged(refresh);
  opts.signal.addEventListener('abort', () => sub.dispose(), { once: true });
  void draw();
}
