import { describe, expect, it } from 'vitest';
import { addCard, findCard, isBoard, moveCard, parseBoard, tickCard, type Edit } from './board';

const NOTE = [
  '---',
  'kanban: true',
  '## not a column: frontmatter',
  '---',
  'A line before the first column.',
  '',
  '## To do',
  '- [ ] Record the intro due:2026-11-20',
  '- [ ] Draw the orbit diagram',
  '  - from the M3 notes',
  '',
  '  still the same card',
  '- plain card',
  '',
  'A paragraph under To do.',
  '',
  '## Doing',
  '',
  '### a sub-heading, not a column',
  '- [ ] Edit the combo #guide',
  '',
  '## Done',
  '- [x] Write the script',
  '```',
  '## not a column: code',
  '- not a card',
  '```',
].join('\n');

const apply = (text: string, e: Edit | null) =>
  e ? text.slice(0, e.from) + e.insert + text.slice(e.to) : text;
const titles = (text: string) =>
  parseBoard(text).columns.map((c) => [c.title, c.cards.map((k) => k.text)] as const);

describe('parseBoard', () => {
  it('reads columns and cards, with their indented lines, and nothing else', () => {
    const b = parseBoard(NOTE);
    expect(b.level).toBe(2);
    expect(titles(NOTE)).toEqual([
      ['To do', ['Record the intro', 'Draw the orbit diagram', 'plain card']],
      ['Doing', ['Edit the combo #guide']],
      ['Done', ['Write the script']],
    ]);
    const [record, draw, plain] = b.columns[0]!.cards;
    expect(record).toMatchObject({ due: '2026-11-20', done: false, extra: 0 });
    expect(draw).toMatchObject({ start: 8, end: 12, extra: 3 });
    expect(plain).toMatchObject({ done: null });
    expect(b.columns[2]!.cards[0]!.done).toBe(true);
  });
  it('takes the column level from the first heading with cards under it', () => {
    expect(titles('# Board\nIntro.\n## A\n- a\n## B\n- b')).toEqual([
      ['A', ['a']],
      ['B', ['b']],
    ]);
  });
  it('reads boards from Obsidian, leaving their settings comment out', () => {
    const obsidian = [
      '---',
      'kanban-plugin: basic',
      '---',
      '',
      '## Lane',
      '',
      '- [ ] card',
      '',
      '%% kanban:settings',
      '```',
      '{"kanban-plugin":"basic"}',
      '```',
      '%%',
    ].join('\n');
    expect(titles(obsidian)).toEqual([['Lane', ['card']]]);
    expect(isBoard({ 'kanban-plugin': 'basic' })).toBe(true);
    expect(isBoard({ kanban: true })).toBe(true);
    expect(isBoard({ kanban: 'yes' })).toBe(false);
  });
});

describe('moveCard', () => {
  const b = parseBoard(NOTE);
  const draw = b.columns[0]!.cards[1]!;
  it('moves a card with its indented lines to another column, changing nothing else', () => {
    const after = apply(NOTE, moveCard(NOTE, b, draw, 1, 1));
    expect(titles(after)[0]![1]).toEqual(['Record the intro', 'plain card']);
    expect(titles(after)[1]![1]).toEqual(['Edit the combo #guide', 'Draw the orbit diagram']);
    expect(after).toContain(
      '- [ ] Edit the combo #guide\n- [ ] Draw the orbit diagram\n  - from the M3 notes\n\n  still the same card\n',
    );
    // The same lines, in another order.
    expect(after.split('\n').sort()).toEqual(NOTE.split('\n').sort());
  });
  it('moves within a column, up and down', () => {
    const plain = b.columns[0]!.cards[2]!;
    expect(titles(apply(NOTE, moveCard(NOTE, b, plain, 0, 0)))[0]![1]).toEqual([
      'plain card',
      'Record the intro',
      'Draw the orbit diagram',
    ]);
    const record = b.columns[0]!.cards[0]!;
    expect(titles(apply(NOTE, moveCard(NOTE, b, record, 0, 2)))[0]![1]).toEqual([
      'Draw the orbit diagram',
      'plain card',
      'Record the intro',
    ]);
    expect(moveCard(NOTE, b, record, 0, 0)).toBeNull();
  });
  it('moves into an empty column, right under its heading', () => {
    const text = '## A\n- a\n- b\n\n## B\n\n## C\n- c';
    const board = parseBoard(text);
    const after = apply(text, moveCard(text, board, board.columns[0]!.cards[0]!, 1, 0));
    expect(after).toBe('## A\n- b\n\n## B\n- a\n\n## C\n- c');
  });
  it('moves the last line of a note without a final newline', () => {
    const text = '## A\n- a\n## B\n- b';
    const board = parseBoard(text);
    expect(apply(text, moveCard(text, board, board.columns[1]!.cards[0]!, 0, 0))).toBe(
      '## A\n- b\n- a\n## B',
    );
  });
});

describe('addCard, tickCard and findCard', () => {
  const b = parseBoard(NOTE);
  it('adds a task item at the end of a column, or under an empty one', () => {
    expect(titles(apply(NOTE, addCard(NOTE, b, 1, '  New   card ')))[1]![1]).toEqual([
      'Edit the combo #guide',
      'New card',
    ]);
    const text = '## A\n\n## B\n- b';
    expect(apply(text, addCard(text, parseBoard(text), 0, 'first'))).toBe('## A\n- [ ] first\n\n## B\n- b');
    expect(addCard(NOTE, b, 1, '   ')).toBeNull();
  });
  it('ticks task cards, and leaves plain items alone', () => {
    expect(apply(NOTE, tickCard(NOTE, b.columns[0]!.cards[0]!, true))).toContain('- [x] Record the intro');
    expect(tickCard(NOTE, b.columns[0]!.cards[2]!, true)).toBeNull();
    expect(tickCard(NOTE, b.columns[2]!.cards[0]!, true)).toBeNull();
  });
  it('finds a card again after the note changed', () => {
    const changed = 'New first line.\n' + NOTE;
    const found = findCard(parseBoard(changed), 'To do', b.columns[0]!.cards[1]!);
    expect(found?.card.start).toBe(9);
    expect(findCard(parseBoard(changed), 'Doing', b.columns[0]!.cards[1]!)).toBeNull();
  });
  it('keeps CRLF line ends', () => {
    const crlf = NOTE.replace(/\n/g, '\r\n');
    const board = parseBoard(crlf);
    expect(titles(crlf)).toEqual(titles(NOTE));
    const after = apply(crlf, moveCard(crlf, board, board.columns[0]!.cards[0]!, 2, 1));
    expect(after.split('\r\n').length).toBe(NOTE.split('\n').length);
    expect(after).toContain('- [x] Write the script\r\n- [ ] Record the intro due:2026-11-20\r\n');
    expect(apply(crlf, addCard(crlf, board, 1, 'x'))).toContain('- [ ] x\r\n');
  });
});
