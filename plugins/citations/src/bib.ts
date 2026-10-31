/**
 * Reference libraries (SPECS 13.5): BibTeX or BibLaTeX (`.bib`, as Better BibTeX exports
 * it) and CSL-JSON (`.json`), both read into CSL-JSON items, which citeproc formats.
 */
import type { Creator, Entry } from '@retorquere/bibtex-parser';

export interface CslName {
  family?: string;
  given?: string;
  'non-dropping-particle'?: string;
  suffix?: string;
  literal?: string;
}
export interface CslDate {
  'date-parts'?: number[][];
  literal?: string;
}
export interface CslItem {
  id: string;
  type: string;
  title?: string;
  author?: CslName[];
  editor?: CslName[];
  translator?: CslName[];
  'container-title'?: string;
  'collection-title'?: string;
  publisher?: string;
  'publisher-place'?: string;
  issued?: CslDate;
  accessed?: CslDate;
  volume?: string;
  issue?: string;
  number?: string;
  page?: string;
  edition?: string;
  'chapter-number'?: string;
  genre?: string;
  note?: string;
  DOI?: string;
  URL?: string;
  ISBN?: string;
  ISSN?: string;
  [field: string]: unknown;
}

const TYPES: Record<string, string> = {
  article: 'article-journal',
  book: 'book',
  mvbook: 'book',
  booklet: 'pamphlet',
  inbook: 'chapter',
  incollection: 'chapter',
  inproceedings: 'paper-conference',
  conference: 'paper-conference',
  proceedings: 'book',
  collection: 'book',
  phdthesis: 'thesis',
  mastersthesis: 'thesis',
  thesis: 'thesis',
  techreport: 'report',
  report: 'report',
  manual: 'report',
  patent: 'patent',
  online: 'webpage',
  electronic: 'webpage',
  www: 'webpage',
  unpublished: 'manuscript',
  dataset: 'dataset',
  software: 'software',
  misc: 'article',
};
const GENRES: Record<string, string> = { phdthesis: 'PhD thesis', mastersthesis: "Master's thesis" };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function name(c: Creator): CslName {
  if (c.name) return { literal: c.name };
  const n: CslName = {};
  if (c.lastName) n.family = c.lastName;
  if (c.firstName) n.given = c.firstName;
  if (c.prefix) n['non-dropping-particle'] = c.prefix;
  if (c.suffix) n.suffix = c.suffix;
  return n;
}

/** "2013", "2013-05", "2013-05-04", or a range "2013-05/2014" (its start). */
export function date(value: string | undefined): CslDate | undefined {
  if (!value) return undefined;
  const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/.exec(value.trim());
  if (!m) return { literal: value.trim() };
  return { 'date-parts': [[m[1], m[2], m[3]].filter(Boolean).map(Number)] };
}

function monthNumber(m: string | undefined): number | undefined {
  if (!m) return undefined;
  const t = m.trim().toLowerCase();
  if (/^\d{1,2}$/.test(t)) return Number(t);
  const i = MONTHS.indexOf(t.slice(0, 3));
  return i >= 0 ? i + 1 : undefined;
}

/** One BibTeX entry as a CSL-JSON item. */
export function fromBibtex(e: Entry): CslItem {
  const f = e.fields as Record<string, unknown>;
  const str = (k: string) => {
    const v = f[k];
    if (typeof v === 'string') return v.trim() || undefined;
    if (Array.isArray(v) && v.every((x) => typeof x === 'string'))
      return (v as string[]).join('; ') || undefined;
    return undefined;
  };
  const type = e.type.toLowerCase();
  const item: CslItem = { id: e.key, type: TYPES[type] ?? 'article' };
  const set = (k: string, v: unknown) => {
    if (v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) item[k] = v;
  };
  for (const role of ['author', 'editor', 'translator'] as const) {
    const list = f[role];
    if (Array.isArray(list) && list.length && typeof list[0] === 'object')
      set(role, (list as Creator[]).map(name));
  }
  set('title', str('title'));
  const container =
    item.type === 'article-journal'
      ? (str('journaltitle') ?? str('journal'))
      : (str('booktitle') ?? str('journaltitle'));
  set('container-title', container);
  // ABNT names the event of a conference paper (Zotero's "Conference Name", exported as
  // eventtitle). Without one, the proceedings' name stands in for it (format.ts keeps ABNT
  // from printing it twice).
  if (item.type === 'paper-conference') {
    const event = str('eventtitle') ?? container;
    set('event-title', event);
    set('event', event);
    set('event-place', str('venue'));
  }
  set('collection-title', str('series'));
  const institution = str('school') ?? str('institution') ?? str('organization');
  set('publisher', str('publisher') ?? (['thesis', 'report'].includes(item.type) ? institution : undefined));
  set('publisher-place', str('location') ?? str('address'));
  let issued = date(str('date'));
  const year = str('year');
  if (!issued && year) {
    const parts = [Number(year.slice(0, 4))];
    const mo = monthNumber(str('month'));
    if (mo) parts.push(mo);
    issued = Number.isFinite(parts[0]) ? { 'date-parts': [parts] } : { literal: year };
  }
  set('issued', issued);
  set('accessed', date(str('urldate')));
  set('volume', str('volume'));
  if (item.type === 'report' || item.type === 'patent') set('number', str('number'));
  else set('issue', str('number') ?? str('issue'));
  set('page', str('pages')?.replace(/-{1,2}/g, '–'));
  set('edition', str('edition'));
  set('chapter-number', str('chapter'));
  set('genre', str('type') ?? GENRES[type]);
  set('note', str('note') ?? str('howpublished'));
  set('DOI', str('doi'));
  set('URL', str('url'));
  set('ISBN', str('isbn'));
  set('ISSN', str('issn'));
  return item;
}

/** CSL-JSON as exported by Zotero or Better BibTeX: an array of items, or { items }. */
export function fromCslJson(text: string): CslItem[] {
  const data: unknown = JSON.parse(text);
  const list = Array.isArray(data) ? data : (data as { items?: unknown }).items;
  if (!Array.isArray(list)) throw new Error('A CSL-JSON file holds an array of items.');
  return list.filter(
    (x): x is CslItem => !!x && typeof x === 'object' && typeof (x as CslItem).id === 'string',
  );
}

export interface Parsed {
  items: CslItem[];
  /** Problems the parser reported, for the log; the rest of the file still loads. */
  errors: string[];
}

/** Parses a library file by its extension. BibTeX parsing is loaded on first use. */
export async function parseLibrary(path: string, text: string): Promise<Parsed> {
  if (/\.json$/i.test(path)) return { items: fromCslJson(text), errors: [] };
  const { parseAsync } = await import('@retorquere/bibtex-parser');
  // Titles are sentence-cased (as Zotero stores them); the names of journals, proceedings
  // and series are kept as written, proper nouns included.
  const keep = ['booktitle', 'journaltitle', 'journal', 'series', 'eventtitle', 'maintitle'];
  const lib = await parseAsync(text, {
    unsupported: 'ignore',
    applyCrossRef: true,
    fieldMode: Object.fromEntries(keep.map((k) => [k, 'richtext'])),
  });
  return {
    items: lib.entries.map(fromBibtex),
    errors: lib.errors.map((e) => (e as { error?: string }).error ?? String(e)),
  };
}
