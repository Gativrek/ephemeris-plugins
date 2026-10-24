/**
 * The tokenizer (SPECS 13.2): lines become rows, whitespace splits a line into chunks,
 * and each chunk is scanned left to right with the longest match over token keys and
 * aliases. Characters that match nothing gather into unknown runs; nothing here fails.
 */
import type { Profile, TokenEntry } from './profile';

export type Piece =
  /** `source` is the text as written (an alias stays an alias); `key` is the token it means. */
  { kind: 'token'; source: string; key: string; entry: TokenEntry } | { kind: 'unknown'; source: string };

/** One row: its chunks, each a run of pieces. */
export type Row = Piece[][];

export class Matcher {
  private readonly keys = new Map<string, string>();
  private readonly longest: number;

  constructor(private readonly profile: Profile) {
    for (const key of profile.tokens.keys()) this.keys.set(this.fold(key), key);
    for (const [alias, key] of profile.aliases) this.keys.set(this.fold(alias), key);
    // Lengths as written: folding can change a string's length, the text is scanned unfolded.
    let n = 0;
    for (const k of [...profile.tokens.keys(), ...profile.aliases.keys()]) n = Math.max(n, k.length);
    this.longest = n;
  }

  private fold(s: string): string {
    return this.profile.caseSensitive ? s : s.toLowerCase();
  }

  chunk(text: string): Piece[] {
    const out: Piece[] = [];
    let unknown = '';
    for (let i = 0; i < text.length;) {
      let hit: { len: number; key: string } | null = null;
      for (let len = Math.min(this.longest, text.length - i); len > 0; len--) {
        const key = this.keys.get(this.fold(text.slice(i, i + len)));
        if (key !== undefined) {
          hit = { len, key };
          break;
        }
      }
      if (!hit) {
        unknown += text[i];
        i++;
        continue;
      }
      if (unknown) out.push({ kind: 'unknown', source: unknown });
      unknown = '';
      out.push({
        kind: 'token',
        source: text.slice(i, i + hit.len),
        key: hit.key,
        entry: this.profile.tokens.get(hit.key)!,
      });
      i += hit.len;
    }
    if (unknown) out.push({ kind: 'unknown', source: unknown });
    return out;
  }

  /** Blank lines at the ends are dropped; blank lines inside stay as empty rows. */
  rows(source: string): Row[] {
    const lines = source.split('\n');
    while (lines.length && !lines[0]!.trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
    return lines.map((line) =>
      line
        .split(/\s+/)
        .filter(Boolean)
        .map((c) => this.chunk(c)),
    );
  }
}

/** The notation a set of rows came from, normalized to single spaces. */
export function sourceOf(rows: Row[]): string {
  return rows.map((row) => row.map((chunk) => chunk.map((p) => p.source).join('')).join(' ')).join('\n');
}
