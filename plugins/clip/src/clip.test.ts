import { describe, expect, it } from 'vitest';
import { formatLength, formatTime, parseClip, parseTime, withKey } from './clip';

describe('times', () => {
  it('reads seconds, m:ss and h:mm:ss', () => {
    expect(parseTime('83.5')).toBe(83.5);
    expect(parseTime('1:23.5')).toBe(83.5);
    expect(parseTime('0:07')).toBe(7);
    expect(parseTime('1:02:03.25')).toBe(3723.25);
    expect(parseTime(' 12 ')).toBe(12);
  });
  it('refuses what is not a time', () => {
    for (const s of ['', '1:60', '1:75:00', '-3', '1.2.3', 'abc', '1:', ':30'])
      expect(parseTime(s)).toBeNull();
  });
  it('formats with one decimal, or two for written times', () => {
    expect(formatTime(83.5)).toBe('1:23.5');
    expect(formatTime(101)).toBe('1:41.0');
    expect(formatTime(5.04)).toBe('0:05.0');
    expect(formatTime(3723.25)).toBe('1:02:03.3');
    expect(formatTime(83.4712, 2)).toBe('1:23.47');
    expect(formatTime(59.99, 1)).toBe('1:00.0');
    expect(formatLength(17.5)).toBe('17.5 s');
    expect(formatLength(77.5)).toBe('1:17.5');
  });
});

describe('parseClip', () => {
  it('reads every key, with link or path files', () => {
    expect(parseClip('file: [[take3.mp4]]\nstart: 1:23.5\nend: 1:41\nloop: false\nmuted: true')).toEqual({
      clip: { file: 'take3.mp4', link: true, start: 83.5, end: 101, loop: false, muted: true },
      problems: [],
    });
    expect(parseClip('file: Videos/take 3.mp4').clip).toMatchObject({
      file: 'Videos/take 3.mp4',
      link: false,
      start: 0,
      end: null,
      loop: true,
    });
    expect(parseClip('file: ![[take3.mp4|alias]]').clip.file).toBe('take3.mp4');
  });
  it('names problems and keeps the rest', () => {
    const { clip, problems } = parseClip('file: a.mp4\nstart: soon\nend: 10\nspeed: 2\nloop: yes');
    expect(clip).toMatchObject({ file: 'a.mp4', start: 0, end: 10, loop: true });
    expect(problems).toEqual([
      'start: "soon" is not a time (83.5, 1:23.5 or 1:02:03).',
      'Unknown key "speed" (keys: file, start, end, loop, muted).',
      'loop: "yes" is not true or false.',
    ]);
  });
  it('needs a file, and an end after the start', () => {
    expect(parseClip('start: 1').problems).toEqual([
      'Add "file:" with the video, e.g. "file: [[take3.mp4]]".',
    ]);
    expect(parseClip('file: a.mp4\nstart: 10\nend: 0:10').problems).toEqual([
      '"end" must come after "start".',
    ]);
  });
});

describe('withKey', () => {
  it('replaces a time in place', () => {
    expect(withKey('file: a.mp4\nstart: 0:00\nend: 0:10\n', 'start', '0:03.25')).toBe(
      'file: a.mp4\nstart: 0:03.25\nend: 0:10\n',
    );
  });
  it('adds a missing time next to the other one, or after file:', () => {
    expect(withKey('file: a.mp4\nend: 0:10', 'start', '0:02.00')).toBe(
      'file: a.mp4\nstart: 0:02.00\nend: 0:10',
    );
    expect(withKey('file: a.mp4\nstart: 0:02', 'end', '0:09.50')).toBe(
      'file: a.mp4\nstart: 0:02\nend: 0:09.50',
    );
    expect(withKey('file: a.mp4\nloop: false', 'end', '0:09.50')).toBe(
      'file: a.mp4\nend: 0:09.50\nloop: false',
    );
    expect(withKey('loop: false\n\n', 'start', '0:01.00')).toBe('loop: false\nstart: 0:01.00');
  });
});
