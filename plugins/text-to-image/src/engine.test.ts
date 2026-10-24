import { describe, expect, it } from 'vitest';
import { BOM, duplicateKeys } from './json';
import { isImagePath, parseProfile, type Profile } from './profile';
import { Matcher, sourceOf, type Piece } from './tokenize';

const GBVSR = {
  schema: 1,
  id: 'gbvsr',
  name: 'Granblue Fantasy Versus: Rising',
  caseSensitive: true,
  imageHeight: '1.4em',
  tokens: {
    '236': { image: 'motions/236.svg', alt: '236' },
    '214': { image: 'motions/214.svg', alt: '214' },
    '2': { image: 'directions/2.svg', alt: '2' },
    '5': { render: 'none', alt: '5' },
    L: { image: 'buttons/l.png', alt: 'L' },
    M: { image: 'buttons/m.png', alt: 'M' },
    H: { image: 'buttons/h.png', alt: 'H' },
    U: { image: 'buttons/u.png', alt: 'U' },
    '>': { text: '›' },
    xx: { text: 'xx' },
  },
  aliases: { qcf: '236', qcb: '214' },
};

function load(raw: unknown, folder = 'gbvsr'): { profile: Profile; problems: string[] } {
  const r = parseProfile(JSON.stringify(raw), folder);
  if (!r.profile) throw new Error(r.problems[0]);
  return { profile: r.profile, problems: r.problems };
}

/** Compact view of pieces: tokens as their key, unknown runs as ?text. */
const show = (pieces: Piece[]) => pieces.map((x) => (x.kind === 'token' ? x.key : `?${x.source}`));

describe('duplicateKeys', () => {
  it('finds repeated keys at any depth and ignores equal keys in different objects', () => {
    const text = '{"a":1,"tokens":{"L":{"text":"x"},"M":{},"L":{"text":"y"}},"a":2,"b":[{"c":1,"c":2}]}';
    expect(duplicateKeys(text)).toEqual(['tokens.L', 'a', 'b[0].c']);
    expect(duplicateKeys('{"x":{"k":1},"y":{"k":1}}')).toEqual([]);
  });

  it('decodes escapes, so "\\u0041" and "A" are the same key', () => {
    expect(duplicateKeys('{"A":1,"\\u0041":2}')).toEqual(['A']);
    expect(duplicateKeys(BOM + '{"q\\"":1,"q\\"":2}')).toEqual(['q"']);
  });
});

describe('parseProfile', () => {
  it('reads the SPECS 13.2 example without problems', () => {
    const { profile, problems } = load(GBVSR);
    expect(problems).toEqual([]);
    expect(profile.name).toBe('Granblue Fantasy Versus: Rising');
    expect(profile.tokens.get('5')).toEqual({ kind: 'none', alt: '5' });
    expect(profile.tokens.get('>')).toEqual({ kind: 'text', text: '›', alt: '>' });
    expect(profile.tokens.get('L')).toEqual({ kind: 'image', image: 'buttons/l.png', alt: 'L' });
    expect(profile.aliases.get('qcf')).toBe('236');
    expect(profile.monochrome).toBe(false);
  });

  it('refuses what leaves nothing to render', () => {
    expect(parseProfile('{', 'x').problems[0]).toMatch(/not valid JSON/);
    expect(parseProfile('[]', 'x').problems[0]).toMatch(/must hold an object/);
    expect(parseProfile(JSON.stringify({ ...GBVSR, schema: 2 }), 'gbvsr').problems[0]).toMatch(/schema/);
    expect(parseProfile(JSON.stringify({ ...GBVSR, id: 'Bad Id' }), 'gbvsr').problems[0]).toMatch(
      /must match/,
    );
    expect(parseProfile(JSON.stringify(GBVSR), 'other').problems[0]).toMatch(/does not match its folder/);
    expect(parseProfile(JSON.stringify({ ...GBVSR, tokens: [] }), 'gbvsr').profile).toBeNull();
  });

  it('accepts a UTF-8 BOM', () => {
    expect(parseProfile(BOM + JSON.stringify(GBVSR), 'gbvsr').profile).not.toBeNull();
  });

  it('skips bad entries and reports each', () => {
    const { profile, problems } = load({
      ...GBVSR,
      tokens: {
        A: { image: 'a.png', text: 'a' },
        B: {},
        C: { render: 'all' },
        D: { image: '../outside.png' },
        E: { image: 'notes.txt' },
        F: { text: 3 },
        'G H': { text: 'g' },
        '': { text: 'empty' },
        I: { text: 'i', alt: 4 },
        J: 'j',
      },
      aliases: {},
    });
    expect([...profile.tokens.keys()]).toEqual(['I']);
    expect(profile.tokens.get('I')).toEqual({ kind: 'text', text: 'i', alt: 'I' });
    expect(problems).toHaveLength(10);
  });

  it('reports duplicate keys, keys equal apart from case, and bad aliases', () => {
    const text = `{"schema":1,"id":"x","caseSensitive":false,"tokens":{"L":{"text":"l"},"l":{"text":"l2"},"M":{"text":"m"},"M":{"text":"m2"}},"aliases":{"lp":"L","LP":"L","m":"M","q":"nope"}}`;
    const r = parseProfile(text, 'x');
    expect(r.profile).not.toBeNull();
    expect(r.problems).toEqual([
      '"tokens.M" appears twice; only the last one counts.',
      '"L" and "l" are the same key when "caseSensitive" is false.',
      '"lp" and "LP" are the same key when "caseSensitive" is false.',
      'Alias "m" is also a token key.',
      'Alias "q" points to "nope", which is not a token.',
    ]);
    expect(r.profile!.tokens.get('M')).toEqual({ kind: 'text', text: 'm2', alt: 'M' });
    expect([...r.profile!.aliases.keys()]).toEqual(['lp']);
  });

  it('falls back on bad options', () => {
    const { profile, problems } = load({ ...GBVSR, imageHeight: '2em; color: red', monochrome: 'yes' });
    expect(profile.imageHeight).toBe('1.4em');
    expect(profile.monochrome).toBe(false);
    expect(problems).toHaveLength(2);
    expect(load({ ...GBVSR, imageHeight: '24px', monochrome: true }).profile.imageHeight).toBe('24px');
  });

  it('keeps image paths inside the profile folder', () => {
    expect(isImagePath('buttons/l.png')).toBe(true);
    expect(isImagePath('Motions/QCF 236.SVG')).toBe(true);
    for (const bad of [
      '/abs.png',
      '../up.png',
      'a/../b.png',
      './a.png',
      'a\\b.png',
      '.hidden/a.png',
      'a//b.png',
      'c:a.png',
      'a.exe',
    ])
      expect(isImagePath(bad)).toBe(false);
  });
});

describe('Matcher', () => {
  const { profile } = load(GBVSR);
  const m = new Matcher(profile);

  it('takes the longest match: 214H is 214 + H, not 2 + ?14 + H', () => {
    expect(show(m.chunk('214H'))).toEqual(['214', 'H']);
    expect(show(m.chunk('5H'))).toEqual(['5', 'H']);
    expect(show(m.chunk('2M'))).toEqual(['2', 'M']);
  });

  it('splits rows on lines and chunks on whitespace', () => {
    const rows = m.rows('\n5H 214H\t2M  236L\n\n> xx\n\n');
    expect(rows.map((r) => r.map(show))).toEqual([
      [
        ['5', 'H'],
        ['214', 'H'],
        ['2', 'M'],
        ['236', 'L'],
      ],
      [],
      [['>'], ['xx']],
    ]);
  });

  it('gathers unknown characters into runs and never fails', () => {
    expect(show(m.chunk('j.H'))).toEqual(['?j.', 'H']);
    expect(show(m.chunk('2H~~'))).toEqual(['2', 'H', '?~~']);
    expect(show(m.chunk('zzz'))).toEqual(['?zzz']);
    expect(show(m.chunk('🙂L'))).toEqual(['?🙂', 'L']);
  });

  it('matches aliases and keeps their spelling for copy', () => {
    const pieces = m.chunk('qcfH');
    expect(show(pieces)).toEqual(['236', 'H']);
    expect(pieces[0]!.source).toBe('qcf');
    expect(sourceOf(m.rows('qcfH  >  qcbL'))).toBe('qcfH > qcbL');
  });

  it('is case sensitive unless the profile says otherwise', () => {
    expect(show(m.chunk('5h'))).toEqual(['5', '?h']);
    const loose = new Matcher(load({ ...GBVSR, caseSensitive: false }).profile);
    const pieces = loose.chunk('5h QCFl');
    expect(show(pieces)).toEqual(['5', 'H', '? ', '236', 'L']);
    expect(pieces[1]!.source).toBe('h');
  });

  it('works with an empty profile', () => {
    const empty = new Matcher(load({ schema: 1, id: 'e', tokens: {} }, 'e').profile);
    expect(show(empty.chunk('abc'))).toEqual(['?abc']);
  });
});
