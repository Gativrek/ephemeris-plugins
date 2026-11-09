import { describe, expect, it } from 'vitest';
import { applyQuery, DEFAULT_QUERY, parseQuery } from './query';
import { parseTask, type Task } from './tasks';

const t = (path: string, line: number, raw: string, done = false) =>
  parseTask(path, line, done ? 'x' : ' ', raw)!;

describe('parseQuery', () => {
  it('gives the defaults for an empty block', () => {
    expect(parseQuery('')).toEqual({ query: DEFAULT_QUERY, problems: [] });
    expect(parseQuery('\n  \n').query).toEqual(DEFAULT_QUERY);
  });
  it('reads every key', () => {
    const { query, problems } = parseQuery(
      [
        'scope: all',
        'status: done',
        'due: before 2026-12-01',
        'tag: #Work',
        'path: /Projects/',
        'sort: note',
        'group: note',
        'limit: 20',
      ].join('\n'),
    );
    expect(problems).toEqual([]);
    expect(query).toEqual({
      scope: 'all',
      status: 'done',
      due: { kind: 'before', date: '2026-12-01' },
      tag: 'work',
      path: 'Projects',
      sort: 'note',
      group: 'note',
      limit: 20,
    });
  });
  it('names unknown keys and values, and keeps the rest', () => {
    const { query, problems } = parseQuery('scope: galaxy\nwhen: soon\ndue: week\nlimit: 0\njust words');
    expect(query.due).toEqual({ kind: 'week' });
    expect(query.scope).toBe('vault');
    expect(problems).toHaveLength(4);
    expect(problems[0]).toContain('scope: "galaxy"');
    expect(problems[1]).toContain('Unknown key "when"');
    expect(problems[3]).toContain('Line 5');
  });
});

describe('applyQuery', () => {
  const today = '2026-11-08';
  const tasks: Task[] = [
    t('Work/Acme/Specs/A.md', 4, 'later due:2026-12-20 #work/acme'),
    t('Work/Acme/Specs/A.md', 2, 'undated #work'),
    t('Work/Acme/B.md', 1, 'overdue due:2026-11-01'),
    t('Work/Acme/B.md', 3, 'today due:2026-11-08 #home'),
    t('Work/Acme/B.md', 5, 'in a week due:2026-11-14'),
    t('Work/Acme/B.md', 6, 'past the week due:2026-11-15'),
    t('Work/Acme/C.md', 1, 'done due:2026-11-02', true),
  ];
  const run = (source: string) =>
    applyQuery(tasks, parseQuery(source).query, today).map((x) => x.text.split(' ')[0]);

  it('sorts dated tasks first, earliest first, then the rest by note and line', () => {
    expect(run('')).toEqual(['overdue', 'today', 'in', 'past', 'later', 'undated']);
    // B.md before Specs/A.md; lines in order within a note.
    expect(run('sort: note')).toEqual(['overdue', 'today', 'in', 'past', 'undated', 'later']);
  });
  it('filters by due date', () => {
    expect(run('due: overdue')).toEqual(['overdue']);
    expect(run('due: today')).toEqual(['today']);
    expect(run('due: week')).toEqual(['today', 'in']);
    expect(run('due: none')).toEqual(['undated']);
    expect(run('due: before 2026-11-08')).toEqual(['overdue']);
    expect(run('due: after 2026-11-14')).toEqual(['past', 'later']);
  });
  it('filters by status, nested tags and folder', () => {
    expect(run('status: done')).toEqual(['done']);
    expect(run('status: all\ndue: before 2026-11-03')).toEqual(['overdue', 'done']);
    expect(run('tag: #work')).toEqual(['later', 'undated']);
    expect(run('tag: work/acme')).toEqual(['later']);
    expect(run('path: Specs')).toEqual(['later', 'undated']);
    expect(run('path: Work/Acme/Specs/')).toEqual(['later', 'undated']);
    expect(run('path: Acme')).toHaveLength(6);
  });
});
