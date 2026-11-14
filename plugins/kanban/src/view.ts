/**
 * The board view (SPECS 13.10): the note's columns and cards, beside the note on the desk.
 * Cards move by dragging or Alt+Arrow keys, are added at a column's foot and ticked by their
 * box; every change is one `notes.edit` on the note as it is now.
 */
import type { PluginContext, ViewHost } from '@ephemeris-notes/plugin-api';
import { dueChip, localDate, renderInline } from '@ephemeris-plugins/inline';
import { addCard, findCard, moveCard, parseBoard, tickCard, type Board, type Card, type Edit } from './board';

export interface BoardState {
  path: string;
}

export const noteName = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '');

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = `kanban-${cls}`;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Which card has focus, kept across redraws: its column and text. */
type Focus = { column: string; raw: string } | null;

export function renderBoardView(
  ctx: PluginContext,
  root: HTMLElement,
  state: BoardState,
  host: ViewHost,
): void {
  const path = state.path;
  const page = el('div', 'view');
  const head = el('div', 'head');
  const title = el('h2', 'title', noteName(path));
  const openNote = el('button', 'open', 'Open Note');
  openNote.type = 'button';
  openNote.addEventListener('click', () => void ctx.ui.openNote(path));
  const status = el('p', 'status');
  status.setAttribute('role', 'status');
  head.append(title, openNote);
  const lanes = el('div', 'lanes');
  page.append(head, status, lanes);
  root.append(page);

  let text = '';
  let board: Board = { columns: [], level: 0 };
  let focus: Focus = null;
  /** Set by the board's own changes: where the focus goes after them. */
  let moved = false;
  let busy = false;
  const say = (message: string) => (status.textContent = message);

  const load = async () => {
    try {
      text = (await ctx.notes.read(path)).text;
    } catch {
      lanes.replaceChildren(el('p', 'empty', `The note ${path} is gone.`));
      return;
    }
    if (host.signal.aborted) return;
    board = parseBoard(text);
    draw();
  };

  /**
   * Re-reads the note, finds the card again (the note may have changed), and writes the edit;
   * once more on a conflict. Returns why it could not, or null.
   */
  const write = async (
    reason: string,
    compute: (text: string, board: Board) => Edit | null | 'gone',
  ): Promise<string | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const fresh = await ctx.notes.read(path).catch(() => null);
      if (!fresh) return 'The note is gone.';
      const edit = compute(fresh.text, parseBoard(fresh.text));
      if (edit === 'gone') return 'This card changed in the note, so it was not moved.';
      if (!edit) return null;
      const r = await ctx.notes.edit(path, [edit], { expectedHash: fresh.hash, reason });
      if (r.ok) return null;
      if (r.reason === 'notAllowed') return 'Move it again: a move must end within 5 seconds of starting it.';
      if (r.reason === 'readOnly') return 'The note is read-only.';
      if (r.reason !== 'conflict') return 'The note could not be written.';
    }
    return 'The note kept changing: try again.';
  };

  const run = async (reason: string, compute: Parameters<typeof write>[1]) => {
    if (busy) return;
    busy = true;
    say('');
    const why = await write(reason, compute);
    busy = false;
    if (why) say(why);
    await load();
  };

  /** Moves a card (found again by column and text) to `index` in column `to`. */
  const move = (columnTitle: string, card: Card, to: number, index: number) => {
    const target = board.columns[to];
    if (!target) return;
    focus = { column: target.title, raw: card.raw };
    moved = true;
    void run(`Kanban: move a card to ${target.title}`, (t, b) => {
      const found = findCard(b, columnTitle, card);
      if (!found) return 'gone';
      const toNow = b.columns.findIndex((c) => c.title === target.title);
      return toNow === -1 ? 'gone' : moveCard(t, b, found.card, toNow, index);
    });
  };

  // ---- Drawing ---------------------------------------------------------------------------
  let dragging: { column: number; card: Card } | null = null;
  const marker = el('div', 'marker');

  const draw = () => {
    const today = localDate(new Date());
    // Focus comes back only when it was on the board: the board redraws as the note is
    // saved, and must not take the focus from the note's editor.
    const active = document.activeElement;
    const hadFocus = active instanceof HTMLElement && page.contains(active);
    if (hadFocus && !moved && active.classList.contains('kanban-card'))
      focus = { column: active.dataset.column ?? '', raw: active.dataset.raw ?? '' };
    moved = true;
    lanes.replaceChildren();
    if (!board.columns.length) {
      lanes.append(
        el(
          'p',
          'empty',
          'This note has no columns yet: add headings such as "## To do", with list items under them.',
        ),
      );
      return;
    }
    let toFocus: HTMLElement | null = null;
    for (const [k, column] of board.columns.entries()) {
      const lane = el('section', 'lane');
      lane.setAttribute('aria-label', column.title);
      const laneHead = el('h3', 'lane-title', column.title);
      laneHead.append(el('span', 'count', String(column.cards.length)));
      const list = el('div', 'cards');
      list.setAttribute('role', 'list');
      for (const [i, card] of column.cards.entries()) {
        const face = drawCard(card, k, i, today);
        if (focus && focus.column === column.title && focus.raw === card.raw) toFocus = face;
        list.append(face);
      }
      // Dropping: the marker shows where the card will go.
      list.addEventListener('dragover', (e) => {
        if (!dragging) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const faces = [...list.querySelectorAll<HTMLElement>('.kanban-card')].filter(
          (f) => !f.classList.contains('is-dragging'),
        );
        const before = faces.find((f) => e.clientY < f.getBoundingClientRect().top + f.offsetHeight / 2);
        list.insertBefore(marker, before ?? null);
      });
      list.addEventListener('drop', (e) => {
        if (!dragging) return;
        e.preventDefault();
        const faces = [...list.children].filter(
          (f) =>
            f === marker || (f.classList.contains('kanban-card') && !f.classList.contains('is-dragging')),
        );
        const index = faces.indexOf(marker);
        const from = dragging;
        dragging = null;
        marker.remove();
        move(board.columns[from.column]!.title, from.card, k, Math.max(0, index));
      });
      lane.append(laneHead, list, addControl(k));
      lanes.append(lane);
    }
    if (hadFocus) toFocus?.focus();
    moved = false;
  };

  const drawCard = (card: Card, k: number, i: number, today: string): HTMLElement => {
    const face = el('div', 'card');
    face.setAttribute('role', 'listitem');
    face.tabIndex = 0;
    face.dataset.column = board.columns[k]!.title;
    face.dataset.raw = card.raw;
    face.draggable = true;
    face.title = 'Drag, or Alt+Arrow keys, to move; Enter opens it in the note';
    if (card.done !== null) {
      const box = el('input', 'check');
      box.type = 'checkbox';
      box.checked = card.done;
      box.setAttribute('aria-label', card.text || 'Card');
      box.addEventListener('click', (e) => e.stopPropagation());
      box.addEventListener('change', () => {
        focus = { column: board.columns[k]!.title, raw: card.raw };
        moved = true;
        const columnTitle = board.columns[k]!.title;
        void run(box.checked ? 'Kanban: tick a card' : 'Kanban: untick a card', (t, b) => {
          const found = findCard(b, columnTitle, card);
          return found ? tickCard(t, found.card, box.checked) : 'gone';
        });
      });
      face.append(box);
    }
    face.classList.toggle('is-done', card.done === true);
    const body = el('div', 'body');
    const words = el('span', 'text');
    renderInline(
      words,
      card.text,
      (target) => {
        const linked = ctx.vault.resolve(target.split('#')[0]!, path);
        if (linked) void ctx.ui.openNote(linked);
        else say(`No note for "${target}".`);
      },
      'kanban',
    );
    body.append(words);
    const meta = el('div', 'meta');
    if (card.due) meta.append(dueChip(card.due, today, 'kanban', card.done === true));
    if (card.extra) meta.append(el('span', 'extra', `+${card.extra} ${card.extra === 1 ? 'line' : 'lines'}`));
    if (meta.childElementCount) body.append(meta);
    face.append(body);

    const open = () => void ctx.ui.openNote(path, { line: card.start + 1 });
    face.addEventListener('click', open);
    face.addEventListener('dragstart', (e) => {
      dragging = { column: k, card };
      face.classList.add('is-dragging');
      e.dataTransfer?.setData('text/plain', card.raw);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    face.addEventListener('dragend', () => {
      face.classList.remove('is-dragging');
      marker.remove();
      dragging = null;
    });
    face.addEventListener('keydown', (e) => {
      const column = board.columns[k]!;
      if (e.key === 'Enter') {
        e.preventDefault();
        open();
        return;
      }
      const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
      if (!dir) return;
      e.preventDefault();
      const [dc, di] = dir as [number, number];
      if (e.altKey) {
        // Move the card: across columns at the same place, or within its column.
        const to = k + dc;
        if (to < 0 || to >= board.columns.length) return;
        const index = dc ? Math.min(i, board.columns[to]!.cards.length) : i + di;
        if (!dc && (index < 0 || index >= column.cards.length)) return;
        move(column.title, card, to, index);
        return;
      }
      // Move the focus.
      const faces = (n: number) =>
        [...lanes.querySelectorAll<HTMLElement>('.kanban-lane')][n]?.querySelectorAll<HTMLElement>(
          '.kanban-card',
        );
      const target = dc ? faces(k + dc)?.[Math.min(i, (faces(k + dc)?.length ?? 1) - 1)] : faces(k)?.[i + di];
      target?.focus();
    });
    return face;
  };

  const addControl = (k: number): HTMLElement => {
    const wrap = el('div', 'add');
    const button = el('button', 'add-button', '+ Add a card');
    button.type = 'button';
    button.addEventListener('click', () => {
      const input = el('input', 'add-input');
      input.type = 'text';
      input.placeholder = 'Card text, then Enter';
      input.setAttribute('aria-label', `New card in ${board.columns[k]!.title}`);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') wrap.replaceChildren(button);
        if (e.key !== 'Enter' || !input.value.trim()) return;
        const columnTitle = board.columns[k]!.title;
        const value = input.value;
        focus = { column: columnTitle, raw: `${value.replace(/\s+/g, ' ').trim()}` };
        void run(`Kanban: add a card to ${columnTitle}`, (t, b) => {
          const to = b.columns.findIndex((c) => c.title === columnTitle);
          return to === -1 ? 'gone' : addCard(t, b, to, value);
        });
      });
      wrap.replaceChildren(input);
      input.focus();
    });
    wrap.append(button);
    return wrap;
  };

  const watch = ctx.vault.watch(path, () => void load());
  host.signal.addEventListener('abort', () => watch.dispose(), { once: true });
  void load();
}
