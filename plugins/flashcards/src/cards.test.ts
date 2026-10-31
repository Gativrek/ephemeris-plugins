import { describe, expect, it } from 'vitest';
import { CARD_LINE, clozeText, idEdit, newId, parseCards, withId } from './cards';
import { dueCards, emptyState, intervalLabel, Scheduler } from './schedule';
import { Rating } from 'ts-fsrs';

const NOTE = [
  '---',
  'flashcards: true',
  'title: a :: b',
  '---',
  '# Kalman filter',
  '',
  'What does the gain weigh? :: The prediction against the measurement',
  '- Covariance of the state :: $P$ ^fc-abc123',
  'The {{prediction}} step uses the {{process model}}.',
  'Plain prose, no card.',
  '## Code',
  '```python',
  'x = {"a": 1} :: no',
  '```',
  '$$',
  'a :: b',
  '$$',
].join('\n');

describe('parsing cards', () => {
  const cards = parseCards(NOTE, 'Notes/Kalman.md');

  it('finds basic and cloze cards, with sections and IDs, outside frontmatter, code and math', () => {
    expect(cards.map((c) => [c.kind, c.key, c.section, c.line])).toEqual([
      ['basic', 'new:Notes/Kalman.md:7', 'Kalman filter', 7],
      ['basic', 'fc-abc123', 'Kalman filter', 8],
      ['cloze', 'new:Notes/Kalman.md:9#1', 'Kalman filter', 9],
      ['cloze', 'new:Notes/Kalman.md:9#2', 'Kalman filter', 9],
    ]);
    expect(cards[1]).toMatchObject({ front: 'Covariance of the state', back: '$P$', id: 'fc-abc123' });
  });

  it('hides one cloze at a time', () => {
    expect(cards[2]).toMatchObject({
      front: String.raw`The \[…\] step uses the process model.`,
      back: 'The **prediction** step uses the process model.',
    });
    expect(clozeText('A {{b}} c {{d}}', 2, false)).toBe(String.raw`A b c \[…\]`);
  });

  it('adds an ID at the end of the line, even when lines moved', () => {
    const e = idEdit(NOTE, cards[0]!, 'fc-zzz999')!;
    const after = NOTE.slice(0, e.from) + e.insert + NOTE.slice(e.to);
    expect(after.split('\n')[6]).toBe(
      'What does the gain weigh? :: The prediction against the measurement ^fc-zzz999',
    );
    const moved = `New first line\n${NOTE}`;
    expect(idEdit(moved, cards[0]!, 'fc-zzz999')).not.toBeNull();
    expect(idEdit(NOTE, cards[1]!, 'fc-new000')).toBeNull();
    expect(parseCards(after, 'x')[0]!.key).toBe('fc-zzz999');
    expect(withId(cards[3]!, 'fc-q1w2e3').key).toBe('fc-q1w2e3#2');
  });

  it('makes IDs that are not taken', () => {
    let n = 0;
    const seq = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    expect(newId(new Set(['fc-000000']), () => seq[n++]!)).toBe('fc-iiiiii');
  });

  it('gives the index a pattern that finds the card lines', () => {
    const re = new RegExp(CARD_LINE, 'gm');
    const found = [...'x :: y\nplain\nthe {{c}} line\na::b'.matchAll(re)].map((m) => m[1]);
    expect(found).toEqual(['x :: y', 'the {{c}} line']);
  });
});

describe('scheduling', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  const s = new Scheduler(0.9);

  it('labels intervals', () => {
    const t = (min: number) => new Date(now.getTime() + min * 60000);
    expect(intervalLabel(now, t(1))).toBe('1 min');
    expect(intervalLabel(now, t(180))).toBe('3 h');
    expect(intervalLabel(now, t(4 * 1440))).toBe('4 d');
    expect(intervalLabel(now, t(400 * 1440))).toBe('1.1 y');
  });

  it('schedules longer intervals for better grades', () => {
    const p = s.preview(undefined, now);
    expect(Object.keys(p)).toHaveLength(4);
    const again = new Date(s.grade(undefined, Rating.Again, now).due);
    const easy = new Date(s.grade(undefined, Rating.Easy, now).due);
    expect(easy.getTime()).toBeGreaterThan(again.getTime());
  });

  it('picks due reviews first, then new cards up to the daily limit', () => {
    const cards = parseCards(NOTE, 'n');
    const state = emptyState();
    state.cards['fc-abc123'] = s.grade(undefined, Rating.Good, new Date('2026-10-01T12:00:00Z'));
    const due = dueCards(cards, state, now, 2);
    expect(due.review.map((c) => c.key)).toEqual(['fc-abc123']);
    expect(due.fresh).toHaveLength(2);
    expect(due.heldBack).toBe(1);
    state.newDay = { date: '2026-10-30', count: 2 };
    expect(dueCards(cards, state, now, 2).fresh).toHaveLength(0);
  });
});
