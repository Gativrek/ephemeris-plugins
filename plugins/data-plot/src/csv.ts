/**
 * CSV for Data Plot (SPECS 13.4): RFC 4180 quoting, `,` `;` or tab detected from the
 * first line (or given), `.` or `,` decimals (a comma is detected when the delimiter is
 * not one), and a header row unless the first row is all numbers, as from MATLAB's
 * `writematrix`, or as a comment right above the numbers, as from NumPy's `savetxt`. Empty
 * cells are gaps, and lines starting with `#` are comments.
 */

export type Delimiter = ',' | ';' | '\t';

export interface Table {
  /** Column names; `column 1`, `column 2` … when the file has no header row. */
  names: string[];
  hasHeader: boolean;
  /** Data rows (the header excluded), as text. */
  rows: string[][];
  /** 1-based line of each data row, for error messages. */
  lines: number[];
  delimiter: Delimiter;
  decimal: '.' | ',';
}

export class CsvError extends Error {}

const BOM = String.fromCharCode(0xfeff);

interface Rec {
  fields: string[];
  line: number;
}

/**
 * Splits text into records, honouring quotes (which may hold delimiters and newlines).
 * A line starting with `#` is a comment: left out of the records, its text after the `#`
 * kept in `comments`.
 */
function records(
  text: string,
  delimiter: string,
): { recs: Rec[]; comments: Array<{ text: string; line: number }> } {
  const out: Rec[] = [];
  const comments: Array<{ text: string; line: number }> = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  const endRecord = () => {
    fields.push(field);
    if (fields.length > 1 || fields[0]!.trim() !== '') out.push({ fields, line: start });
    fields = [];
    field = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (c === '\n') line++;
        field += c;
      }
    } else if (c === '#' && !fields.length && field.trim() === '') {
      let end = text.indexOf('\n', i);
      if (end < 0) end = text.length;
      comments.push({ text: text.slice(i + 1, end).replace(/\r$/, ''), line });
      field = '';
      i = end - 1;
    } else if (c === '"' && field.trim() === '') {
      quoted = true;
      field = '';
    } else if (c === delimiter) {
      fields.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      start = line;
    } else field += c;
  }
  if (field !== '' || fields.length) endRecord();
  return { recs: out, comments };
}

const COMMENT_LINE = /^[ \t]*#/;

/** The delimiter used most on the first non-empty line that is not a comment, outside quotes; `,` by default. */
export function detectDelimiter(text: string): Delimiter {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '' && !COMMENT_LINE.test(l)) ?? '';
  const counts: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const c of first) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && c in counts) counts[c as Delimiter]++;
  }
  const best = (['\t', ';', ','] as Delimiter[]).reduce((a, b) => (counts[b] > counts[a] ? b : a), ',');
  return counts[best] > 0 ? best : ',';
}

const NUMBER_DOT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const NUMBER_COMMA = /^[+-]?(\d+,?\d*|,\d+)([eE][+-]?\d+)?$/;
const SPECIAL = /^[+-]?(inf|infinity|nan)$/i;

/** A cell as a number: NaN for an empty cell or NaN/Inf text, null when it is not a number. */
export function parseNumber(cell: string, decimal: '.' | ','): number | null {
  const s = cell.trim();
  if (s === '') return NaN;
  if (SPECIAL.test(s)) return /nan/i.test(s) ? NaN : s.startsWith('-') ? -Infinity : Infinity;
  if (decimal === ',') return NUMBER_COMMA.test(s) ? Number(s.replace(',', '.')) : null;
  return NUMBER_DOT.test(s) ? Number(s) : null;
}

export function parseCsv(text: string, opts: { delimiter?: Delimiter; decimal?: '.' | ',' } = {}): Table {
  const clean = text.startsWith(BOM) ? text.slice(1) : text;
  const delimiter = opts.delimiter ?? detectDelimiter(clean);
  const { recs, comments } = records(clean, delimiter);
  if (!recs.length) throw new CsvError('The data is empty.');
  // A comma decimal shows as "1,5" cells when the delimiter is not a comma.
  const decimal =
    opts.decimal ??
    (delimiter !== ',' && recs.slice(0, 50).some((r) => r.fields.some((f) => /^\s*[+-]?\d+,\d+/.test(f)))
      ? ','
      : '.');
  const isNumber = (f: string) => parseNumber(f, decimal) !== null && f.trim() !== '';
  const first = recs[0]!.fields;
  const width = Math.max(...recs.map((r) => r.fields.length));
  let header: string[] | null = first.every(isNumber) ? null : first;
  if (!header) {
    // NumPy's savetxt writes the header as a comment ("# t,roll,pitch") right above the
    // numbers: it names the columns when it has one name per column.
    const above = comments.find((c) => c.line === recs[0]!.line - 1);
    const names = above && records(above.text, delimiter).recs[0]?.fields;
    if (names && names.length === width && names.every((n) => n.trim() !== '' && !isNumber(n)))
      header = names;
  }
  const hasHeader = header !== null;
  // Unnamed columns read as "column 2" on the axes; `y: 2` still picks them by number.
  const names = Array.from({ length: width }, (_, i) => header?.[i]?.trim() || `column ${i + 1}`);
  const data = header === first ? recs.slice(1) : recs;
  return {
    names,
    hasHeader,
    rows: data.map((r) => r.fields),
    lines: data.map((r) => r.line),
    delimiter,
    decimal,
  };
}

/** A column by name or 1-based index, as numbers. Errors name the column and the line. */
export function column(table: Table, ref: string): { name: string; values: number[] } {
  let i = table.names.findIndex((n) => n === ref);
  if (i < 0) i = table.names.findIndex((n) => n.toLowerCase() === ref.toLowerCase());
  if (i < 0 && /^\d+$/.test(ref)) i = Number(ref) - 1;
  if (i < 0 || i >= table.names.length) {
    const list = table.hasHeader ? table.names.map((n) => `"${n}"`).join(', ') : `1 to ${table.names.length}`;
    throw new CsvError(`No column "${ref}". The columns are ${list}.`);
  }
  const values = table.rows.map((r, k) => {
    const v = parseNumber(r[i] ?? '', table.decimal);
    if (v === null)
      throw new CsvError(
        `Column "${table.names[i]}" is not numeric: "${r[i]!.trim()}" on line ${table.lines[k]}.`,
      );
    return v;
  });
  return { name: table.names[i]!, values };
}
