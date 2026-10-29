/**
 * The ```plot block (SPECS 13.4): `key: value` options, one per line, then either a
 * `file:` in the Vault or CSV rows after a `---` line. Errors name the line.
 */
import type { Delimiter } from './csv';

export type Kind = 'line' | 'scatter' | 'step';

export interface PlotBlock {
  file: string | null;
  /** CSV text written in the block after `---`. */
  inline: string | null;
  /** A column name or 1-based index; null means the first column. */
  x: string | null;
  /** Column names or indices; empty means every column but x. */
  y: string[];
  kind: Kind;
  title: string | null;
  xlabel: string | null;
  ylabel: string | null;
  logx: boolean;
  logy: boolean;
  grid: boolean;
  delimiter: Delimiter | null;
  decimal: '.' | ',' | null;
}

export class BlockError extends Error {}

export const MAX_SERIES = 6;
const KEYS = [
  'file',
  'x',
  'y',
  'kind',
  'title',
  'xlabel',
  'ylabel',
  'logx',
  'logy',
  'grid',
  'delimiter',
  'decimal',
];

const unquote = (s: string) => {
  const t = s.trim();
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t;
};

/** `[a, b]`, `a, b` or `a`; names may be quoted to hold a comma. */
export function parseList(value: string): string[] {
  const inner = value.trim().replace(/^\[(.*)\]$/, '$1');
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const c of inner) {
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

function bool(v: string, line: number, key: string): boolean {
  const s = v.trim().toLowerCase();
  if (['true', 'on', 'yes'].includes(s)) return true;
  if (['false', 'off', 'no'].includes(s)) return false;
  throw new BlockError(`Line ${line}: ${key} must be true or false.`);
}

export function parseBlock(source: string): PlotBlock {
  const b: PlotBlock = {
    file: null,
    inline: null,
    x: null,
    y: [],
    kind: 'line',
    title: null,
    xlabel: null,
    ylabel: null,
    logx: false,
    logy: false,
    grid: true,
    delimiter: null,
    decimal: null,
  };
  const lines = source.split('\n');
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    const text = lines[i]!.trim();
    if (text === '---') {
      b.inline = lines.slice(i + 1).join('\n');
      break;
    }
    if (!text || text.startsWith('#')) continue;
    const m = /^([A-Za-z]+)\s*:\s*(.*)$/.exec(text);
    if (!m) throw new BlockError(`Line ${line}: expected "option: value", such as "file: data.csv".`);
    const key = m[1]!.toLowerCase();
    const value = m[2]!;
    if (!KEYS.includes(key))
      throw new BlockError(`Line ${line}: unknown option "${m[1]}". Options: ${KEYS.join(', ')}.`);
    if (seen.has(key)) throw new BlockError(`Line ${line}: ${key} is set twice.`);
    seen.add(key);
    if (key === 'file') b.file = unquote(value) || null;
    else if (key === 'x') b.x = unquote(value) || null;
    else if (key === 'y') b.y = parseList(value);
    else if (key === 'kind') {
      const k = value.trim().toLowerCase();
      if (k !== 'line' && k !== 'scatter' && k !== 'step')
        throw new BlockError(`Line ${line}: kind must be line, scatter or step.`);
      b.kind = k;
    } else if (key === 'title' || key === 'xlabel' || key === 'ylabel') b[key] = unquote(value) || null;
    else if (key === 'logx' || key === 'logy' || key === 'grid') b[key] = bool(value, line, key);
    else if (key === 'delimiter') {
      const d = unquote(value);
      const map: Record<string, Delimiter> = { ',': ',', ';': ';', tab: '\t', '\\t': '\t', '\t': '\t' };
      const got = map[d.toLowerCase()];
      if (!got) throw new BlockError(`Line ${line}: delimiter must be ",", ";" or tab.`);
      b.delimiter = got;
    } else if (key === 'decimal') {
      const d = unquote(value);
      if (d !== '.' && d !== ',') throw new BlockError(`Line ${line}: decimal must be "." or ",".`);
      b.decimal = d;
    }
  }
  if (b.file && b.inline !== null) throw new BlockError('Use either file: or rows after ---, not both.');
  if (!b.file && (b.inline === null || !b.inline.trim()))
    throw new BlockError('No data: add "file: data.csv", or CSV rows after a --- line.');
  if (b.y.length > MAX_SERIES) throw new BlockError(`At most ${MAX_SERIES} y columns per plot.`);
  return b;
}

/**
 * The library path of `file`, relative to the note's folder, or to the Vault root with a
 * leading `/`. Null when it would leave the Vault.
 */
export function resolveFile(file: string, notePath: string, vaultPath: string | null): string | null {
  const parts = (file.startsWith('/') ? (vaultPath ?? '') : notePath.split('/').slice(0, -1).join('/'))
    .split('/')
    .filter(Boolean);
  const root = (vaultPath ?? '').split('/').filter(Boolean).length;
  for (const p of file.replace(/\\/g, '/').split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') {
      if (parts.length <= root) return null;
      parts.pop();
    } else parts.push(p);
  }
  return parts.join('/');
}
