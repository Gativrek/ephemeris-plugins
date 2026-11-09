/** Contract test for the Script timer plugin (SPECS 13.9). */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installPlugin, launchWithLibrary, type Launched } from './app';

const NOTES = 'Academic/GNSS Study/Notes';
const words = (n: number, prefix = 'w') => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');

// At 120 wpm: Intro 120 + Part A 60 = 1:30, Part A 0:30, Outro 30 = 0:15; 210 words, 1:45.
const NOTE = [
  '---',
  'script: true',
  'wpm: 120',
  '---',
  '# Intro',
  words(120),
  '',
  '## Part A',
  words(60),
  '',
  '> B-roll: the orbit animation, not narrated',
  '',
  '# Outro',
  words(30, 'o'),
  '',
].join('\n');

let ctx: Launched;

test.beforeEach(async () => {
  ctx = await launchWithLibrary(async (lib) => {
    await writeFile(path.join(lib, ...NOTES.split('/'), 'Script.md'), NOTE);
  });
  await installPlugin(ctx, 'script-timer', 'Script timer');
});

test.afterEach(async () => {
  await ctx.close();
});

async function open(page: Page, name: string): Promise<void> {
  await page.getByTestId('section-tile').filter({ hasText: 'Notes' }).click();
  await page.getByTestId('tree').getByRole('treeitem', { name, exact: true }).click();
  await expect(page.getByTestId('desk-card').filter({ hasText: name })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // Below 1440px the outline starts collapsed.
  if ((await page.locator('.vx-outline-wrap').count()) === 0)
    await page.keyboard.press('ControlOrMeta+Shift+O');
  await expect(page.locator('.vx-outline-wrap')).toHaveCount(1);
}

const entries = (page: Page) => page.locator('[data-plugin="script-timer"].vx-outline__item--plugin');
const footer = (page: Page) =>
  page.locator('.vx-plugin-footer[data-plugin="script-timer"] .script-timer-footer');

test('a script note shows its sections and total, following typing; other notes do not', async () => {
  const { page } = ctx;
  await open(page, 'Script');
  await expect(entries(page)).toHaveText([/1:30/, /0:30/, /0:15/]);
  await expect(footer(page)).toHaveText('Script: 210 words · 1:45 at 120 wpm');

  // 12 more words under Outro: 42 words, 0:21; 222 words, 1:51.
  await page.locator('.vx-editor .cm-line', { hasText: 'o29' }).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(` ${words(12, 'x')}`);
  await expect(entries(page)).toHaveText([/1:30/, /0:30/, /0:21/]);
  await expect(footer(page)).toHaveText('Script: 222 words · 1:51 at 120 wpm');

  await open(page, 'Intro');
  await expect(entries(page)).toHaveCount(0);
  await expect(page.locator('.script-timer-footer')).toHaveCount(0);
});
