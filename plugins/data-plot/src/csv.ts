/**
 * CSV for Data Plot (SPECS 13.4): RFC 4180 quoting, `,` `;` or tab detected from the
 * first line (or given), `.` or `,` decimals (a comma is detected when the delimiter is
 * not one), and a header row unless the first row is all numbers, as from MATLAB's
 * `writematrix`. Empty cells are gaps.
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

/** Splits text into records, honouring quotes (which may hold delimiters and newlines). */
function records(text: string, delimiter: string): Array<{ fields: string[]; line: number }> {
  const out: Array<{ fields: string[]; line: number }> = [];
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
  return out;
}

/** The delimiter used most on the first non-empty line, outside quotes; `,` by default. */
export function detectDelimiter(text: string): Delimiter {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
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
  const recs = records(clean, delimiter);
  if (!recs.length) throw new CsvError('The data is empty.');
  // A comma decimal shows as "1,5" cells when the delimiter is not a comma.
  const decimal =
    opts.decimal ??
    (delimiter !== ',' && recs.slice(0, 50).some((r) => r.fields.some((f) => /^\s*[+-]?\d+,\d+/.test(f)))
      ? ','
      : '.');
  const first = recs[0]!.fields;
  const hasHeader = !first.every((f) => {
    const n = parseNumber(f, decimal);
    return n !== null && f.trim() !== '';
  });
  const width = Math.max(...recs.map((r) => r.fields.length));
  // Unnamed columns read as "column 2" on the axes; `y: 2` still picks them by number.
  const names = Array.from({ length: width }, (_, i) => (hasHeader && first[i]?.trim()) || `column ${i + 1}`);
  const data = hasHeader ? recs.slice(1) : recs;
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
