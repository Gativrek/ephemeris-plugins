/**
 * Installed profiles in library storage (`profiles/<id>/`): loading with a cache that a
 * change on disk clears, validation with the missing-image check, and import from a
 * folder the user picked.
 */
import type { FileEntry, ScopedStorage } from '@ephemeris-notes/plugin-api';
import { imagesOf, parseProfile, PROFILE_ID, type Profile } from './profile';
import { stripBom } from './json';
import { strings } from './strings';
import { Matcher } from './tokenize';

export type Loaded =
  | { status: 'ok'; profile: Profile; matcher: Matcher }
  | { status: 'missing' }
  | { status: 'invalid'; problem: string };

export interface Summary {
  id: string;
  name: string;
  tokens: number;
  /** Set when the profile cannot be used at all. */
  problem: string | null;
}

/** A file to write into a profile folder, path relative to it. */
export interface IncomingFile {
  path: string;
  read(): Promise<ArrayBuffer>;
}

const MAX_FILE = 20 * 1024 * 1024;
const visible = (e: FileEntry) => !e.name.startsWith('.');

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};
const mimeOf = (path: string) => MIME[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'image/png';

function base64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export class ProfileStore {
  private cache = new Map<string, Promise<Loaded>>();
  private masks = new Map<string, Promise<string | null>>();
  /** Bumped on every change, so image URLs load fresh files. */
  private generation = 0;

  constructor(private readonly storage: ScopedStorage) {}

  /** Library-relative folder of all profiles, for watching and reveal. */
  get root(): string {
    return `${this.storage.root}/profiles`;
  }

  invalidate(): void {
    this.cache.clear();
    this.masks.clear();
    this.generation++;
  }

  imageUrl(id: string, path: string): string {
    return `${this.storage.assetUrl(`profiles/${id}/${path}`)}?v=${this.generation}`;
  }

  /**
   * A `data:` URL of an image, for CSS masks: browsers fetch mask images with CORS, which
   * `vx-asset:` URLs do not allow. Null when the file is missing.
   */
  maskUrl(id: string, path: string): Promise<string | null> {
    const key = `${id}/${path}`;
    let hit = this.masks.get(key);
    if (!hit) {
      hit = this.storage
        .readBinary(`profiles/${id}/${path}`)
        .then((data) => (data ? `data:${mimeOf(path)};base64,${base64(data)}` : null))
        .catch(() => null);
      this.masks.set(key, hit);
    }
    return hit;
  }

  async ids(): Promise<string[]> {
    const entries = await this.storage.list('profiles').catch(() => [] as FileEntry[]);
    return entries
      .filter((e) => e.kind === 'folder' && visible(e) && PROFILE_ID.test(e.name))
      .map((e) => e.name)
      .sort();
  }

  /** Profile ids match case-insensitively (`combo GBVSR` finds gbvsr). */
  get(rawId: string): Promise<Loaded> {
    const id = rawId.toLowerCase();
    if (!PROFILE_ID.test(id)) return Promise.resolve({ status: 'missing' });
    let hit = this.cache.get(id);
    if (!hit) {
      hit = this.load(id);
      this.cache.set(id, hit);
    }
    return hit;
  }

  private async read(id: string): Promise<{ text: string | null; folder: boolean }> {
    const text = await this.storage.readText(`profiles/${id}/profile.json`).catch(() => null);
    if (text !== null) return { text, folder: true };
    return { text: null, folder: (await this.ids()).includes(id) };
  }

  private async load(id: string): Promise<Loaded> {
    const { text, folder } = await this.read(id);
    if (text === null)
      return folder ? { status: 'invalid', problem: strings.problems.missingFile } : { status: 'missing' };
    const { profile, problems } = parseProfile(text, id);
    if (!profile) return { status: 'invalid', problem: problems[0] ?? '' };
    return { status: 'ok', profile, matcher: new Matcher(profile) };
  }

  async summaries(): Promise<Summary[]> {
    const out: Summary[] = [];
    for (const id of await this.ids()) {
      const l = await this.get(id);
      out.push(
        l.status === 'ok'
          ? { id, name: l.profile.name, tokens: l.profile.tokens.size, problem: null }
          : {
              id,
              name: id,
              tokens: 0,
              problem: l.status === 'invalid' ? l.problem : strings.problems.missingFile,
            },
      );
    }
    return out;
  }

  /** Every problem, including image files that are not in the folder (exact case). */
  async validate(id: string): Promise<string[]> {
    const { text } = await this.read(id);
    if (text === null) return [strings.problems.missingFile];
    const { profile, problems } = parseProfile(text, id);
    if (!profile) return problems;
    const files = await this.files(`profiles/${id}`);
    for (const { key, path } of imagesOf(profile))
      if (!files.has(path)) problems.push(strings.problems.missingImage(key, path));
    return problems;
  }

  /** Paths of every visible file under a storage folder, relative to it. */
  private async files(folder: string, prefix = ''): Promise<Set<string>> {
    const out = new Set<string>();
    const entries = await this.storage.list(folder).catch(() => [] as FileEntry[]);
    for (const e of entries) {
      if (!visible(e)) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.kind === 'file') out.add(rel);
      else for (const f of await this.files(`${folder}/${e.name}`, rel)) out.add(f);
    }
    return out;
  }

  /**
   * Reads the id from a folder's profile.json. Throws a readable reason when the folder
   * cannot become a profile.
   */
  static async idOf(files: IncomingFile[]): Promise<string> {
    const manifest = files.find((f) => f.path === 'profile.json');
    if (!manifest) throw new Error(strings.manager.noProfileJson);
    const text = new TextDecoder().decode(await manifest.read());
    let id: unknown;
    try {
      id = (JSON.parse(stripBom(text)) as { id?: unknown }).id;
    } catch (err) {
      throw new Error(strings.problems.notJson(err instanceof Error ? err.message : String(err)), {
        cause: err,
      });
    }
    if (typeof id !== 'string' || !PROFILE_ID.test(id)) throw new Error(strings.problems.id);
    return id;
  }

  /** Writes a profile folder, replacing (trashing) an installed one with the same id. */
  async install(id: string, files: IncomingFile[]): Promise<void> {
    if ((await this.ids()).includes(id)) await this.storage.remove(`profiles/${id}`);
    for (const f of files) {
      const segs = f.path.split('/');
      if (segs.some((s) => !s || s.startsWith('.'))) continue;
      const data = await f.read();
      if (data.byteLength > MAX_FILE) continue;
      await this.storage.writeBinary(`profiles/${id}/${f.path}`, data);
    }
    this.invalidate();
  }
}
