/** Contract test for the Kanban plugin (SPECS 13.10). Needs an app with plugin API 1.4.0. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installPlugin, launchWithLibrary, type Launched } from './app';

const NOTE_PATH = 'Academic/GNSS Study/Notes/Board.md';
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const NOTE = () =>
  [
    '---',
    'kanban: true',
    '---',
    'Intro paragraph, not on the board.',
    '',
    '## To do',
    `- [ ] Alpha card due:${today()}`,
    '- [ ] Beta card',
    '  - beta detail',
    '',
    '## Doing',
    '- [ ] Gamma card',
    '',
    '## Done',
    '',
  ].join('\n');

let ctx: Launched;
const file = () => path.join(ctx.lib, ...NOTE_PATH.split('/'));
const note = () => readFile(file(), 'utf8');

test.beforeEach(async () => {
  ctx = await launchWithLibrary(async (lib) => {
    await writeFile(path.join(lib, ...NOTE_PATH.split('/')), NOTE());
  });
  await installPlugin(ctx, 'kanban', 'Kanban');
  const { page } = ctx;
  await page.getByTestId('section-tile').filter({ hasText: 'Notes' }).click();
  await page.getByTestId('tree').getByRole('treeitem', { name: 'Board', exact: true }).click();
  await page.locator('.kanban-footer-open').click();
  await expect(page.locator('.kanban-view .kanban-title')).toHaveText('Board');
});

test.afterEach(async () => {
  await ctx.close();
});

const lane = (page: Page, title: string) =>
  page.locator('.kanban-lane', { has: page.locator('.kanban-lane-title', { hasText: title }) });
const cards = (page: Page, title: string) => lane(page, title).locator('.kanban-card .kanban-text');
const card = (page: Page, text: string) => page.locator('.kanban-card', { hasText: text });

test('the board shows the note; cards move by drag and by keys, are added and ticked', async () => {
  const { page } = ctx;
  await expect(cards(page, 'To do')).toHaveText(['Alpha card', 'Beta card']);
  await expect(cards(page, 'Doing')).toHaveText(['Gamma card']);
  await expect(cards(page, 'Done')).toHaveCount(0);
  await expect(card(page, 'Alpha').locator('.kanban-due')).toHaveText('Today');
  await expect(card(page, 'Beta').locator('.kanban-extra')).toHaveText('+1 line');

  // Drag Beta below Gamma: its indented line goes with it.
  const gamma = card(page, 'Gamma');
  const box = (await gamma.boundingBox())!;
  await card(page, 'Beta').dragTo(gamma, { targetPosition: { x: 20, y: box.height - 3 } });
  await expect(cards(page, 'Doing')).toHaveText(['Gamma card', 'Beta card']);
  await expect.poll(note).toContain('## Doing\n- [ ] Gamma card\n- [ ] Beta card\n  - beta detail\n');

  // Alt+Right moves Alpha to Doing; the focus follows it.
  await card(page, 'Alpha').focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(cards(page, 'Doing')).toHaveText(['Alpha card', 'Gamma card', 'Beta card']);
  await expect(card(page, 'Alpha')).toBeFocused();
  // Alt+Down moves it within the column.
  await page.keyboard.press('Alt+ArrowDown');
  await expect(cards(page, 'Doing')).toHaveText(['Gamma card', 'Alpha card', 'Beta card']);
  await expect(cards(page, 'To do')).toHaveCount(0);

  // Add a card to the empty Done column, then tick Gamma: it stays where it is.
  await lane(page, 'Done').getByRole('button', { name: '+ Add a card' }).click();
  await page.keyboard.type('Delta card');
  await page.keyboard.press('Enter');
  await expect(cards(page, 'Done')).toHaveText(['Delta card']);
  await card(page, 'Gamma').getByRole('checkbox').check();
  await expect(card(page, 'Gamma')).toHaveClass(/is-done/);
  await expect(cards(page, 'Doing').first()).toHaveText('Gamma card');

  const text = await note();
  expect(text).toContain('## Done\n- [ ] Delta card\n');
  expect(text).toContain('- [x] Gamma card');
  expect(text).toContain('Intro paragraph, not on the board.');
  // Nothing but the moves, the addition and the tick changed.
  expect(
    text
      .split('\n')
      .filter((l) => l !== '- [ ] Delta card')
      .map((l) => l.replace('[x] Gamma', '[ ] Gamma'))
      .sort(),
  ).toEqual(NOTE().split('\n').sort());
});

test('a move lands right when the note changed meanwhile; cards open the note; the board follows it', async () => {
  const { page } = ctx;
  await expect(cards(page, 'To do')).toHaveText(['Alpha card', 'Beta card']);

  // The note changes on disk; the move still finds Beta.
  await writeFile(file(), NOTE().replace('Intro paragraph', 'A new line.\n\nIntro paragraph'));
  await card(page, 'Beta').focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(note).toContain('## Doing\n- [ ] Gamma card\n- [ ] Beta card\n  - beta detail\n');
  expect(await note()).toContain('A new line.\n\nIntro paragraph');

  // A card opens the note at its line.
  await card(page, 'Gamma').locator('.kanban-text').click();
  await expect(
    page
      .getByTestId('desk-card')
      .filter({ hasText: /^Board/ })
      .first(),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const n = document.getSelection()?.anchorNode;
        const e = n instanceof Element ? n : n?.parentElement;
        return e?.closest('.cm-line')?.textContent ?? '';
      }),
    )
    .toContain('Gamma card');

  // An edit outside the board shows on it.
  await writeFile(file(), (await note()).replace('## Done\n', '## Done\n- [ ] Epsilon card\n'));
  await page.getByTestId('desk-card').filter({ hasText: 'Board: Board' }).click();
  await expect(cards(page, 'Done')).toHaveText(['Epsilon card']);
});
