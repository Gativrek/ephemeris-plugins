import { describe, expect, it } from 'vitest';
import { CITATION, KEY_ANYWHERE, keysInOrder, parseCitation } from './cite';

const matches = (text: string) => [...text.matchAll(new RegExp(CITATION.source, 'g'))].map((m) => m[0]);

describe('finding citations', () => {
  it('finds bracketed and narrative citations, bracketed first', () => {
    expect(matches('As @groves2013 shows [see @kalman1960, p. 35; -@a:b] here.')).toEqual([
      '@groves2013',
      '[see @kalman1960, p. 35; -@a:b]',
    ]);
  });

  it('skips e-mail addresses, Markdown links and trailing punctuation', () => {
    expect(matches('Write to me@example.com.')).toEqual([]);
    // A link is not a bracketed citation, though its text may hold one, as in Pandoc.
    expect(matches('[see @x](https://example.com)')).toEqual(['@x']);
    expect(matches('[@x][ref]')).toEqual([]);
    expect(matches('Cited by @groves2013.')).toEqual(['@groves2013']);
  });
});

describe('reading a citation', () => {
  it('reads keys, prefixes, locators and suffixes', () => {
    expect(parseCitation('[see @kalman1960, pp. 35-37; also -@groves2013, ch. 3, for details]')).toEqual({
      narrative: false,
      items: [
        {
          key: 'kalman1960',
          prefix: 'see',
          suppressAuthor: false,
          label: 'page',
          locator: '35-37',
          suffix: '',
        },
        {
          key: 'groves2013',
          prefix: 'also',
          suppressAuthor: true,
          label: 'chapter',
          locator: '3',
          suffix: ', for details',
        },
      ],
    });
    expect(parseCitation('[@a, 45]')!.items[0]).toMatchObject({ label: 'page', locator: '45' });
    expect(parseCitation('[@a, and elsewhere]')!.items[0]).toMatchObject({ suffix: ', and elsewhere' });
    expect(parseCitation('@groves2013')).toEqual({
      narrative: true,
      items: [{ key: 'groves2013', prefix: '', suffix: '', suppressAuthor: false }],
    });
  });

  it('refuses cross-references and parts without a key', () => {
    expect(parseCitation('@eq:energy')).toBeNull();
    expect(parseCitation('[@fig:map]')).toBeNull();
    expect(parseCitation('[@a; no key here]')).toBeNull();
    expect(parseCitation('[mail me@x.org]')).toBeNull();
  });
});

describe('keys in a note', () => {
  it('lists cited keys in order of first appearance, outside code and math', () => {
    const note = [
      '---',
      'title: "@notakey"',
      '---',
      'First [@b], then @a and [@b; @c].',
      '```python',
      'x = "@d"',
      '```',
      'Inline `@e` and $$@f$$ and @eq:one.',
    ].join('\n');
    expect(keysInOrder(note)).toEqual(['b', 'a', 'c']);
  });

  it('gives the index a pattern that finds the same keys', () => {
    const re = new RegExp(KEY_ANYWHERE, 'g');
    expect([...'See [@a; -@b] and @c, not x@y.'.matchAll(re)].map((m) => m[1])).toEqual(['a', 'b', 'c']);
  });
});

describe('missing keys', () => {
  it('count only bracketed citations, since a plain @word is text', () => {
    expect(keysInOrder('Ask @someone about [@a] and [@b].', { bracketedOnly: true })).toEqual(['a', 'b']);
  });
});
