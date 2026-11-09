/**
 * Spoken words in a narration script (SPECS 13.9). Counted: paragraphs and list items,
 * links by their visible text. Not counted: headings, frontmatter, code blocks, math,
 * tables, images and embeds, comments, tags, and block quotes (directions). Pure functions.
 */

export interface Heading {
  level: number;
  /** 1-based. */
  line: number;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DELIMITER_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;
const ATX = /^ {0,3}#{1,6}(\s|$)/;
const SETEXT = /^ {0,3}(=+|-+)\s*$/;

/** Replaces every character but newlines, so line numbers stay put. */
const blank = (s: string) => s.replace(/[^\n]/g, ' ');

/** Words per line (index 0 is line 1). */
export function wordsPerLine(text: string, headingLines: ReadonlySet<number> = new Set()): number[] {
  // Comments can span lines: blank them first.
  const src = text.replace(/\r/g, '').replace(/%%[\s\S]*?(?:%%|$)|<!--[\s\S]*?(?:-->|$)/g, blank);
  const lines = src.split('\n');
  const counts = new Array<number>(lines.length).fill(0);
  let i = 0;
  // Frontmatter.
  if (lines[0] === '---') {
    const close = lines.findIndex((l, k) => k > 0 && (l === '---' || l === '...'));
    if (close !== -1) i = close + 1;
  }
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      // Skip to the closing fence (same character, at least as long), or the end.
      const mark = fence[1]!;
      const close = new RegExp(`^ {0,3}${mark[0] === '`' ? '`' : '~'}{${mark.length},}\\s*$`);
      while (i + 1 < lines.length && !close.test(lines[i + 1]!)) i++;
      i++;
      continue;
    }
    if (/^\s*\$\$/.test(line)) {
      // Display math, to the line that closes it (this one, when it closes here).
      if (!line.trim().slice(2).includes('$$')) {
        while (i + 1 < lines.length && !lines[i + 1]!.includes('$$')) i++;
        i++;
      }
      continue;
    }
    if (DELIMITER_ROW.test(lines[i + 1] ?? '') && line.includes('|')) {
      // A table: its header, delimiter and rows.
      i++;
      while (i + 1 < lines.length && lines[i + 1]!.includes('|') && lines[i + 1]!.trim() !== '') i++;
      continue;
    }
    if (headingLines.has(i + 1) || ATX.test(line)) continue;
    // A setext underline under a heading line.
    if (SETEXT.test(line) && headingLines.has(i)) continue;
    if (/^ {0,3}>/.test(line)) continue;
    counts[i] = countWords(line);
  }
  return counts;
}

/** Spoken words in one line of prose. */
export function countWords(line: string): number {
  const spoken = line
    // Images and embeds.
    .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, ' ')
    // Links by their visible text.
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_m, target: string, alias?: string) => alias ?? target.replace(/#\^?/g, ' '),
    )
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Inline math: an opening $ not followed by a space, a closing one not preceded by one.
    .replace(/\$(?=\S)[^$\n]*?\S\$(?!\d)|\$\S\$/g, ' ')
    // Tags and block IDs.
    .replace(/(^|\s)#[\p{L}\p{N}_/-]+/gu, '$1')
    .replace(/\s\^[\w-]+\s*$/, '')
    // List markers and task boxes.
    .replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/, '');
  let n = 0;
  for (const token of spoken.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(token)) n++;
  return n;
}

/**
 * Each heading's words: everything under it until the next heading of the same or a
 * higher level (a chapter includes its sections).
 */
export function sectionWords(perLine: number[], headings: readonly Heading[]): number[] {
  const sorted = headings.map((h, k) => ({ ...h, k })).sort((a, b) => a.line - b.line);
  const prefix = [0];
  for (const n of perLine) prefix.push(prefix.at(-1)! + n);
  const out = new Array<number>(headings.length).fill(0);
  for (const [j, h] of sorted.entries()) {
    const next = sorted.slice(j + 1).find((o) => o.level <= h.level);
    const endLine = next ? next.line - 1 : perLine.length;
    out[h.k] = prefix[Math.min(endLine, perLine.length)]! - prefix[Math.min(h.line, perLine.length)]!;
  }
  return out;
}

/** m:ss, or h:mm:ss past an hour, rounded to the second. */
export function formatDuration(words: number, wpm: number): string {
  const total = Math.round((words / wpm) * 60);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
