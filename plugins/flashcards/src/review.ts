/**
 * The review view (SPECS 13.6): a desk item with what is due per note and section, then
 * each card's front, its answer, and the four grades. A card's first grade gives its line
 * a block ID (the plugin's only note edit, after a click or key press in this view).
 */
import type { Disposable, NoteRef, PluginContext, ViewHost, ViewInstance } from '@ephemeris-notes/plugin-api';
import { idEdit, newId, parseCards, withId, type CardDef } from './cards';
import { Rating } from 'ts-fsrs';
import { dayOf, dueCards, emptyState, GRADES, Scheduler, type VaultState } from './schedule';

const ID = 'flashcards';

export interface ReviewState {
  vaultPath: string;
  /** One note only; without it, every opted-in note of the Vault. */
  notePath?: string;
}

interface Note {
  path: string;
  text: string;
  hash: string;
  cards: CardDef[];
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls
    .split(' ')
    .map((c) => `${ID}-${c}`)
    .join(' ');
  if (text !== undefined) e.textContent = text;
  return e;
};
const button = (label: string, cls: string, run: () => void, hint?: string) => {
  const b = el('button', cls);
  b.type = 'button';
  b.className += ' vx-btn';
  b.append(document.createTextNode(label));
  if (hint) b.append(el('kbd', 'kbd', hint));
  b.addEventListener('click', run);
  return b;
};
const noteName = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '');
const frontmatterOptIn = (text: string) => {
  const fm = /^---\n([\s\S]*?)\n(?:---|\.\.\.)\s*\n/.exec(text);
  return !!fm && /^flashcards:\s*true\s*$/m.test(fm[1]!);
};

export function scopeTitle(s: ReviewState): string {
  return s.notePath ? `Review: ${noteName(s.notePath)}` : `Review: ${noteName(s.vaultPath)}`;
}

export function renderReview(
  ctx: PluginContext,
  root: HTMLElement,
  initial: ReviewState,
  host: ViewHost,
): ViewInstance {
  let scope = initial;
  const box = el('div', 'review');
  box.tabIndex = 0;
  root.append(box);
  const store = ctx.storage.vault(scope.vaultPath);
  const scheduler = new Scheduler(Number(ctx.settings.get<string>('retention')) || 0.9);
  const newPerDay = Math.max(0, Number(ctx.settings.get<number>('newPerDay') ?? 20));
  let notes: Note[] = [];
  let state: VaultState = emptyState();
  let rendered: Disposable[] = [];
  let onKey: ((e: KeyboardEvent) => boolean) | null = null;

  const clear = () => {
    for (const d of rendered) d.dispose();
    rendered = [];
    onKey = null;
    box.replaceChildren();
  };
  const markdown = (target: HTMLElement, md: string, path: string) => {
    const from: NoteRef = { path, vaultPath: scope.vaultPath, domain: null, frontmatter: {} };
    rendered.push(host.renderMarkdown(target, md, from));
  };
  box.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (onKey?.(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  async function loadNotes(): Promise<void> {
    let paths: string[];
    if (scope.notePath) paths = [scope.notePath];
    else {
      const recs = await ctx.index.query({
        extractor: 'cards',
        scope: { kind: 'vault', vaultPath: scope.vaultPath },
        limit: 10000,
      });
      paths = [...new Set(recs.map((r) => r.path))].sort();
    }
    const read = await Promise.all(
      paths.map(async (path) => {
        try {
          const { text, hash } = await ctx.notes.read(path);
          if (!frontmatterOptIn(text)) return null;
          return { path, text, hash, cards: parseCards(text, path) };
        } catch {
          return null;
        }
      }),
    );
    notes = read.filter((n): n is Note => !!n && n.cards.length > 0);
    state = { ...emptyState(), ...(await store.readJson<VaultState>('state.json', emptyState())) };
  }

  // ---- Overview -----------------------------------------------------------------

  async function overview(): Promise<void> {
    clear();
    box.append(el('p', 'loading', 'Reading cards…'));
    await loadNotes();
    clear();
    host.setTitle(scopeTitle(scope));
    const now = new Date();
    const all = notes.flatMap((n) => n.cards);
    const due = dueCards(all, state, now, newPerDay);
    const head = el('div', 'overview-head');
    head.append(
      el(
        'h2',
        'title',
        scope.notePath ? noteName(scope.notePath) : `Flashcards in ${noteName(scope.vaultPath)}`,
      ),
    );
    const counts = el('p', 'counts');
    counts.textContent = `${due.review.length} to review · ${due.fresh.length} new${
      due.heldBack ? ` (${due.heldBack} more new after today's limit of ${newPerDay})` : ''
    } · ${all.length} cards`;
    head.append(counts);
    box.append(head);
    if (!all.length) {
      box.append(
        el(
          'p',
          'empty',
          scope.notePath
            ? 'No cards in this note. Write lines like "Question :: Answer", or hide a word with {{double braces}}.'
            : 'No cards in this Vault yet. Add "flashcards: true" to a note\'s frontmatter, then write lines like "Question :: Answer".',
        ),
      );
      return;
    }
    const queue = [...due.review, ...due.fresh];
    if (queue.length) {
      const start = button(
        `Start (${queue.length})`,
        'start vx-btn--primary',
        () => void session(queue),
        'Enter',
      );
      box.append(start);
      onKey = (e) => (e.key === 'Enter' ? (void session(queue), true) : false);
    } else
      box.append(
        el(
          'p',
          'empty',
          `Nothing due now.${due.next ? ` The next card is due ${when(due.next, now)}.` : ''}`,
        ),
      );

    // Per note and section: due now, new, and all.
    const table = el('table', 'table');
    const thead = el('tr', 'row head');
    for (const h of ['Note and section', 'Due', 'New', 'Cards']) thead.append(el('th', 'cell', h));
    table.append(thead);
    const dueKeys = new Set(due.review.map((c) => c.key));
    const freshKeys = new Set(due.fresh.map((c) => c.key));
    for (const n of notes) {
      const groups = new Map<string, CardDef[]>();
      for (const c of n.cards) groups.set(c.section, [...(groups.get(c.section) ?? []), c]);
      const noteRow = el('tr', 'row note');
      const name = el('td', 'cell name');
      if (!scope.notePath) {
        const open = el('button', 'link', noteName(n.path));
        open.type = 'button';
        open.title = 'Review only this note';
        open.addEventListener('click', () => {
          scope = { vaultPath: scope.vaultPath, notePath: n.path };
          host.saveState(scope);
          void overview();
        });
        name.append(open);
      } else name.textContent = noteName(n.path);
      noteRow.append(
        name,
        el('td', 'cell num', String(n.cards.filter((c) => dueKeys.has(c.key)).length)),
        el('td', 'cell num', String(n.cards.filter((c) => freshKeys.has(c.key)).length)),
        el('td', 'cell num', String(n.cards.length)),
      );
      table.append(noteRow);
      if (groups.size > 1 || !groups.has(''))
        for (const [section, cards] of groups) {
          const r = el('tr', 'row section');
          r.append(
            el('td', 'cell name', section || '(before the first heading)'),
            el('td', 'cell num', String(cards.filter((c) => dueKeys.has(c.key)).length)),
            el('td', 'cell num', String(cards.filter((c) => freshKeys.has(c.key)).length)),
            el('td', 'cell num', String(cards.length)),
          );
          table.append(r);
        }
    }
    box.append(table);
    if (scope.notePath) {
      const back = button('All notes in the Vault', 'back', () => {
        scope = { vaultPath: scope.vaultPath };
        host.saveState(scope);
        void overview();
      });
      box.append(back);
    }
    box.focus();
  }

  // ---- Session ------------------------------------------------------------------

  async function session(queue: CardDef[]): Promise<void> {
    let done = 0;
    const show = () => {
      clear();
      const card = queue.shift();
      if (!card) return finish(done);
      const note = notes.find((n) => n.path === card.path) ?? notes[0]!;
      const head = el('div', 'card-head');
      head.append(
        el('span', 'where', `${noteName(note.path)}${card.section ? ` › ${card.section}` : ''}`),
        el('span', 'progress', `${done + 1} of ${done + queue.length + 1}`),
      );
      const front = el('div', 'front');
      markdown(front, card.front, note.path);
      const answer = el('div', 'answer');
      const actions = el('div', 'actions');
      box.append(head, front, answer, actions);
      const reveal = () => {
        answer.replaceChildren();
        if (card.kind === 'cloze') {
          front.hidden = true;
          markdown(answer, card.back, note.path);
        } else markdown(answer, card.back, note.path);
        actions.replaceChildren();
        const now = new Date();
        const labels = scheduler.preview(state.cards[card.key], now);
        for (const g of GRADES) {
          const b = button(g.label, `grade grade-${g.label.toLowerCase()}`, () => void grade(g.grade), g.key);
          b.append(el('span', 'interval', labels[g.grade]));
          actions.append(b);
        }
        onKey = (e) => {
          const g = GRADES.find((x) => x.key === e.key);
          if (!g) return false;
          void grade(g.grade);
          return true;
        };
      };
      actions.append(button('Show answer', 'show vx-btn--primary', reveal, 'Space'));
      onKey = (e) => (e.key === ' ' || e.key === 'Enter' ? (reveal(), true) : false);
      let graded = false;
      const grade = async (g: (typeof GRADES)[number]['grade']) => {
        if (graded) return;
        graded = true;
        onKey = null;
        const now = new Date();
        let key = card.key;
        if (!card.id) {
          const id = await giveId(note, card);
          if (!id) {
            ctx.ui.notify(
              'The card could not get its ID (its note changed or is read-only), so this review was not saved.',
              'error',
            );
            return show();
          }
          key = withId(card, id).key;
          // The other clozes of the line are the same card line: they now share the ID.
          for (let k = 0; k < queue.length; k++)
            if (
              queue[k]!.line === card.line &&
              !queue[k]!.id &&
              queue[k]!.key.startsWith(card.key.split('#')[0]!)
            )
              queue[k] = withId(queue[k]!, id);
        }
        const before = state.cards[key];
        if (!before) {
          const today = dayOf(now);
          state.newDay =
            state.newDay.date === today
              ? { date: today, count: state.newDay.count + 1 }
              : { date: today, count: 1 };
        }
        const after = scheduler.grade(before, g, now);
        state.cards[key] = after;
        await store.writeJson('state.json', state);
        done++;
        // A forgotten card comes back at the end of this session; any other waits for its due time.
        if (g === Rating.Again) queue.push({ ...card, id: key.split('#')[0]!, key });
        show();
      };
      box.focus();
    };
    show();
  }

  /** Adds the card's ID to its line (re-reading the note first), and returns it. */
  async function giveId(note: Note, card: CardDef): Promise<string | null> {
    const taken = new Set(Object.keys(state.cards).map((k) => k.split('#')[0]!));
    for (const n of notes) for (const c of n.cards) if (c.id) taken.add(c.id);
    const id = newId(taken);
    for (let attempt = 0; attempt < 2; attempt++) {
      const fresh = await ctx.notes.read(note.path);
      const edit = idEdit(fresh.text, card, id);
      if (!edit) return null;
      const r = await ctx.notes.edit(note.path, [edit], {
        expectedHash: fresh.hash,
        reason: 'Flashcards: give the card an ID for its review history',
      });
      if (r.ok) {
        note.text = fresh.text.slice(0, edit.from) + edit.insert + fresh.text.slice(edit.to);
        note.hash = r.hash;
        return id;
      }
      if (r.reason !== 'conflict') return null;
    }
    return null;
  }

  function finish(reviewed: number): void {
    clear();
    const now = new Date();
    const due = dueCards(
      notes.flatMap((n) => parseCards(n.text, n.path)),
      state,
      now,
      newPerDay,
    );
    box.append(el('h2', 'title', 'Done for now'));
    box.append(
      el(
        'p',
        'counts',
        `${reviewed} ${reviewed === 1 ? 'review' : 'reviews'}.${due.next ? ` The next card is due ${when(due.next, now)}.` : ''}`,
      ),
    );
    box.append(button('Back to the overview', 'back', () => void overview(), 'Enter'));
    onKey = (e) => (e.key === 'Enter' ? (void overview(), true) : false);
    box.focus();
  }

  void overview();
  return {
    dispose: () => {
      for (const d of rendered) d.dispose();
    },
  };
}

/** "in 10 min", "in 3 h", "tomorrow", "in 4 days", "on 2026-12-01". */
export function when(due: Date, now: Date): string {
  const min = Math.round((due.getTime() - now.getTime()) / 60000);
  if (min < 60) return `in ${Math.max(1, min)} min`;
  if (min < 24 * 60) return `in ${Math.round(min / 60)} h`;
  const days = Math.round(min / 1440);
  if (days === 1) return 'tomorrow';
  if (days < 30) return `in ${days} days`;
  return `on ${dayOf(due)}`;
}
