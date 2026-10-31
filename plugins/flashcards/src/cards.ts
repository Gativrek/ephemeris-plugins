/**
 * Cards in a note (SPECS 13.6): in notes with `flashcards: true`, a line `front :: back`
 * (spaces around `::` required) is one card, and a line with `{{hidden text}}` is one card
 * per cloze. A card's identity is a block ID ` ^fc-xxxxxx` at the end of its line, added
 * on its first review, so later edits to its text keep its history.
 */

export interface CardDef {
  /** The state key: the block ID, `#n` for the n-th cloze; for a card without an ID yet, a provisional key. */
  key: string;
  /** The line's block ID, or null before its first review. */
  id: string | null;
  kind: 'basic' | 'cloze';
  /** 1-based cloze number (cloze cards). */
  cloze?: number;
  /** Markdown for the question and the answer. */
  front: string;
  back: string;
  /** 1-based line in the note, and the line's text as written (for adding the ID). */
  line: number;
  source: string;
  /** The nearest heading above the card, or "" before any heading. */
  section: string;
  /** The note it is in. */
  path: string;
}

const ID_AT_END = /\s\^(fc-[a-z0-9]{6})\s*$/;
const CLOZE = /\{\{([^{}\n]+?)\}\}/g;
const BASIC = /^(.*?\S)[ \t]+::[ \t]+(\S.*)$/;
const LIST_MARK = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;

/** The index pattern that finds card lines across the Vault (multiline, per line). */
export const CARD_LINE = String.raw`^(?=[^\n]*(?:[ \t]::[ \t]|\{\{[^{}\n]+\}\}))([^\n]+)$`;

/** True when the note's frontmatter opts in (`flashcards: true`). */
export const optedIn = (frontmatter: Readonly<Record<string, unknown>>) => frontmatter['flashcards'] === true;

/** The text of a cloze card: its own cloze as `[…]` (or revealed), the others shown. */
export function clozeText(line: string, n: number, reveal: boolean): string {
  let i = 0;
  return line.replace(CLOZE, (_m, hidden: string) => {
    i++;
    if (i !== n) return hidden;
    // Escaped, so Markdown does not read the brackets as a link.
    return reveal ? `**${hidden}**` : String.raw`\[…\]`;
  });
}

/** Every card in a note's text, skipping frontmatter, fenced code and display math. */
export function parseCards(text: string, path: string): CardDef[] {
  const lines = text.split('\n');
  const out: CardDef[] = [];
  let section = '';
  let fence: string | null = null;
  let math = false;
  let i = 0;
  // Frontmatter.
  if (lines[0] === '---') {
    const end = lines.findIndex((l, k) => k > 0 && (l === '---' || l === '...'));
    if (end > 0) i = end + 1;
  }
  for (; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    const f = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fence) {
      if (f && trimmed.startsWith(fence)) fence = null;
      continue;
    }
    if (f) {
      fence = f[1]!;
      continue;
    }
    if (trimmed.startsWith('$$')) {
      if (!(trimmed.length > 2 && trimmed.endsWith('$$'))) math = !math;
      continue;
    }
    if (math) continue;
    const h = /^#{1,6}\s+(.*?)\s*#*$/.exec(trimmed);
    if (h) {
      section = h[1]!;
      continue;
    }
    const idMatch = ID_AT_END.exec(raw);
    const id = idMatch ? idMatch[1]! : null;
    const body = (idMatch ? raw.slice(0, idMatch.index) : raw).replace(LIST_MARK, '').trim();
    const line = i + 1;
    const base = id ?? `new:${path}:${line}`;
    const clozes = [...body.matchAll(CLOZE)];
    if (clozes.length) {
      clozes.forEach((_c, k) =>
        out.push({
          key: `${base}#${k + 1}`,
          id,
          kind: 'cloze',
          cloze: k + 1,
          front: clozeText(body, k + 1, false),
          back: clozeText(body, k + 1, true),
          line,
          source: raw,
          section,
          path,
        }),
      );
      continue;
    }
    const b = BASIC.exec(body);
    if (b)
      out.push({ key: base, id, kind: 'basic', front: b[1]!, back: b[2]!, line, source: raw, section, path });
  }
  return out;
}

/** A new block ID, not in `taken`. */
export function newId(taken: Set<string>, random: () => number = Math.random): string {
  for (;;) {
    let s = '';
    for (let k = 0; k < 6; k++) s += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(random() * 36)];
    const id = `fc-${s}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * The edit that gives a card line its ID: ` ^fc-xxxxxx` at the end of the line. Finds the
 * line by number, or by its text when lines moved; null when the line is gone or already has one.
 */
export function idEdit(
  text: string,
  card: Pick<CardDef, 'line' | 'source'>,
  id: string,
): { from: number; to: number; insert: string } | null {
  const lines = text.split('\n');
  let index = card.line - 1;
  if (lines[index] !== card.source) index = lines.indexOf(card.source);
  if (index < 0 || ID_AT_END.test(lines[index]!)) return null;
  let end = 0;
  for (let k = 0; k < index; k++) end += lines[k]!.length + 1;
  const line = lines[index]!;
  const at = end + line.replace(/\s+$/, '').length;
  return { from: at, to: at, insert: ` ^${id}` };
}

/** The card after its line has an ID: the provisional key becomes the ID's. */
export function withId(card: CardDef, id: string): CardDef {
  return { ...card, id, key: card.kind === 'cloze' ? `${id}#${card.cloze}` : id };
}
