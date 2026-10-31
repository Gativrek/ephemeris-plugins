/**
 * Flashcards (SPECS 13.6): cards in notes that opt in with `flashcards: true`, scheduled
 * with FSRS, reviewed in a desk view. Review state is kept in the Vault's plugin storage,
 * never in the notes; the one note edit is a card's block ID on its first review.
 */
import type { Plugin, PluginContext, PluginFactory } from '@ephemeris-notes/plugin-api';
import { CARD_LINE, optedIn } from './cards';
import { HELP } from './help';
import { renderReview, scopeTitle, type ReviewState } from './review';

const CLOZE = /\{\{([^{}\n]+?)\}\}/g;

class Flashcards implements Plugin {
  onload(ctx: PluginContext): void {
    ctx.settings.register({
      fields: [
        {
          key: 'newPerDay',
          type: 'number',
          label: 'New cards per day',
          default: 20,
          min: 0,
          max: 500,
          step: 5,
        },
        {
          key: 'retention',
          type: 'select',
          label: 'Target retention',
          default: '0.9',
          options: [
            { value: '0.85', label: '85% (fewer reviews)' },
            { value: '0.9', label: '90% (recommended)' },
            { value: '0.95', label: '95% (more reviews)' },
          ],
        },
      ],
    });

    // Card lines across the Vault, from notes that opt in: the review view starts from these.
    ctx.index.registerExtractor({
      id: 'cards',
      version: 1,
      kind: 'regex',
      pattern: CARD_LINE,
      key: 1,
      where: { frontmatter: { flashcards: true } },
    });

    ctx.views.register('review', {
      title: (state) => scopeTitle(state as ReviewState),
      icon: 'reading',
      render: (root, state, host) => renderReview(ctx, root, state as ReviewState, host),
    });

    ctx.commands.register({
      id: 'review-vault',
      title: 'Review Due Cards (This Vault)',
      run: () => {
        const vaultPath = ctx.editor.activeNote()?.vaultPath;
        if (!vaultPath) return ctx.ui.notify('Open a note in a Vault first: the review covers that Vault.');
        void ctx.views.open('review', { key: vaultPath, state: { vaultPath } satisfies ReviewState });
      },
    });
    ctx.commands.register({
      id: 'review-note',
      title: 'Review Cards in This Note',
      run: () => {
        const note = ctx.editor.activeNote();
        if (!note?.vaultPath) return ctx.ui.notify('Open a note in a Vault first.');
        if (!optedIn(note.frontmatter))
          return ctx.ui.notify('This note has no flashcards: add "flashcards: true" to its frontmatter.');
        void ctx.views.open('review', {
          key: note.path,
          state: { vaultPath: note.vaultPath, notePath: note.path } satisfies ReviewState,
        });
      },
    });

    // In notes with cards, a cloze shows as its hidden text, marked; the braces come back with the cursor.
    ctx.inline.register({
      id: 'cloze',
      match: CLOZE,
      accept: (m) => optedIn(m.note.frontmatter),
      widget: (m) => {
        const span = document.createElement('span');
        span.className = 'flashcards-cloze';
        span.textContent = m.groups[1] ?? '';
        span.title = 'A flashcard cloze';
        return span;
      },
    });

    ctx.help.register([{ id: 'guide', title: 'Flashcards guide', markdown: HELP }]);
  }
}

const factory: PluginFactory = () => new Flashcards();
export default factory;
