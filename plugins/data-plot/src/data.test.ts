import { describe, expect, it } from 'vitest';
import { BlockError, parseBlock, parseList, resolveFile } from './block';
import { column, CsvError, detectDelimiter, parseCsv, parseNumber } from './csv';
import { lttb, thin } from './lttb';
import { prepare, stepPoints } from './view';

describe('CSV', () => {
  it('reads a header, numbers and gaps', () => {
    const t = parseCsv('t,roll,pitch\n0,1.5,2\n1,,3e-1\n2,-0.25,4\n');
    expect(t.names).toEqual(['t', 'roll', 'pitch']);
    expect(t.hasHeader).toBe(true);
    expect(column(t, 'roll').values).toEqual([1.5, NaN, -0.25]);
    expect(column(t, 'PITCH').values).toEqual([2, 0.3, 4]);
    expect(column(t, '1').values).toEqual([0, 1, 2]);
  });

  it('detects semicolons and tabs, and decimal commas with them', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectDelimiter('"a;b",c\n1,2')).toBe(',');
    const t = parseCsv('tempo;valor\n0;1,5\n1;2,25\n');
    expect(t.decimal).toBe(',');
    expect(column(t, 'valor').values).toEqual([1.5, 2.25]);
  });

  it('has no header when the first row is all numbers (writematrix)', () => {
    const t = parseCsv('0,1\n1,2\n2,4\n');
    expect(t.hasHeader).toBe(false);
    expect(t.names).toEqual(['column 1', 'column 2']);
    expect(column(t, '2').values).toEqual([1, 2, 4]);
  });

  it('honours quotes, CRLF and a BOM', () => {
    const t = parseCsv(String.fromCharCode(0xfeff) + '"name, unit",v\r\n"a ""b""",1\r\n');
    expect(t.names).toEqual(['name, unit', 'v']);
    expect(t.rows[0]).toEqual(['a "b"', '1']);
  });

  it('reads Inf and NaN, and names the line of a bad cell', () => {
    expect(parseNumber('Inf', '.')).toBe(Infinity);
    expect(parseNumber('-inf', '.')).toBe(-Infinity);
    expect(parseNumber('NaN', '.')).toBeNaN();
    expect(parseNumber('1,5', '.')).toBeNull();
    const t = parseCsv('t,v\n0,1\n1,oops\n');
    expect(() => column(t, 'v')).toThrow(new CsvError('Column "v" is not numeric: "oops" on line 3.'));
    expect(() => column(t, 'w')).toThrow('No column "w". The columns are "t", "v".');
  });
});

describe('the block', () => {
  it('reads options and inline rows', () => {
    const b = parseBlock(
      'x: t\ny: [roll, "a, b"]\nkind: step\nlogy: true\ngrid: off\n# note\n---\nt,roll\n0,1',
    );
    expect(b).toMatchObject({ x: 't', y: ['roll', 'a, b'], kind: 'step', logy: true, grid: false });
    expect(b.inline).toBe('t,roll\n0,1');
    expect(parseBlock('file: data/run.csv\ny: v').file).toBe('data/run.csv');
    expect(parseBlock('file: a.csv\ndelimiter: tab\ndecimal: ","').delimiter).toBe('\t');
  });

  it('lists columns with or without brackets', () => {
    expect(parseList('[a, b]')).toEqual(['a', 'b']);
    expect(parseList('a')).toEqual(['a']);
    expect(parseList("'x, y', z")).toEqual(['x, y', 'z']);
  });

  it.each([
    ['', 'No data'],
    ['file: a.csv\n---\n1,2', 'not both'],
    ['colour: red\nfile: a.csv', 'Line 1: unknown option "colour"'],
    ['file: a.csv\nkind: bar', 'Line 2: kind must be line, scatter or step'],
    ['file: a.csv\nlogx: maybe', 'Line 2: logx must be true or false'],
    ['file: a.csv\nx: t\nx: u', 'Line 3: x is set twice'],
    ['just text', 'Line 1: expected "option: value"'],
    ['file: a.csv\ny: [a,b,c,d,e,f,g]', 'At most 6'],
  ])('refuses %j', (src, message) => {
    expect(() => parseBlock(src)).toThrow(BlockError);
    expect(() => parseBlock(src)).toThrow(message);
  });

  it('resolves files from the note folder or the Vault root, never outside the Vault', () => {
    const note = 'Academic/GNSS/Notes/Run.md';
    expect(resolveFile('data/run3.csv', note, 'Academic/GNSS')).toBe('Academic/GNSS/Notes/data/run3.csv');
    expect(resolveFile('../data/run3.csv', note, 'Academic/GNSS')).toBe('Academic/GNSS/data/run3.csv');
    expect(resolveFile('/data/run3.csv', note, 'Academic/GNSS')).toBe('Academic/GNSS/data/run3.csv');
    expect(resolveFile('../../../x.csv', note, 'Academic/GNSS')).toBeNull();
  });
});

describe('preparing the data', () => {
  const table = parseCsv('f,a,b\n0,1,-1\n1,2,3\n10,0,4\n');

  it('plots every other column by default, and the given ones otherwise', () => {
    const d = prepare(parseBlock('---\nx'), table);
    expect(d.xName).toBe('f');
    expect(d.series.map((s) => s.name)).toEqual(['a', 'b']);
    expect(prepare(parseBlock('x: a\ny: b\n---\nx'), table).series.map((s) => s.name)).toEqual(['b']);
  });

  it('leaves values at or below zero out of a log axis, and says so', () => {
    const d = prepare(parseBlock('logx: true\nlogy: true\n---\nx'), table);
    expect(d.xs).toEqual([NaN, 1, 10]);
    expect(d.series[0]!.ys).toEqual([1, 2, NaN]);
    expect(d.notes).toEqual([
      '1 row with f ≤ 0 left out of the log axis.',
      '1 value of a ≤ 0 left out of the log axis.',
      '1 value of b ≤ 0 left out of the log axis.',
    ]);
  });

  it('draws steps after each sample', () => {
    expect(stepPoints([0, 1, 2], [5, 6, 7])).toEqual({ xs: [0, 1, 1, 2, 2], ys: [5, 5, 6, 6, 7] });
  });
});

describe('LTTB', () => {
  const n = 20000;
  const xs = Array.from({ length: n }, (_, i) => i);
  const ys = xs.map((x) => Math.sin(x / 300) + (x === 12345 ? 5 : 0));

  it('keeps short series whole', () => {
    expect(lttb([0, 1, 2], [1, 2, 3])).toEqual([0, 1, 2]);
  });

  it('keeps the ends, the size and the spikes', () => {
    const idx = lttb(xs, ys, 1000);
    expect(idx.length).toBe(1000);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(n - 1);
    expect(idx).toContain(12345);
    expect(idx.every((v, i) => i === 0 || v > idx[i - 1]!)).toBe(true);
  });

  it('breaks the line at gaps', () => {
    const g = [...ys];
    for (let i = 9000; i < 9100; i++) g[i] = NaN;
    const t = thin(xs, g, 1000);
    const nan = t.ys.findIndex((v) => Number.isNaN(v));
    expect(nan).toBeGreaterThan(0);
    expect(t.xs[nan - 1]).toBeLessThan(9000);
    expect(t.xs[nan + 1]).toBeGreaterThanOrEqual(9100);
  });
});
