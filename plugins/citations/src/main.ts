/**
 * Citations (SPECS 13.5): Pandoc citations (`[@key]`, `@key`) rendered in IEEE or ABNT by
 * citeproc-js from BibTeX or CSL-JSON libraries, with a hover card per reference and a
 * reference list in a ```bibliography block. Numeric styles number references in the
 * order each note first cites them, kept current as the note is typed (the outline hook
 * sees the live text).
 */
import type {
  BlockView,
  InlineMatch,
  InlineView,
  NoteRef,
  Plugin,
  PluginContext,
  PluginFactory,
} from '@ephemeris-notes/plugin-api';
import type { CslItem, CslName } from './bib';
import { CITATION, KEY_ANYWHERE, keysInOrder, parseCitation } from './cite';
import type { Formatter, LocaleId, StyleId } from './format';
import { HELP } from './help';
import { Libraries } from './library';

const ID = 'citations';
type FormatModule = typeof import('./format');
let formatModule: Promise<FormatModule> | null = null;
/** citeproc-js and the styles are loaded on the first citation. */
const loadFormat = () => (formatModule ??= import('./format'));

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls
    .split(' ')
    .map((c) => `${ID}-${c}`)
    .join(' ');
  if (text !== undefined) e.textContent = text;
  return e;
};

interface NoteState {
  /** The note's text as last seen, live while it is open. */
  text: string | null;
  order: string[];
  formatter: Promise<{
    f: Formatter | null;
    items: Map<string, CslItem>;
    errors: string[];
    files: string[];
  }> | null;
  signature: string;
  views: Set<() => void>;
}

class Citations implements Plugin {
  private ctx!: PluginContext;
  private libs!: Libraries;
  private readonly notes = new Map<string, NoteState>();

  onload(ctx: PluginContext): void {
    this.ctx = ctx;
    this.libs = new Libraries(ctx);
    ctx.settings.register({
      fields: [
        { key: 'library', type: 'file', label: 'Library', default: '', extensions: ['bib', 'json'] },
        {
          key: 'more',
          type: 'text',
          label: 'More libraries',
          default: '',
          hint: 'Other .bib or CSL-JSON files in the library, one per line or separated by commas.',
        },
        {
          key: 'style',
          type: 'select',
          label: 'Citation style',
          default: 'ieee',
          options: [
            { value: 'ieee', label: 'IEEE (numbered)' },
            { value: 'abnt', label: 'ABNT (author and year)' },
          ],
        },
        {
          key: 'locale',
          type: 'select',
          label: 'Language',
          default: 'auto',
          options: [
            { value: 'auto', label: "The style's own (IEEE: English, ABNT: Portuguese)" },
            { value: 'en-US', label: 'English (US)' },
            { value: 'pt-BR', label: 'Portuguese (Brazil)' },
          ],
        },
      ],
    });
    ctx.settings.onChange(() => {
      this.libs.reset();
    });
    this.libs.onChange(() => this.refreshAll());

    ctx.inline.register({
      id: 'citation',
      match: CITATION,
      accept: (m) => parseCitation(m.text) !== null,
      widget: (m) => this.widget(m),
      hover: (m, card) => this.hover(m, card),
    });
    ctx.blocks.register('bibliography', {
      render: (target, info, host) => this.bibliography(target, info.note, host.signal),
    });
    // The outline hook sees each open note's live text, so citation numbers follow it as you
    // type. It adds no entries: the outline already lists the bibliography block.
    ctx.outline.contribute((n) => {
      const st = this.state(n.note.path);
      if (st.text !== n.text) {
        st.text = n.text;
        const order = keysInOrder(n.text);
        if (order.join('\n') !== st.order.join('\n')) {
          st.order = order;
          this.refresh(n.note.path);
        }
      }
      return [];
    });
    ctx.index.registerExtractor({ id: 'keys', version: 1, kind: 'regex', pattern: KEY_ANYWHERE, key: 1 });
    ctx.help.register([{ id: 'guide', title: 'Citations guide', markdown: HELP }]);
  }

  onunload(): void {
    this.libs.dispose();
  }

  private get style(): StyleId {
    return this.ctx.settings.get<string>('style') === 'abnt' ? 'abnt' : 'ieee';
  }
  private get locale(): LocaleId {
    const l = this.ctx.settings.get<string>('locale');
    return l === 'en-US' || l === 'pt-BR' ? l : 'auto';
  }

  private state(path: string): NoteState {
    let st = this.notes.get(path);
    if (!st) {
      st = { text: null, order: [], formatter: null, signature: '', views: new Set() };
      this.notes.set(path, st);
    }
    return st;
  }

  /** The note's formatter, made again when the style, language or library files change. */
  private formatter(note: NoteRef): NonNullable<NoteState['formatter']> {
    const st = this.state(note.path);
    const signature = [this.style, this.locale, ...this.libs.pathsFor(note)].join('|');
    if (!st.formatter || st.signature !== signature) {
      st.signature = signature;
      st.formatter = (async () => {
        if (st.text === null) {
          // Not open in an editor (an embed, a help page): the saved text.
          st.text = await this.ctx.notes.read(note.path).then(
            (r) => r.text,
            () => '',
          );
          st.order = keysInOrder(st.text);
        }
        const { items, errors, files } = await this.libs.itemsFor(note);
        if (!items.size) return { f: null, items, errors, files };
        const { Formatter } = await loadFormat();
        return { f: new Formatter(this.style, this.locale, items), items, errors, files };
      })();
    }
    return st.formatter;
  }

  private refresh(path: string): void {
    for (const v of this.notes.get(path)?.views ?? []) v();
  }

  private refreshAll(): void {
    for (const st of this.notes.values()) st.formatter = null;
    for (const path of this.notes.keys()) this.refresh(path);
  }

  // ---- Inline citations ---------------------------------------------------------

  private widget(first: InlineMatch): InlineView {
    let m = first;
    const dom = el('span', 'cite', m.text);
    let seq = 0;
    const draw = () => {
      const mine = ++seq;
      const c = parseCitation(m.text);
      if (!c) return;
      void this.formatter(m.note).then(({ f }) => {
        if (mine !== seq) return;
        const st = this.state(m.note.path);
        f?.setOrder(st.order);
        const known = c.items.filter((it) => f?.has(it.key));
        const unknown = c.items.filter((it) => !f?.has(it.key)).map((it) => it.key);
        dom.className = `${ID}-cite`;
        dom.removeAttribute('title');
        if (!known.length) {
          // A narrative @word that is not a reference is just text; a bracketed one is a missing reference.
          dom.textContent = m.text;
          if (!c.narrative) {
            dom.classList.add(`${ID}-missing`);
            dom.title = `Not in the library: ${unknown.join(', ')}`;
          } else dom.classList.add(`${ID}-plain`);
          return;
        }
        void loadFormat().then(({ sanitize }) => {
          if (mine !== seq) return;
          dom.replaceChildren(sanitize(f!.citation(c)));
          if (unknown.length) {
            dom.classList.add(`${ID}-partial`);
            dom.title = `Not in the library: ${unknown.join(', ')}`;
          }
        });
      });
    };
    const st = this.state(m.note.path);
    st.views.add(draw);
    draw();
    return {
      dom,
      update: (next) => {
        m = next;
        draw();
        return true;
      },
      dispose: () => st.views.delete(draw),
    };
  }

  private hover(m: InlineMatch, card: HTMLElement): void {
    const c = parseCitation(m.text);
    if (!c) return;
    const box = el('div', 'card');
    card.append(box);
    void this.formatter(m.note).then(async ({ items, errors, files }) => {
      if (!files.length) {
        box.append(
          el(
            'p',
            'card-note',
            'No library is set. Choose a .bib or CSL-JSON file in Settings > Plugins > Citations.',
          ),
        );
        return;
      }
      for (const it of c.items) {
        const item = items.get(it.key);
        const entry = el('div', 'card-entry');
        if (!item) {
          entry.append(el('p', 'card-note', `@${it.key} is not in ${files.join(', ')}.`));
          box.append(entry);
          continue;
        }
        const people = (item.author ?? item.editor ?? []).map(nameText).join('; ');
        if (people) entry.append(el('p', 'card-authors', people));
        entry.append(el('p', 'card-title', item.title ?? it.key));
        const venue = [item['container-title'] ?? item.publisher, year(item)].filter(Boolean).join(', ');
        if (venue) entry.append(el('p', 'card-venue', venue));
        const link = item.DOI ? `https://doi.org/${item.DOI}` : item.URL;
        if (link) {
          const a = el('a', 'card-link', item.DOI ? `doi:${item.DOI}` : link);
          a.href = link;
          a.target = '_blank';
          a.rel = 'noreferrer';
          entry.append(a);
        }
        const cited = await this.citedIn(it.key, m.note);
        if (cited) entry.append(el('p', 'card-cited', cited));
        box.append(entry);
      }
      for (const e of errors) box.append(el('p', 'card-note', e));
    });
  }

  /** "Cited in 3 notes in this Vault: A, B, C", from the index. */
  private async citedIn(key: string, note: NoteRef): Promise<string | null> {
    try {
      const recs = await this.ctx.index.query({
        extractor: 'keys',
        key,
        ...(note.vaultPath ? { scope: { kind: 'vault' as const, vaultPath: note.vaultPath } } : {}),
        limit: 500,
      });
      const paths = [...new Set(recs.map((r) => r.path))];
      if (!paths.length) return null;
      const names = paths.slice(0, 4).map((p) => p.split('/').pop()!.replace(/\.md$/i, ''));
      const more = paths.length > 4 ? ` and ${paths.length - 4} more` : '';
      const where = note.vaultPath ? ' in this Vault' : '';
      return `Cited in ${paths.length} ${paths.length === 1 ? 'note' : 'notes'}${where}: ${names.join(', ')}${more}`;
    } catch {
      return null;
    }
  }

  // ---- Reference list -----------------------------------------------------------

  private async bibliography(target: HTMLElement, note: NoteRef, signal: AbortSignal): Promise<BlockView> {
    const box = el('div', 'bibliography');
    target.append(box);
    let seq = 0;
    const draw = async () => {
      const mine = ++seq;
      const { f, errors, files } = await this.formatter(note);
      if (mine !== seq) return;
      const st = this.state(note.path);
      box.replaceChildren();
      if (!files.length) {
        box.append(
          el(
            'p',
            'empty',
            'No library is set: choose a .bib or CSL-JSON file in Settings > Plugins > Citations.',
          ),
        );
        return;
      }
      f?.setOrder(st.order);
      const entries = f?.bibliography() ?? [];
      if (!entries.length) box.append(el('p', 'empty', 'No references cited in this note yet.'));
      else {
        const { sanitize } = await loadFormat();
        if (mine !== seq) return;
        const list = el('div', `list ${this.style}`);
        for (const html of entries) list.append(sanitize(html));
        box.append(list);
      }
      const missing = keysInOrder(st.text ?? '', { bracketedOnly: true }).filter((k) => !f?.has(k));
      if (missing.length)
        box.append(el('p', 'empty', `Not in the library: ${missing.map((k) => `@${k}`).join(', ')}`));
      for (const e of errors) box.append(el('p', 'empty', e));
    };
    const st = this.state(note.path);
    const redraw = () => void draw();
    st.views.add(redraw);
    signal.addEventListener('abort', () => st.views.delete(redraw));
    await draw();
    return { dispose: () => st.views.delete(redraw) };
  }
}

function nameText(n: CslName): string {
  if (n.literal) return n.literal;
  return [[n['non-dropping-particle'], n.family].filter(Boolean).join(' '), n.given]
    .filter(Boolean)
    .join(', ');
}

function year(item: CslItem): string {
  return String(item.issued?.['date-parts']?.[0]?.[0] ?? item.issued?.literal ?? '');
}

const factory: PluginFactory = () => new Citations();
export default factory;
