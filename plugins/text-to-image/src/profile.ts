/**
 * Profiles (SPECS 13.2): data only, `profiles/<id>/profile.json` plus images, in the
 * plugin's library storage. Parsing never throws. Problems that leave nothing to render
 * with (bad JSON, wrong schema or id) are fatal; the rest skip the offending entry and
 * are reported by Validate.
 */
import { duplicateKeys, stripBom } from './json';
import { strings } from './strings';

const p = strings.problems;

export const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const IMAGE_HEIGHT = /^(?:\d+(?:\.\d+)?|\.\d+)(?:em|rem|px)$/;
const IMAGE_EXT = /\.(?:png|jpe?g|webp|gif|avif|svg)$/i;
/** Relative, no empty, dot-leading or reserved-character segments. */
const IMAGE_PATH =
  /^(?:[^/\\:*?"<>|\x00-\x1f.][^/\\:*?"<>|\x00-\x1f]*)(?:\/[^/\\:*?"<>|\x00-\x1f.][^/\\:*?"<>|\x00-\x1f]*)*$/;
export const DEFAULT_IMAGE_HEIGHT = '1.4em';

export type TokenEntry =
  | { kind: 'image'; image: string; alt: string }
  | { kind: 'text'; text: string; alt: string }
  | { kind: 'none'; alt: string };

export interface Profile {
  id: string;
  name: string;
  caseSensitive: boolean;
  imageHeight: string;
  monochrome: boolean;
  /** Token key as written to its entry. */
  tokens: Map<string, TokenEntry>;
  /** Alias as written to its token key. */
  aliases: Map<string, string>;
}

export interface ParseResult {
  profile: Profile | null;
  /** The first one explains a null profile. */
  problems: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function isImagePath(path: string): boolean {
  return IMAGE_PATH.test(path) && IMAGE_EXT.test(path);
}

export function parseProfile(text: string, folder: string): ParseResult {
  const problems: string[] = [];
  const fatal = (msg: string): ParseResult => ({ profile: null, problems: [msg, ...problems] });
  let raw: unknown;
  try {
    raw = JSON.parse(stripBom(text));
  } catch (err) {
    return fatal(p.notJson(err instanceof Error ? err.message : String(err)));
  }
  if (!isObject(raw)) return fatal(p.notObject);
  if (raw.schema !== 1) return fatal(p.schema);
  if (typeof raw.id !== 'string' || !PROFILE_ID.test(raw.id)) return fatal(p.id);
  if (raw.id !== folder) return fatal(p.idMismatch(raw.id, folder));
  if (!isObject(raw.tokens)) return fatal(p.tokens);

  for (const path of duplicateKeys(text)) problems.push(p.duplicate(path));

  const flag = (key: 'caseSensitive' | 'monochrome', fallback: boolean) => {
    const v = raw[key];
    if (v === undefined) return fallback;
    if (typeof v === 'boolean') return v;
    problems.push(p[key]);
    return fallback;
  };
  let name = raw.id;
  if (typeof raw.name === 'string' && raw.name.trim()) name = raw.name.trim();
  else if (raw.name !== undefined) problems.push(p.name);
  let imageHeight = DEFAULT_IMAGE_HEIGHT;
  if (typeof raw.imageHeight === 'string' && IMAGE_HEIGHT.test(raw.imageHeight))
    imageHeight = raw.imageHeight;
  else if (raw.imageHeight !== undefined) problems.push(p.imageHeight(JSON.stringify(raw.imageHeight)));

  const profile: Profile = {
    id: raw.id,
    name,
    caseSensitive: flag('caseSensitive', true),
    imageHeight,
    monochrome: flag('monochrome', false),
    tokens: new Map(),
    aliases: new Map(),
  };
  const fold = (k: string) => (profile.caseSensitive ? k : k.toLowerCase());
  /** Folded key to the key as written, across tokens and aliases. */
  const taken = new Map<string, string>();
  const claim = (key: string): boolean => {
    if (key === '') {
      problems.push(p.emptyKey);
      return false;
    }
    if (/\s/.test(key)) {
      problems.push(p.spaceKey(key));
      return false;
    }
    const other = taken.get(fold(key));
    if (other !== undefined) {
      // An exact repeat is already reported by duplicateKeys.
      if (other !== key) problems.push(p.sameKey(other, key));
      return false;
    }
    taken.set(fold(key), key);
    return true;
  };

  for (const [key, value] of Object.entries(raw.tokens)) {
    const entry = parseEntry(key, value, problems);
    if (entry && claim(key)) profile.tokens.set(key, entry);
  }

  if (raw.aliases !== undefined && !isObject(raw.aliases)) problems.push(p.aliases);
  else if (raw.aliases) {
    for (const [alias, target] of Object.entries(raw.aliases)) {
      if (typeof target !== 'string' || !profile.tokens.has(target)) {
        problems.push(p.aliasTarget(alias, String(target)));
        continue;
      }
      const other = taken.get(fold(alias));
      if (other !== undefined && profile.tokens.has(other)) {
        problems.push(p.aliasIsToken(alias));
        continue;
      }
      if (claim(alias)) profile.aliases.set(alias, target);
    }
  }
  return { profile, problems };
}

function parseEntry(key: string, value: unknown, problems: string[]): TokenEntry | null {
  if (!isObject(value)) {
    problems.push(p.entry(key));
    return null;
  }
  if (value.alt !== undefined && typeof value.alt !== 'string') problems.push(p.alt(key));
  const alt = typeof value.alt === 'string' ? value.alt : key;
  if (value.render !== undefined && value.render !== 'none') {
    problems.push(p.render(key));
    return null;
  }
  const kinds = [value.image !== undefined, value.text !== undefined, value.render === 'none'];
  if (kinds.filter(Boolean).length !== 1) {
    problems.push(p.entry(key));
    return null;
  }
  if (value.render === 'none') return { kind: 'none', alt };
  if (value.text !== undefined) {
    if (typeof value.text !== 'string') {
      problems.push(p.entry(key));
      return null;
    }
    return { kind: 'text', text: value.text, alt };
  }
  if (typeof value.image !== 'string' || !isImagePath(value.image)) {
    problems.push(p.imagePath(key, String(value.image)));
    return null;
  }
  return { kind: 'image', image: value.image, alt };
}

/** Image files a profile names, for the missing-file check. */
export function imagesOf(profile: Profile): Array<{ key: string; path: string }> {
  const out: Array<{ key: string; path: string }> = [];
  for (const [key, e] of profile.tokens) if (e.kind === 'image') out.push({ key, path: e.image });
  return out;
}
