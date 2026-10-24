/**
 * DOM for a combo block: one row per line, chunks with a small gap, tokens as images or
 * text. Every piece carries its source in `data-source`, and a selection inside the
 * block copies that notation (SPECS 13.2), since browsers do not reliably copy `alt`.
 */
import type { Profile } from './profile';
import { strings } from './strings';
import type { Row } from './tokenize';

const ID = 'text-to-image';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = `${ID}-${cls}`;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A token whose image file is missing reads as its notation, marked like unknown text. */
function brokenImage(source: string, path: string): HTMLElement {
  const span = el('span', 'unknown', source);
  span.title = strings.missingImage(path);
  span.dataset.source = source;
  return span;
}

export interface ImageSource {
  /** For `<img>`. */
  url(path: string): string;
  /** A `data:` URL for CSS masks, or null when the file is missing. */
  mask(path: string): Promise<string | null>;
}

function image(
  source: string,
  alt: string,
  path: string,
  images: ImageSource,
  monochrome: boolean,
): HTMLElement {
  if (!monochrome) {
    const img = el('img', 'img');
    img.alt = alt;
    img.src = images.url(path);
    img.draggable = false;
    img.dataset.source = source;
    img.addEventListener('error', () => img.replaceWith(brokenImage(source, path)), { once: true });
    return img;
  }
  // Monochrome: the image is a mask over the text colour, so it follows the theme.
  const glyph = el('span', 'glyph');
  glyph.setAttribute('role', 'img');
  glyph.setAttribute('aria-label', alt);
  glyph.dataset.source = source;
  void images.mask(path).then((url) => {
    if (!url) {
      glyph.replaceWith(brokenImage(source, path));
      return;
    }
    const css = `url("${url}")`;
    glyph.style.setProperty('-webkit-mask-image', css);
    glyph.style.setProperty('mask-image', css);
    const probe = new Image();
    probe.addEventListener('load', () => {
      if (probe.naturalWidth && probe.naturalHeight)
        glyph.style.aspectRatio = `${probe.naturalWidth} / ${probe.naturalHeight}`;
    });
    probe.addEventListener('error', () => glyph.replaceWith(brokenImage(source, path)));
    probe.src = url;
  });
  return glyph;
}

export function renderRows(
  target: HTMLElement,
  rows: Row[],
  profile: Profile,
  images: ImageSource,
): HTMLElement {
  const root = el('div', 'combo');
  root.style.setProperty(`--${ID}-height`, profile.imageHeight);
  for (const row of rows) {
    const line = el('div', 'row');
    for (const chunk of row) {
      const c = el('span', 'chunk');
      for (const piece of chunk) {
        let node: HTMLElement;
        if (piece.kind === 'unknown') {
          node = el('span', 'unknown', piece.source);
          node.title = strings.unknown(profile.id);
        } else if (piece.entry.kind === 'text') {
          node = el('span', 'text', piece.entry.text);
          node.title = piece.entry.alt;
        } else if (piece.entry.kind === 'none') {
          node = el('span', 'none');
          node.setAttribute('aria-hidden', 'true');
        } else {
          node = image(piece.source, piece.entry.alt, piece.entry.image, images, profile.monochrome);
        }
        node.dataset.source = piece.source;
        c.append(node);
      }
      line.append(c);
    }
    root.append(line);
  }
  root.addEventListener('copy', (e) => copyNotation(e, root));
  target.append(root);
  return root;
}

function copyNotation(e: ClipboardEvent, root: HTMLElement): void {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || !e.clipboardData) return;
  const rows: string[] = [];
  for (const row of root.querySelectorAll(`.${ID}-row`)) {
    const chunks: string[] = [];
    for (const chunk of row.querySelectorAll(`.${ID}-chunk`)) {
      const pieces = [...chunk.querySelectorAll<HTMLElement>('[data-source]')];
      const picked = pieces.map((p) => sel.containsNode(p, true));
      // Undrawn tokens (render: none) take no space, so they go with a selected neighbour.
      pieces.forEach((p, i) => {
        if (p.classList.contains(`${ID}-none`)) picked[i] = !!(picked[i + 1] ?? picked[i - 1]);
      });
      const text = pieces
        .filter((_, i) => picked[i])
        .map((p) => p.dataset.source)
        .join('');
      if (text) chunks.push(text);
    }
    if (chunks.length) rows.push(chunks.join(' '));
  }
  if (!rows.length) return;
  e.clipboardData.setData('text/plain', rows.join('\n'));
  e.preventDefault();
  e.stopPropagation();
}

/** Display mode "Notation text", and the plain notation under a notice. */
export function renderSource(target: HTMLElement, source: string): HTMLElement {
  const lines = source.split('\n');
  while (lines.length && !lines[0]!.trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  const pre = el('div', 'source', lines.join('\n'));
  target.append(pre);
  return pre;
}

export function renderNotice(target: HTMLElement, message: string, source: string): void {
  target.append(el('p', 'notice', message));
  renderSource(target, source);
}
