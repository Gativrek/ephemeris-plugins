/**
 * Insert Citation… (API 1.3.0): an overlay that searches the note's libraries by key,
 * author, title and year. Enter inserts the highlighted reference, or every marked one
 * (Tab marks), as `[@a; @b]`; Esc closes.
 */
import type { PluginContext } from '@ephemeris-notes/plugin-api';
import type { CslItem } from './bib';

const ID = 'citations';
const MAX_SHOWN = 100;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = `${ID}-${cls}`;
  if (text !== undefined) e.textContent = text;
  return e;
};

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

interface Row {
  item: CslItem;
  authors: string;
  year: string;
  haystack: string;
}

function rowOf(item: CslItem): Row {
  const names = (item.author ?? item.editor ?? []).map((n) => n.literal ?? n.family ?? '').filter(Boolean);
  const authors = names.length > 3 ? `${names.slice(0, 3).join(', ')} et al.` : names.join(', ');
  const year = String(item.issued?.['date-parts']?.[0]?.[0] ?? item.issued?.literal ?? '');
  const haystack = fold(
    [item.id, names.join(' '), item.title ?? '', year, item['container-title'] ?? ''].join(' '),
  );
  return { item, authors, year, haystack };
}

/** Every word of the query must appear; key matches first, then by year, newest first. */
export function search(rows: Row[], query: string): Row[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hits = words.length ? rows.filter((r) => words.every((w) => r.haystack.includes(w))) : rows;
  const q = fold(query.trim());
  return [...hits].sort(
    (a, b) =>
      Number(fold(b.item.id).startsWith(q)) - Number(fold(a.item.id).startsWith(q)) ||
      Number(b.year || 0) - Number(a.year || 0) ||
      a.item.id.localeCompare(b.item.id),
  );
}

export { rowOf };

export function openPicker(ctx: PluginContext, items: CslItem[], insert: (text: string) => void): void {
  const rows = items.map(rowOf);
  const marked = new Set<string>();
  let shown: Row[] = [];
  let at = 0;
  const handle = ctx.ui.openOverlay({
    title: 'Insert Citation',
    size: 'large',
    render: (root) => {
      const wrap = el('div', 'picker');
      const input = el('input', 'picker-input');
      input.type = 'search';
      input.placeholder = 'Search by author, title, year or key';
      input.setAttribute('aria-label', 'Search references');
      const list = el('div', 'picker-list');
      list.setAttribute('role', 'listbox');
      const hint = el('p', 'picker-hint', '↑↓ choose · Tab marks several · Enter inserts · Esc closes');
      wrap.append(input, list, hint);
      root.append(wrap);

      const draw = () => {
        shown = search(rows, input.value).slice(0, MAX_SHOWN);
        at = Math.min(at, Math.max(0, shown.length - 1));
        list.replaceChildren();
        if (!shown.length) list.append(el('p', 'picker-empty', 'No reference matches.'));
        shown.forEach((r, i) => {
          const row = el('div', 'picker-row');
          row.setAttribute('role', 'option');
          row.setAttribute('aria-selected', String(i === at));
          if (marked.has(r.item.id)) row.classList.add(`${ID}-picker-marked`);
          const head = el('div', 'picker-head');
          head.append(el('span', 'picker-authors', r.authors || '—'), el('span', 'picker-year', r.year));
          row.append(
            head,
            el('div', 'picker-title', r.item.title ?? ''),
            el('div', 'picker-key', `@${r.item.id}`),
          );
          row.addEventListener('mousemove', () => {
            if (at !== i) {
              at = i;
              draw();
            }
          });
          row.addEventListener('click', () => {
            at = i;
            done();
          });
          list.append(row);
        });
        list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
      };
      const done = () => {
        const keys = marked.size ? [...marked] : shown[at] ? [shown[at]!.item.id] : [];
        if (!keys.length) return;
        handle.close();
        insert(`[${keys.map((k) => `@${k}`).join('; ')}]`);
      };
      input.addEventListener('input', () => {
        at = 0;
        draw();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') at = Math.min(at + 1, shown.length - 1);
        else if (e.key === 'ArrowUp') at = Math.max(at - 1, 0);
        else if (e.key === 'Enter') return void (e.preventDefault(), done());
        else if (e.key === 'Tab' && shown[at]) {
          const id = shown[at]!.item.id;
          if (marked.has(id)) marked.delete(id);
          else marked.add(id);
        } else return;
        e.preventDefault();
        draw();
      });
      draw();
      requestAnimationFrame(() => input.focus());
    },
  });
}
