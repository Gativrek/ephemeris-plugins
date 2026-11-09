/**
 * The ```clip block's text (SPECS 13.8): `key: value` lines, and times as seconds, m:ss or
 * h:mm:ss. Pure functions, shared by the block and the unit tests.
 */

export interface ClipSpec {
  /** The file as written: a path, or a link target from `[[…]]`. */
  file: string | null;
  /** True when `file` was written as a link. */
  link: boolean;
  start: number;
  /** Null: the end of the video. */
  end: number | null;
  loop: boolean;
  muted: boolean;
}

const KEYS = 'file, start, end, loop, muted';

/** Seconds from "83.5", "1:23.5" or "1:02:03.25"; null when it is not a time. */
export function parseTime(s: string): number | null {
  const m = /^(?:(?:(\d+):)?(\d{1,2}):)?(\d+(?:\.\d+)?)$/.exec(s.trim());
  if (!m) return null;
  const [h, min, sec] = [Number(m[1] ?? 0), Number(m[2] ?? 0), Number(m[3])];
  // In m:ss and h:mm:ss, the minutes and seconds stay under 60.
  if (m[2] !== undefined && sec >= 60) return null;
  if (m[1] !== undefined && min >= 60) return null;
  return h * 3600 + min * 60 + sec;
}

/** "1:23.5" (m:ss) or "1:02:03.0" past an hour, with `decimals` places. */
export function formatTime(seconds: number, decimals = 1): string {
  const scale = 10 ** decimals;
  const total = Math.round(Math.max(0, seconds) * scale) / scale;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = (total % 60).toFixed(decimals).padStart(decimals ? 3 + decimals : 2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** "17.5 s" under a minute, else as a time. */
export function formatLength(seconds: number): string {
  return seconds < 60 ? `${seconds.toFixed(1)} s` : formatTime(seconds);
}

export function parseClip(source: string): { clip: ClipSpec; problems: string[] } {
  const clip: ClipSpec = { file: null, link: false, start: 0, end: null, loop: true, muted: false };
  const problems: string[] = [];
  for (const [n, raw] of source.split('\n').entries()) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([a-z]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) {
      problems.push(`Line ${n + 1}: write "key: value" (keys: ${KEYS}).`);
      continue;
    }
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    const bool = (set: (v: boolean) => void) => {
      if (value === 'true' || value === 'false') set(value === 'true');
      else problems.push(`${key}: "${value}" is not true or false.`);
    };
    switch (key) {
      case 'file': {
        const link = /^!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/.exec(value);
        clip.file = link ? link[1]!.trim() : value.replace(/^["']|["']$/g, '') || null;
        clip.link = !!link;
        break;
      }
      case 'start':
      case 'end': {
        const t = parseTime(value);
        if (t === null) problems.push(`${key}: "${value}" is not a time (83.5, 1:23.5 or 1:02:03).`);
        else if (key === 'start') clip.start = t;
        else clip.end = t;
        break;
      }
      case 'loop':
        bool((v) => (clip.loop = v));
        break;
      case 'muted':
        bool((v) => (clip.muted = v));
        break;
      default:
        problems.push(`Unknown key "${key}" (keys: ${KEYS}).`);
    }
  }
  if (!clip.file) problems.push('Add "file:" with the video, e.g. "file: [[take3.mp4]]".');
  if (clip.end !== null && clip.end <= clip.start) problems.push('"end" must come after "start".');
  return { clip, problems };
}

/** The block's text with `key: value` set: the key's line replaced in place, or added. */
export function withKey(source: string, key: 'start' | 'end', value: string): string {
  const lines = source.split('\n');
  const at = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*:`, 'i').test(l));
  if (at !== -1) lines[at] = `${key}: ${value}`;
  else {
    // After the other time, or after file:, or at the end.
    const after = lines.findIndex((l) => /^\s*(start|end)\s*:/i.test(l));
    const fileAt = lines.findIndex((l) => /^\s*file\s*:/i.test(l));
    const anchor = after !== -1 ? after : fileAt;
    if (anchor !== -1)
      lines.splice(key === 'start' && after !== -1 ? anchor : anchor + 1, 0, `${key}: ${value}`);
    else {
      while (lines.length && lines.at(-1)!.trim() === '') lines.pop();
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.join('\n');
}
