/** Due dates (`due:YYYY-MM-DD`, SPECS 13.7) in local time, for Tasks and Kanban. */

const DUE = /(^|\s)due:(\d{4}-\d{2}-\d{2})(?=\s|$)/;

/** A real calendar date in YYYY-MM-DD. */
export function isDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** The text without its `due:` field, and the date; a field that is not a real date stays text. */
export function splitDue(raw: string): { text: string; due: string | null } {
  const m = DUE.exec(raw);
  if (!m || !isDate(m[2]!)) return { text: raw, due: null };
  const text = (raw.slice(0, m.index) + m[1] + raw.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
  return { text, due: m[2]! };
}

export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return localDate(new Date(y, m - 1, d + days));
}

export type DueState = 'overdue' | 'today' | 'later';

export function dueState(due: string, today: string): DueState {
  return due < today ? 'overdue' : due === today ? 'today' : 'later';
}

/** "10 Nov", or "10 Nov 2027" outside this year, in the system's language. */
export function formatDue(due: string, today: string, locale?: string): string {
  const [y, m, d] = due.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  const sameYear = due.slice(0, 4) === today.slice(0, 4);
  return date.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
