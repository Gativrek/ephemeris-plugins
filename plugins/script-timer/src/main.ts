/**
 * Script timer (SPECS 13.9): in notes with `script: true`, the narration time of each
 * heading's section in the outline, and the note's total in its footer. Reads only.
 */
import type { Plugin, PluginContext, PluginFactory } from '@ephemeris-notes/plugin-api';
import { formatDuration, sectionWords, wordsPerLine } from './count';
import { HELP } from './help';

const RATE = { default: 150, min: 60, max: 400 };

interface Count {
  text: string;
  wpm: number;
  words: number;
  /** Per heading, in the outline's order. */
  sections: number[];
}

class ScriptTimer implements Plugin {
  /** The latest count per note, and the footer showing it. */
  private counts = new Map<string, Count>();
  private footers = new Map<string, HTMLElement>();

  onload(ctx: PluginContext): void {
    ctx.settings.register({
      fields: [
        {
          key: 'wpm',
          type: 'number',
          label: 'Speaking rate (words per minute)',
          default: RATE.default,
          min: RATE.min,
          max: RATE.max,
          step: 5,
        },
      ],
    });
    const rate = (frontmatter: Readonly<Record<string, unknown>>): number => {
      for (const v of [frontmatter.wpm, ctx.settings.get('wpm')]) {
        const n = Number(v);
        if (v !== undefined && v !== null && v !== '' && Number.isFinite(n) && n >= RATE.min && n <= RATE.max)
          return n;
      }
      return RATE.default;
    };

    ctx.outline.contribute(({ note, text, headings }) => {
      if (note.frontmatter.script !== true) return [];
      const wpm = rate(note.frontmatter);
      let count = this.counts.get(note.path);
      if (!count || count.text !== text || count.wpm !== wpm) {
        const perLine = wordsPerLine(text, new Set(headings.map((h) => h.line)));
        count = {
          text,
          wpm,
          words: perLine.reduce((a, b) => a + b, 0),
          sections: sectionWords(perLine, headings),
        };
        this.counts.set(note.path, count);
        this.fillFooter(note.path);
      }
      const c = count;
      return headings.map((h, k) => ({
        line: h.line,
        label: formatDuration(c.sections[k] ?? 0, wpm),
        glyph: '◷',
      }));
    });

    ctx.footers.register({
      id: 'total',
      render: (el, note, host) => {
        if (note.frontmatter.script !== true) return;
        const p = document.createElement('p');
        p.className = 'script-timer-footer';
        el.append(p);
        this.footers.set(note.path, p);
        this.fillFooter(note.path);
        host.signal.addEventListener('abort', () => {
          if (this.footers.get(note.path) === p) this.footers.delete(note.path);
        });
      },
    });

    ctx.help.register([{ id: 'guide', title: 'Script timer guide', markdown: HELP }]);
  }

  private fillFooter(path: string): void {
    const p = this.footers.get(path);
    const c = this.counts.get(path);
    if (!p || !c) return;
    p.textContent = `Script: ${c.words.toLocaleString()} ${c.words === 1 ? 'word' : 'words'} · ${formatDuration(c.words, c.wpm)} at ${c.wpm} wpm`;
  }

  onunload(): void {
    this.counts.clear();
    this.footers.clear();
  }
}

const factory: PluginFactory = () => new ScriptTimer();
export default factory;
