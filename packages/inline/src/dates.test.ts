import { describe, expect, it } from 'vitest';
import { addDays, dueState, isDate, splitDue } from './dates';

describe('dates', () => {
  it('checks calendar dates', () => {
    expect(isDate('2026-12-31')).toBe(true);
    expect(isDate('2026-13-01')).toBe(false);
    expect(isDate('2027-02-29')).toBe(false);
    expect(isDate('2026-1-01')).toBe(false);
  });
  it('adds days across month and year ends', () => {
    expect(addDays('2026-11-28', 6)).toBe('2026-12-04');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
  it('says overdue, today or later', () => {
    expect(dueState('2026-11-07', '2026-11-08')).toBe('overdue');
    expect(dueState('2026-11-08', '2026-11-08')).toBe('today');
    expect(dueState('2026-11-09', '2026-11-08')).toBe('later');
  });
  it('splits the due field off the text', () => {
    expect(splitDue('Send it due:2026-11-10 #work')).toEqual({ text: 'Send it #work', due: '2026-11-10' });
    expect(splitDue('due:2026-02-30 stays')).toEqual({ text: 'due:2026-02-30 stays', due: null });
    expect(splitDue('overdue:2026-02-10')).toEqual({ text: 'overdue:2026-02-10', due: null });
  });
});
