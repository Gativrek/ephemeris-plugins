import { describe, expect, it } from 'vitest';
import { countWords, formatDuration, sectionWords, wordsPerLine } from './count';

const total = (text: string, headings?: number[]) =>
  wordsPerLine(text, new Set(headings)).reduce((a, b) => a + b, 0);

describe('countWords', () => {
  it('counts prose, links by their text, and numbers', () => {
    expect(countWords('The filter weighs the prediction.')).toBe(5);
    expect(countWords('See [[Kalman Filter|the filter]] and [this page](https://x.org/a b) now')).toBe(7);
    expect(countWords('Read [[Kalman Filter#Gain]] in 2026.')).toBe(6);
    expect(countWords('- [ ] Record take 3 — then cut')).toBe(5);
    expect(countWords('1. First, 2 things.')).toBe(3);
  });
  it('leaves out images, embeds, inline math, tags and block IDs', () => {
    expect(countWords('Look ![[orbit.png]] here ![alt text](a.png)')).toBe(2);
    expect(countWords('The gain $K_k$ is $x + y$ big')).toBe(4);
    expect(countWords('It costs $5 and $10 today')).toBe(6);
    expect(countWords('Plan the shoot #video #work/guides ^abc123')).toBe(3);
  });
});

describe('wordsPerLine', () => {
  it('leaves out frontmatter, headings, code, math, tables, quotes and comments', () => {
    const text = [
      '---',
      'script: true',
      'tags: [a, b]',
      '---',
      '# Intro',
      'One two three.',
      '```python',
      'print("not spoken")',
      '```',
      '$$',
      'x = y',
      '$$',
      '$$ a = b $$',
      '| Col one | Col two |',
      '|---|---|',
      '| cell words | more words |',
      '',
      '> B-roll: the orbit animation',
      'Four %% a note to self %% five.',
      '%% a comment',
      'over two lines %%',
      '<!-- html comment -->Six',
      'Setext heading',
      '==============',
      'seven',
    ].join('\n');
    // Line 23 is a setext heading, as the core's outline reports it.
    const per = wordsPerLine(text, new Set([5, 23]));
    expect(per.reduce((a, b) => a + b, 0)).toBe(3 + 2 + 1 + 1);
    expect(per[5]).toBe(3);
    expect(per[24]).toBe(1);
  });
  it('keeps going after a fence that never closes, without counting it', () => {
    expect(total('Intro words.\n~~~\nnot\ncounted')).toBe(2);
  });
});

describe('sectionWords', () => {
  it('sums each heading down to the next heading of its level or higher', () => {
    const text = ['# One', 'a b', '## One.1', 'c d e', '## One.2', 'f', '# Two', 'g h'].join('\n');
    const headings = [
      { level: 1, line: 1 },
      { level: 2, line: 3 },
      { level: 2, line: 5 },
      { level: 1, line: 7 },
    ];
    const per = wordsPerLine(text, new Set(headings.map((h) => h.line)));
    expect(sectionWords(per, headings)).toEqual([6, 3, 1, 2]);
  });
});

describe('formatDuration', () => {
  it('rounds to the second, with hours past an hour', () => {
    expect(formatDuration(150, 150)).toBe('1:00');
    expect(formatDuration(200, 150)).toBe('1:20');
    expect(formatDuration(1, 150)).toBe('0:00');
    expect(formatDuration(2, 150)).toBe('0:01');
    expect(formatDuration(9300, 150)).toBe('1:02:00');
  });
});
