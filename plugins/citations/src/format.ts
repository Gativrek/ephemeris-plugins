/**
 * Formatting with citeproc-js and the bundled CSL styles (SPECS 13.5). This module and its
 * imports load on first use, in their own chunk. One engine per note, so numeric styles
 * number references in the order the note first cites them.
 */
import CSL, { type CitationItem, type Engine } from 'citeproc';
import abnt from '../csl/associacao-brasileira-de-normas-tecnicas.csl';
import ieee from '../csl/ieee.csl';
import enUS from '../csl/locales-en-US.xml';
import ptBR from '../csl/locales-pt-BR.xml';
import type { CslItem } from './bib';
import type { CiteItem, Citation } from './cite';

export type StyleId = 'ieee' | 'abnt';
export type LocaleId = 'auto' | 'en-US' | 'pt-BR';

export const STYLES: Record<StyleId, { xml: string; lang: 'en-US' | 'pt-BR'; numeric: boolean }> = {
  ieee: { xml: ieee, lang: 'en-US', numeric: true },
  abnt: { xml: abnt, lang: 'pt-BR', numeric: false },
};
const LOCALES: Record<string, string> = { 'en-US': enUS, 'pt-BR': ptBR };

/** Only the markup citeproc writes survives: no scripts, handlers or styles from library data. */
const TAGS = new Set(['I', 'B', 'EM', 'STRONG', 'SUP', 'SUB', 'SPAN', 'DIV', 'A', 'BR']);
export function sanitize(html: string): DocumentFragment {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      if (!TAGS.has(child.tagName)) {
        child.replaceWith(document.createTextNode(child.textContent ?? ''));
        continue;
      }
      for (const a of [...child.attributes]) {
        const keep = a.name === 'class' || (a.name === 'href' && /^(https?:|doi:)/i.test(a.value));
        if (!keep) child.removeAttribute(a.name);
      }
      if (child.tagName === 'A') {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noreferrer');
      }
      walk(child);
    }
  };
  walk(tpl.content as unknown as Element);
  return tpl.content;
}

export class Formatter {
  private engine: Engine;
  private order: string[] = [];

  constructor(
    readonly style: StyleId,
    readonly locale: LocaleId,
    private readonly items: Map<string, CslItem>,
  ) {
    const s = STYLES[style];
    const lang = locale === 'auto' ? s.lang : locale;
    this.engine = new CSL.Engine(
      {
        retrieveLocale: (l) => LOCALES[l] ?? LOCALES[lang] ?? enUS,
        retrieveItem: (id) => {
          const item = this.items.get(id);
          // ABNT prints the event and the proceedings; when one stands in for the other, once.
          if (
            style === 'abnt' &&
            item &&
            item['event-title'] &&
            item['event-title'] === item['container-title']
          ) {
            const { 'container-title': _same, ...rest } = item;
            return rest;
          }
          return item;
        },
      },
      s.xml,
      lang,
      locale !== 'auto',
    );
    this.engine.setOutputFormat('html');
  }

  get lang(): 'en-US' | 'pt-BR' {
    return this.locale === 'auto' ? STYLES[this.style].lang : this.locale;
  }

  /** Registers the note's cited keys in order; unknown keys are skipped. */
  setOrder(keys: string[]): void {
    const known = keys.filter((k) => this.items.has(k));
    if (known.join('\n') === this.order.join('\n')) return;
    this.order = known;
    this.engine.updateItems(known);
  }

  has(key: string): boolean {
    return this.items.has(key);
  }

  /** "[3]", "[3, p. 45]", "(GROVES, 2013)", or a narrative "Groves [3]". Unknown keys must be left out first. */
  citation(c: Citation): string {
    const items = c.items.filter((it) => this.items.has(it.key));
    if (!items.length) return '';
    for (const it of items) if (!this.order.includes(it.key)) this.setOrder([...this.order, it.key]);
    const cite = (it: CiteItem, extra: Partial<CitationItem> = {}): CitationItem => ({
      id: it.key,
      ...(it.locator ? { locator: it.locator, label: it.label ?? 'page' } : {}),
      ...(it.prefix ? { prefix: `${it.prefix} ` } : {}),
      ...(it.suffix ? { suffix: it.suffix.startsWith(',') ? it.suffix : ` ${it.suffix.trim()}` } : {}),
      ...(it.suppressAuthor ? { 'suppress-author': true } : {}),
      ...extra,
    });
    if (!c.narrative) return this.engine.makeCitationCluster(items.map((it) => cite(it)));
    // Narrative: the author in running text, then the citation without the author.
    const it = items[0]!;
    const rest = STYLES[this.style].numeric
      ? this.engine.makeCitationCluster([cite(it)])
      : this.engine.makeCitationCluster([cite(it, { 'suppress-author': true })]);
    return `${escapeHtml(authorsInText(this.items.get(it.key)!, this.lang))} ${rest}`;
  }

  /** The reference list of the registered keys, in the style's order, as HTML entries. */
  bibliography(): string[] {
    if (!this.order.length) return [];
    const out = this.engine.makeBibliography();
    return out ? out[1] : [];
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "Groves", "Groves and Smith", "Groves et al." (pt-BR: "e"), from the authors or editors. */
export function authorsInText(item: CslItem, lang: 'en-US' | 'pt-BR'): string {
  const names = (item.author ?? item.editor ?? []).map(
    (n) => n.literal ?? [n['non-dropping-particle'], n.family].filter(Boolean).join(' '),
  );
  if (!names.length) return item.title ?? item.id;
  const and = lang === 'pt-BR' ? 'e' : 'and';
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} ${and} ${names[1]}`;
  return `${names[0]} et al.`;
}
