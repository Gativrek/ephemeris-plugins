import { describe, expect, it } from 'vitest';
import { DUE_INLINE, parseTask, TASK_LINE, toggleEdit } from './tasks';

const lineRe = () => new RegExp(TASK_LINE, 'gm');

describe('the task line pattern', () => {
  it('finds GFM task items of every list kind, and nothing else', () => {
    const text = [
      '- [ ] open one',
      '* [x] done one',
      '  + [X] nested and done',
      '3. [ ] ordered',
      '4) [ ] ordered, other style',
      '- [ ]',
      '- [] not a task',
      '-[ ] not a task',
      'text - [ ] not at the start',
      '> - [ ] in a quote: not a task',
    ].join('\n');
    const found = [...text.matchAll(lineRe())].map((m) => [m[1], m[2] ?? null]);
    expect(found).toEqual([
      [' ', 'open one'],
      ['x', 'done one'],
      ['X', 'nested and done'],
      [' ', 'ordered'],
      [' ', 'ordered, other style'],
      [' ', null],
    ]);
  });
});

describe('parseTask', () => {
  it('reads the due date, removes it from the text, and collects tags', () => {
    const t = parseTask('a.md', 3, ' ', 'Send the report due:2026-11-10 #work/acme #Urgent')!;
    expect(t).toMatchObject({ done: false, due: '2026-11-10', text: 'Send the report #work/acme #Urgent' });
    expect(t.tags).toEqual(['work/acme', 'urgent']);
  });
  it('keeps a field that is not a real date, or not a separate word, as text', () => {
    expect(parseTask('a.md', 1, ' ', 'x due:2026-02-30')!.due).toBeNull();
    expect(parseTask('a.md', 1, ' ', 'overdue:2026-02-10')!.due).toBeNull();
    expect(parseTask('a.md', 1, ' ', 'x due:2026-02-10b')!.due).toBeNull();
    expect(parseTask('a.md', 1, 'x', 'due:2028-02-29 leap')!).toMatchObject({
      done: true,
      due: '2028-02-29',
      text: 'leap',
    });
  });
  it('ignores empty items, a trailing CR, and numeric "tags" (issue numbers)', () => {
    expect(parseTask('a.md', 1, ' ', null)).toBeNull();
    expect(parseTask('a.md', 1, ' ', '  ')).toBeNull();
    expect(parseTask('a.md', 1, ' ', 'fix #123 and #ui\r')).toMatchObject({
      raw: 'fix #123 and #ui',
      tags: ['ui'],
    });
  });
});

describe('the inline due chip pattern', () => {
  const chips = (line: string) => [...line.matchAll(DUE_INLINE)].map((m) => m[1]);
  it('matches due dates on task lines only', () => {
    expect(chips('- [ ] pay rent due:2026-12-01')).toEqual(['2026-12-01']);
    expect(chips('2. [x] due:2026-12-01 first word')).toEqual(['2026-12-01']);
    expect(chips('The form says due:2026-12-01.')).toEqual([]);
    expect(chips('- a list item due:2026-12-01')).toEqual([]);
    expect(chips('- [ ] overdue:2026-12-01')).toEqual([]);
  });
});

describe('toggleEdit', () => {
  const note = ['# List', '', '- [ ] alpha due:2026-11-10', '- [ ] beta', '  - [x] gamma', ''].join('\n');
  const task = (line: number, raw: string, done = false) => ({ line, raw, done });
  const apply = (text: string, e: { from: number; to: number; insert: string } | null) =>
    e ? text.slice(0, e.from) + e.insert + text.slice(e.to) : text;

  it('ticks and unticks at the indexed line', () => {
    expect(apply(note, toggleEdit(note, task(4, 'beta'), true))).toContain('- [x] beta');
    expect(apply(note, toggleEdit(note, task(5, 'gamma', true), false))).toContain('  - [ ] gamma');
  });
  it('finds the task when lines moved, nearest first', () => {
    const moved = 'New first line\n' + note;
    expect(apply(moved, toggleEdit(moved, task(3, 'alpha due:2026-11-10'), true))).toContain('- [x] alpha');
  });
  it('gives up when the task is gone, changed, or already ticked', () => {
    expect(toggleEdit(note, task(4, 'beta changed'), true)).toBeNull();
    expect(toggleEdit(note, task(5, 'gamma', false), true)).toBeNull();
  });
  it('keeps CRLF line ends', () => {
    const crlf = note.replace(/\n/g, '\r\n');
    expect(apply(crlf, toggleEdit(crlf, task(4, 'beta'), true))).toContain('- [x] beta\r\n');
  });
});
