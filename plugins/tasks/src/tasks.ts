/**
 * Task lines (SPECS 13.7): GFM task items in any note, with an optional `due:YYYY-MM-DD`.
 * Pure functions, shared by the extractor, the list and the unit tests.
 */
import { splitDue } from '@ephemeris-plugins/inline';

/**
 * One task item per line, for the index extractor (compiled with `gm`): group 1 is the
 * checkbox character, group 2 the text after it. Bullets `-`, `*`, `+` and ordered `1.`, `1)`.
 */
export const TASK_LINE = String.raw`^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\](?:[ \t]+(.*))?$`;

/**
 * A due date on a task line, for the inline chip (matched line by line, so `^` is the line
 * start). The lookbehind keeps it to task items: `due:` elsewhere in a note stays text.
 */
export const DUE_INLINE =
  /(?<=^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX]\][ \t].*?)(?<=^|\s)due:(\d{4}-\d{2}-\d{2})(?=\s|$)/g;

const TAG = /(?:^|\s)#([\p{L}\p{N}_/-]+)/gu;

export interface Task {
  path: string;
  /** 1-based, as index records. */
  line: number;
  done: boolean;
  /** The text after the checkbox, as written. */
  raw: string;
  /** Without its `due:` field. */
  text: string;
  /** YYYY-MM-DD, or null. */
  due: string | null;
  /** Without `#`, lower case. */
  tags: string[];
}

export function parseTask(path: string, line: number, key: string, value: string | null): Task | null {
  const raw = (value ?? '').replace(/\r$/, '').trim();
  if (!raw) return null;
  const { text, due } = splitDue(raw);
  const tags = [...raw.matchAll(TAG)].map((t) => t[1]!.toLowerCase()).filter((t) => !/^\d+$/.test(t));
  return { path, line, done: key !== ' ', raw, text, due, tags };
}

// ---- Ticking ---------------------------------------------------------------------------

const ITEM = /^([ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])(\])(?:[ \t]+(.*))?$/;

/**
 * The edit that ticks (or unticks) a task in the note's current text. The task is found
 * at its indexed line, or, when lines moved, at the nearest line with the same text and
 * state. Null when it is gone or already in the wanted state.
 */
export function toggleEdit(
  text: string,
  task: Pick<Task, 'line' | 'raw' | 'done'>,
  done: boolean,
): { from: number; to: number; insert: string } | null {
  const lines = text.split('\n');
  const starts: number[] = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length + 1;
  }
  const matches = (i: number) => {
    const m = ITEM.exec(lines[i]!.replace(/\r$/, ''));
    return m && (m[4] ?? '').trim() === task.raw && (m[2] !== ' ') === task.done ? m : null;
  };
  let index = task.line - 1;
  if (index < 0 || index >= lines.length || !matches(index)) {
    index = -1;
    let best = Infinity;
    for (let i = 0; i < lines.length; i++) {
      if (!matches(i)) continue;
      const distance = Math.abs(i - (task.line - 1));
      if (distance < best) [best, index] = [distance, i];
    }
    if (index === -1) return null;
  }
  if (task.done === done) return null;
  const m = matches(index)!;
  const from = starts[index]! + m[1]!.length;
  return { from, to: from + 1, insert: done ? 'x' : ' ' };
}
