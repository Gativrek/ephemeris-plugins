/**
 * A note as a board (SPECS 13.10): headings of the column level are columns, top-level list
 * items under them are cards, with their indented lines. Everything else is kept and not
 * shown. Edits move a card's exact lines and change nothing else. Pure functions.
 */
import { splitDue } from '@ephemeris-plugins/inline';

export interface Card {
  /** 0-based line of the item, and the line after its last indented line. */
  start: number;
  end: number;
  /** The first line's text after the marker and checkbox. */
  raw: string;
  /** Without its `due:` field. */
  text: string;
  due: string | null;
  /** null when the item is not a task item. */
  done: boolean | null;
  /** Indented lines that belong to the card. */
  extra: number;
}

export interface Column {
  title: string;
  /** 0-based line of the heading. */
  line: number;
  cards: Card[];
}

export interface Board {
  columns: Column[];
  /** The heading level of columns, or 0 when there are none. */
  level: number;
}

export type Edit = { from: number; to: number; insert: string };

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ITEM = /^ ?(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/;
const TASK = /^( ?(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])\](?:[ \t]+(.*))?$/;

/** Opted in: `kanban: true`, or Obsidian's Kanban plugin's `kanban-plugin` field. */
export function isBoard(frontmatter: Readonly<Record<string, unknown>>): boolean {
  return frontmatter.kanban === true || typeof frontmatter['kanban-plugin'] === 'string';
}

/** Lines of the note that are neither frontmatter, code nor an Obsidian settings comment. */
function visible(lines: string[]): boolean[] {
  const ok = lines.map(() => true);
  let i = 0;
  if (lines[0]?.trimEnd() === '---') {
    const close = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (close !== -1) for (; i <= close; i++) ok[i] = false;
  }
  for (; i < lines.length; i++) {
    const fence = FENCE.exec(lines[i]!);
    if (fence) {
      const mark = fence[1]!;
      const close = new RegExp(`^ {0,3}\\${mark[0]}{${mark.length},}\\s*$`);
      ok[i] = false;
      while (i + 1 < lines.length && !close.test(lines[i + 1]!)) ok[++i] = false;
      if (i + 1 < lines.length) ok[++i] = false;
    } else if (/^%%\s*kanban:settings/.test(lines[i]!)) {
      // Obsidian's settings, to the line that closes the comment.
      ok[i] = false;
      while (i + 1 < lines.length && lines[i]!.trim() !== '%%') ok[++i] = false;
    }
  }
  return ok;
}

export function parseBoard(text: string): Board {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const ok = visible(lines);
  const headings: Array<{ line: number; level: number; title: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const h = ok[i] ? HEADING.exec(lines[i]!) : null;
    if (h) headings.push({ line: i, level: h[1]!.length, title: h[2]!.trim() });
  }
  // The column level: the first heading with a top-level list item under it.
  let level = 0;
  for (const [k, h] of headings.entries()) {
    const until = headings[k + 1]?.line ?? lines.length;
    if (lines.slice(h.line + 1, until).some((l, j) => ok[h.line + 1 + j] && ITEM.test(l))) {
      level = h.level;
      break;
    }
  }
  if (!level && headings.length) level = headings[0]!.level;
  const columns: Column[] = [];
  for (const [k, h] of headings.entries()) {
    if (h.level !== level) continue;
    // A column runs to the next heading of its level or higher.
    const next = headings.slice(k + 1).find((o) => o.level <= level);
    const until = next ? next.line : lines.length;
    const cards: Card[] = [];
    for (let i = h.line + 1; i < until; i++) {
      if (!ok[i] || !ITEM.test(lines[i]!)) continue;
      // Indented lines, and blank lines followed by indented ones, belong to the card.
      let end = i + 1;
      for (let j = i + 1; j < until && ok[j]; j++) {
        if (/^[ \t]+\S/.test(lines[j]!) && !ITEM.test(lines[j]!)) end = j + 1;
        else if (lines[j]!.trim() !== '') break;
      }
      const task = TASK.exec(lines[i]!);
      const raw = (task ? (task[3] ?? '') : lines[i]!.replace(ITEM, '')).trim();
      const { text: shown, due } = splitDue(raw);
      cards.push({
        start: i,
        end,
        raw,
        text: shown,
        due,
        done: task ? task[2] !== ' ' : null,
        extra: end - i - 1,
      });
      i = end - 1;
    }
    columns.push({ title: h.title, line: h.line, cards });
  }
  return { columns, level };
}

/** The single edit that turns `before` into `after`. */
export function diffEdit(before: string, after: string): Edit | null {
  if (before === after) return null;
  let a = 0;
  while (a < before.length && a < after.length && before[a] === after[a]) a++;
  let b = 0;
  while (
    b < before.length - a &&
    b < after.length - a &&
    before[before.length - 1 - b] === after[after.length - 1 - b]
  )
    b++;
  return { from: a, to: before.length - b, insert: after.slice(a, after.length - b) };
}

/** The line a card would be inserted at: before the card at `index` among `others`, or after the last. */
function insertLine(column: Column, others: Card[], index: number): number {
  if (index < others.length) return others[index]!.start;
  const last = others.at(-1);
  return last ? last.end : column.line + 1;
}

/**
 * Moves a card to `index` in the column `to` (its position among that column's other cards).
 * Null when nothing changes.
 */
export function moveCard(text: string, board: Board, card: Card, to: number, index: number): Edit | null {
  const lines = text.split('\n');
  const column = board.columns[to];
  if (!column) return null;
  const others = column.cards.filter((c) => c !== card);
  let at = insertLine(column, others, Math.max(0, Math.min(index, others.length)));
  const moved = lines.slice(card.start, card.end);
  const count = card.end - card.start;
  if (at >= card.end) at -= count;
  else if (at > card.start) at = card.start;
  const rest = [...lines.slice(0, card.start), ...lines.slice(card.end)];
  rest.splice(at, 0, ...moved);
  return diffEdit(text, rest.join('\n'));
}

/** Adds `- [ ] text` at the end of a column's cards. */
export function addCard(text: string, board: Board, to: number, cardText: string): Edit | null {
  const column = board.columns[to];
  const clean = cardText.replace(/\s+/g, ' ').trim();
  if (!column || !clean) return null;
  const lines = text.split('\n');
  const at = insertLine(column, column.cards, column.cards.length);
  const eol = lines[column.line]!.endsWith('\r') ? '\r' : '';
  lines.splice(at, 0, `- [ ] ${clean}${eol}`);
  return diffEdit(text, lines.join('\n'));
}

/** Ticks or unticks a task card. */
export function tickCard(text: string, card: Card, done: boolean): Edit | null {
  if (card.done === null || card.done === done) return null;
  const lines = text.split('\n');
  const m = TASK.exec(lines[card.start]!.replace(/\r$/, ''));
  if (!m) return null;
  let from = 0;
  for (let i = 0; i < card.start; i++) from += lines[i]!.length + 1;
  from += m[1]!.length;
  return { from, to: from + 1, insert: done ? 'x' : ' ' };
}

/**
 * The same card in a board read again: same column title, text and state, the nearest to
 * where it was. Null when it is gone.
 */
export function findCard(
  board: Board,
  columnTitle: string,
  card: Card,
): { column: number; card: Card } | null {
  let best: { column: number; card: Card; d: number } | null = null;
  for (const [k, col] of board.columns.entries()) {
    if (col.title !== columnTitle) continue;
    for (const c of col.cards) {
      if (c.raw !== card.raw || c.done !== card.done) continue;
      const d = Math.abs(c.start - card.start);
      if (!best || d < best.d) best = { column: k, card: c, d };
    }
  }
  return best && { column: best.column, card: best.card };
}
