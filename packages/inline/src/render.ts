/**
 * Task and card text as inline Markdown: links (wikilinks and Markdown links to notes, which
 * open the note), code, bold, italic and strikethrough; and due-date chips. Blocks have no
 * core Markdown renderer (only views do), so one renderer keeps blocks and views alike.
 * Classes take the plugin's prefix (SPECS 12.2): `<prefix>-link`, `<prefix>-due`.
 */
import { dueState, formatDue } from './dates';

const INLINE =
  /`([^`\n]+)`|\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|~~([^~\n]+)~~|(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*])|(?<![\w_])_([^_\s][^_\n]*?)_(?![\w_])/g;

/** Appends `text` to `parent`; `openLink` gets a link's target as written, e.g. "Note#Heading". */
export function renderInline(
  parent: HTMLElement,
  text: string,
  openLink: (target: string) => void,
  prefix: string,
): void {
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) parent.append(text.slice(at, m.index));
    at = m.index + m[0].length;
    const [, code, wiki, alias, mdText, mdTarget, bold, strike, star, under] = m;
    if (code !== undefined) parent.append(node('code', code));
    else if (wiki !== undefined) parent.append(link(alias ?? wiki, wiki, openLink, prefix));
    else if (mdText !== undefined && mdTarget !== undefined) {
      // Web links stay text: plugins cannot open the browser.
      if (/^[a-z][a-z0-9+.-]*:/i.test(mdTarget)) {
        const span = node('span', mdText);
        span.title = mdTarget;
        parent.append(span);
      } else parent.append(link(mdText, decodeURI(mdTarget), openLink, prefix));
    } else if (bold !== undefined) parent.append(node('strong', bold));
    else if (strike !== undefined) parent.append(node('s', strike));
    else parent.append(node('em', star ?? under ?? ''));
  }
  if (at < text.length) parent.append(text.slice(at));
}

/** The due date as a chip: "Overdue · 1 Nov", "Today" or "10 Nov" (text, not colour alone). */
export function dueChip(due: string, today: string, prefix: string): HTMLElement {
  const state = dueState(due, today);
  const date = formatDue(due, today);
  const chip = node('span', state === 'overdue' ? `Overdue · ${date}` : state === 'today' ? 'Today' : date);
  chip.className = `${prefix}-due is-${state}`;
  chip.title = `Due ${due}`;
  return chip;
}

function node(tag: string, text: string): HTMLElement {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}

function link(
  label: string,
  target: string,
  openLink: (target: string) => void,
  prefix: string,
): HTMLElement {
  const a = document.createElement('button');
  a.type = 'button';
  a.className = `${prefix}-link`;
  a.textContent = label;
  a.title = target;
  a.addEventListener('click', (e) => {
    e.stopPropagation();
    openLink(target);
  });
  return a;
}
