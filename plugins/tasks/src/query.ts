/**
 * The ```tasks query (SPECS 13.7): one `key: value` per line, all optional. Parsing never
 * fails: an unknown key or value becomes a message and the rest still applies.
 */
import { addDays } from '@ephemeris-plugins/inline';
import type { Task } from './tasks';

export type Scope = 'vault' | 'domain' | 'all';
export type Status = 'open' | 'done' | 'all';
export type DueFilter =
  { kind: 'any' | 'overdue' | 'today' | 'week' | 'none' } | { kind: 'before' | 'after'; date: string };

export interface TaskQuery {
  scope: Scope;
  status: Status;
  due: DueFilter;
  /** Lower case, without `#`. */
  tag: string | null;
  /** A folder prefix, without a trailing slash. */
  path: string | null;
  sort: 'due' | 'note';
  group: 'note' | 'none';
  limit: number;
}

export const DEFAULT_QUERY: TaskQuery = {
  scope: 'vault',
  status: 'open',
  due: { kind: 'any' },
  tag: null,
  path: null,
  sort: 'due',
  group: 'none',
  limit: 200,
};

const KEYS = 'scope, status, due, tag, path, sort, group, limit';

export function parseQuery(source: string): { query: TaskQuery; problems: string[] } {
  const query: TaskQuery = { ...DEFAULT_QUERY };
  const problems: string[] = [];
  for (const [n, rawLine] of source.split('\n').entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^([a-z]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) {
      problems.push(`Line ${n + 1}: write "key: value" (keys: ${KEYS}).`);
      continue;
    }
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    const bad = (expected: string) => problems.push(`${key}: "${value}" is not one of ${expected}.`);
    switch (key) {
      case 'scope':
        if (value === 'vault' || value === 'domain' || value === 'all') query.scope = value;
        else bad('vault, domain, all');
        break;
      case 'status':
        if (value === 'open' || value === 'done' || value === 'all') query.status = value;
        else bad('open, done, all');
        break;
      case 'due': {
        const d = parseDue(value);
        if (d) query.due = d;
        else bad('overdue, today, week, none, any, before YYYY-MM-DD, after YYYY-MM-DD');
        break;
      }
      case 'tag':
        if (/^#?[\p{L}\p{N}_/-]+$/u.test(value)) query.tag = value.replace(/^#/, '').toLowerCase();
        else bad('a tag such as #work');
        break;
      case 'path':
        if (value && !value.includes('..')) query.path = value.replace(/^\/+|\/+$/g, '');
        else bad('a folder such as Projects/');
        break;
      case 'sort':
        if (value === 'due' || value === 'note') query.sort = value;
        else bad('due, note');
        break;
      case 'group':
        if (value === 'note' || value === 'none') query.group = value;
        else bad('note, none');
        break;
      case 'limit': {
        const n = Number(value);
        if (Number.isInteger(n) && n >= 1 && n <= 10_000) query.limit = n;
        else bad('a whole number from 1 to 10000');
        break;
      }
      default:
        problems.push(`Unknown key "${key}" (keys: ${KEYS}).`);
    }
  }
  return { query, problems };
}

function parseDue(value: string): DueFilter | null {
  if (['any', 'overdue', 'today', 'week', 'none'].includes(value))
    return { kind: value as 'any' | 'overdue' | 'today' | 'week' | 'none' };
  const m = /^(before|after)\s+(\d{4}-\d{2}-\d{2})$/.exec(value);
  return m ? { kind: m[1] as 'before' | 'after', date: m[2]! } : null;
}

/** The tasks a query keeps, sorted. Scope and status are applied by the index query. */
export function applyQuery(tasks: Task[], q: TaskQuery, today: string): Task[] {
  const week = addDays(today, 6);
  const keep = tasks.filter((t) => {
    if (q.status === 'open' && t.done) return false;
    if (q.status === 'done' && !t.done) return false;
    if (q.tag && !t.tags.some((tag) => tag === q.tag || tag.startsWith(`${q.tag}/`))) return false;
    if (q.path && !relativeTo(t.path, q.path)) return false;
    const due = t.due;
    switch (q.due.kind) {
      case 'any':
        return true;
      case 'none':
        return due === null;
      case 'overdue':
        return due !== null && due < today;
      case 'today':
        return due === today;
      case 'week':
        return due !== null && due >= today && due <= week;
      case 'before':
        return due !== null && due < q.due.date;
      case 'after':
        return due !== null && due > q.due.date;
    }
  });
  const byNote = (a: Task, b: Task) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line);
  if (q.sort === 'note') return keep.sort(byNote);
  // Dated first, earliest first; then undated, by note.
  return keep.sort((a, b) => {
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
    if (!a.due !== !b.due) return a.due ? -1 : 1;
    return byNote(a, b);
  });
}

/**
 * Whether a note is under a `path:` folder. The folder may be written from the library
 * root ("Work/Acme/Specs") or from anywhere below the Vault ("Specs" or "Acme/Specs").
 */
function relativeTo(notePath: string, folder: string): boolean {
  const lower = notePath.toLowerCase();
  const f = folder.toLowerCase();
  return lower.startsWith(`${f}/`) || lower.includes(`/${f}/`);
}
