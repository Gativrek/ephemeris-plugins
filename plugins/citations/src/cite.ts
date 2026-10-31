/**
 * Pandoc citation syntax (SPECS 13.5): `[@key]`, `[@key, p. 45]`, `[see @a; -@b]` and
 * narrative `@key`. `@eq:`, `@fig:` and `@tbl:` are core cross-references and never
 * citations. Keys follow Pandoc: a letter, digit or `_`, then those and internal
 * punctuation `:.#$%&-+?<>~/`.
 */

export interface CiteItem {
  key: string;
  prefix: string;
  suffix: string;
  /** A CSL locator label (page, chapter…) and its value, from a suffix like ", p. 45". */
  label?: string;
  locator?: string;
  /** `-@key`: the author is left out ("Groves says [3]"). */
  suppressAuthor: boolean;
}

export interface Citation {
  /** `@key` in running text, rather than `[@key]`. */
  narrative: boolean;
  items: CiteItem[];
}

const KEY = String.raw`[A-Za-z0-9_](?:[\w:.#$%&+?<>~/-]*[A-Za-z0-9_])?`;
/** Core cross-references, never offered as citations. */
const CROSSREF = /^(eq|fig|tbl):/i;

/**
 * One pattern for both forms, so a bracketed citation is never also read as narrative.
 * A bracket followed by `(` or `[` is a Markdown link, not a citation.
 */
export const CITATION = new RegExp(
  String.raw`(?<br>\[[^\[\]\n]*?-?@${KEY}[^\[\]\n]*\](?![(\[]))|(?<![\w@\[\]-])@(?<nar>${KEY})`,
  'g',
);

/** Keys anywhere in text, in order, for the index extractor and note-wide numbering. */
export const KEY_ANYWHERE = String.raw`(?<![\w@])-?@(${KEY})`;

const LABELS: Array<[RegExp, string]> = [
  [/^(pp?\.?|pages?)$/i, 'page'],
  [/^(chaps?\.?|ch\.?|chapters?|cap\.?)$/i, 'chapter'],
  [/^(secs?\.?|sections?|§+|seç\.?)$/i, 'section'],
  [/^(figs?\.?|figures?)$/i, 'figure'],
  [/^(vols?\.?|volumes?|v\.)$/i, 'volume'],
  [/^(paras?\.?|paragraphs?|¶+)$/i, 'paragraph'],
  [/^(l{1,2}\.?|lines?)$/i, 'line'],
  [/^(nn?\.?|notes?)$/i, 'note'],
  [/^(cols?\.?|columns?)$/i, 'column'],
];

/** ", p. 45", ", 45-47" or ", ch. 3": a locator; anything else stays suffix text. */
function locator(suffix: string): Pick<CiteItem, 'label' | 'locator' | 'suffix'> {
  const m = /^\s*,\s*(?:([^\s\d][^\s\d]*)\s*)?(\d[\w–—-]*(?:\s*[-–—,]\s*\d[\w–—-]*)*)(.*)$/su.exec(suffix);
  if (!m) return { suffix: suffix.trim() ? suffix.trimEnd() : '' };
  const word = m[1];
  let label = 'page';
  if (word) {
    const hit = LABELS.find(([re]) => re.test(word));
    if (!hit) return { suffix };
    label = hit[1];
  }
  return { label, locator: m[2]!.trim(), suffix: m[3]!.trim() ? m[3]! : '' };
}

/** The citation in a match of CITATION, or null when it is not one (a cross-reference, a stray @). */
export function parseCitation(text: string): Citation | null {
  if (!text.startsWith('[')) {
    const key = text.slice(1);
    return CROSSREF.test(key)
      ? null
      : { narrative: true, items: [{ key, prefix: '', suffix: '', suppressAuthor: false }] };
  }
  const items: CiteItem[] = [];
  for (const part of text.slice(1, -1).split(';')) {
    const m = new RegExp(String.raw`^(.*?)(-?)@(${KEY})(.*)$`, 's').exec(part);
    if (!m) return null;
    const [, before = '', dash = '', key = '', after = ''] = m;
    // The @ must start a word: "me@example.com" is not a citation.
    if (/[\w@]$/.test(before) || CROSSREF.test(key)) return null;
    items.push({ key, prefix: before.trim(), suppressAuthor: dash === '-', ...locator(after) });
  }
  return items.length ? { narrative: false, items } : null;
}

/** Every cited key in note text, in order of first appearance, skipping code, math and cross-references. */
export function keysInOrder(text: string, opts: { bracketedOnly?: boolean } = {}): string[] {
  const plain = text
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '')
    .replace(/\$\$[\s\S]*?\$\$/g, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/^---\n[\s\S]*?\n---\n/, '');
  const seen = new Set<string>();
  for (const m of plain.matchAll(new RegExp(CITATION.source, 'g'))) {
    const c = parseCitation(m[0]);
    // A narrative @word that is not a key is just text, so it is never "missing".
    if (c && !(opts.bracketedOnly && c.narrative)) for (const it of c.items) seen.add(it.key);
  }
  return [...seen];
}
