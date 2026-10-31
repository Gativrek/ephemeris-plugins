/**
 * The reference libraries a note can cite from: the files in Settings, plus a note's own
 * `bibliography:` frontmatter (as in Pandoc). Each file is read once, then again when it
 * changes on disk (Better BibTeX re-exports on every change in Zotero).
 */
import type { Disposable, NoteRef, PluginContext } from '@ephemeris-notes/plugin-api';
import { parseLibrary, type CslItem } from './bib';

interface Loaded {
  items: CslItem[];
  error: string | null;
}

/** Library path of `file`: relative to the note's folder, or to the Vault root with a leading `/`. */
export function resolvePath(file: string, note: NoteRef): string | null {
  const vault = (note.vaultPath ?? '').split('/').filter(Boolean);
  const parts = file.startsWith('/') ? [...vault] : note.path.split('/').slice(0, -1);
  for (const p of file.replace(/\\/g, '/').split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') {
      if (parts.length <= vault.length) return null;
      parts.pop();
    } else parts.push(p);
  }
  return parts.join('/');
}

export class Libraries {
  private readonly files = new Map<string, Promise<Loaded>>();
  private readonly watches = new Map<string, Disposable>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly ctx: PluginContext) {}

  /** The files from Settings: the main one and any extra paths, one per line or comma. */
  settingsPaths(): string[] {
    const main = String(this.ctx.settings.get<string>('library') ?? '').trim();
    const more = String(this.ctx.settings.get<string>('more') ?? '')
      .split(/[\n,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return [...new Set([main, ...more].filter(Boolean))];
  }

  /** Files from the note's `bibliography:` frontmatter, a path or a list. */
  notePaths(note: NoteRef): string[] {
    const fm = note.frontmatter['bibliography'];
    const list = Array.isArray(fm) ? fm : typeof fm === 'string' ? [fm] : [];
    return list
      .filter((x): x is string => typeof x === 'string' && !!x.trim())
      .map((f) => resolvePath(f.trim(), note))
      .filter((p): p is string => !!p);
  }

  /** Every file the note can cite from; the note's own come last, so their entries win. */
  pathsFor(note: NoteRef): string[] {
    return [...new Set([...this.settingsPaths(), ...this.notePaths(note)])];
  }

  private load(path: string): Promise<Loaded> {
    let p = this.files.get(path);
    if (!p) {
      p = this.ctx.vault.readText(path).then(
        async (text) => {
          try {
            const r = await parseLibrary(path, text);
            if (r.errors.length)
              this.ctx.log.warn(
                `${path}: ${r.errors.length} entries could not be read`,
                r.errors.slice(0, 5),
              );
            return { items: r.items, error: null };
          } catch (err) {
            return { items: [], error: `${path}: ${err instanceof Error ? err.message : String(err)}` };
          }
        },
        () => ({ items: [], error: `Cannot read ${path}.` }),
      );
      this.files.set(path, p);
      if (!this.watches.has(path))
        this.watches.set(
          path,
          this.ctx.vault.watch(path, () => {
            this.files.delete(path);
            this.changed();
          }),
        );
    }
    return p;
  }

  /** The note's references by key, and the problems met reading its files. */
  async itemsFor(note: NoteRef): Promise<{ items: Map<string, CslItem>; errors: string[]; files: string[] }> {
    const files = this.pathsFor(note);
    const loaded = await Promise.all(files.map((f) => this.load(f)));
    const items = new Map<string, CslItem>();
    for (const l of loaded) for (const it of l.items) items.set(it.id, it);
    return { items, errors: loaded.map((l) => l.error).filter((e): e is string => !!e), files };
  }

  /** Settings changed: read everything again. */
  reset(): void {
    this.files.clear();
    this.changed();
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private changed(): void {
    for (const cb of this.listeners) cb();
  }

  dispose(): void {
    for (const w of this.watches.values()) w.dispose();
    this.watches.clear();
  }
}
