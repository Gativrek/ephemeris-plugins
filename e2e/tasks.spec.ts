/** Contract test for the Tasks plugin (SPECS 13.7). Needs an app with plugin API 1.4.0. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installPlugin, launchWithLibrary, runCommand, type Launched } from './app';

const NOTES = 'Academic/GNSS Study/Notes';

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let ctx: Launched;
const file = (rel: string) => path.join(ctx.lib, ...rel.split('/'));

test.beforeEach(async () => {
  ctx = await launchWithLibrary(async (lib) => {
    const put = (name: string, text: string) => writeFile(path.join(lib, ...NOTES.split('/'), name), text);
    await put(
      'Tasks A.md',
      `# A\n\n- [ ] Pay the [[Intro]] invoice due:${day(-2)} #work\n- [x] Old done task\n- [ ] Undated A task\n`,
    );
    await put(
      'Tasks B.md',
      `# B\n\nSome text due:${day(0)} that is not a task.\n\n- [ ] Call the lab due:${day(0)}\n1. [ ] Later B task due:${day(20)} #home\n`,
    );
    await put('Tasks C.md', '# C\n\n- [ ] Third note task\n\n```\n- [ ] in code, not a task\n```\n');
    await put(
      'Task Board.md',
      '# Board\n\n```tasks\n```\n\n```tasks\ndue: overdue\nwhen: soon\n```\n\nEnd.\n',
    );
  });
  await installPlugin(ctx, 'tasks', 'Tasks');
});

test.afterEach(async () => {
  await ctx.close();
});

async function openNote(page: Page, name: string): Promise<void> {
  await page.getByTestId('section-tile').filter({ hasText: 'Notes' }).click();
  await page.getByTestId('tree').getByRole('treeitem', { name, exact: true }).first().click();
  await expect(page.getByTestId('desk-card').filter({ hasText: name })).toHaveCount(1);
  await expect(page.locator('.vx-editor .cm-content')).toBeVisible();
}

const rowTexts = (scope: ReturnType<Page['locator']>) => scope.locator('.tasks-row .tasks-text');

test('a tasks block lists open tasks across notes, earliest due first; a bad key is named', async () => {
  const { page } = ctx;
  await openNote(page, 'Task Board');
  const [all, overdue] = [page.locator('.tasks-list').nth(0), page.locator('.tasks-list').nth(1)];
  await expect(rowTexts(all)).toHaveText([
    'Pay the Intro invoice #work',
    'Call the lab',
    'Later B task #home',
    'Undated A task',
    'Third note task',
  ]);
  await expect(all.locator('.tasks-row').nth(0).locator('.tasks-due')).toHaveText(/^Overdue · /);
  await expect(all.locator('.tasks-row').nth(1).locator('.tasks-due')).toHaveText('Today');
  await expect(all.locator('.tasks-row').nth(3).locator('.tasks-due')).toHaveCount(0);
  await expect(overdue.locator('.tasks-problem')).toContainText('Unknown key "when"');
  await expect(rowTexts(overdue)).toHaveText(['Pay the Intro invoice #work']);

  // A link in a task opens its note; the note's name opens it at the task's line.
  await all.locator('.tasks-link', { hasText: 'Intro' }).click();
  await expect(page.getByTestId('desk-card').filter({ hasText: 'Intro' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByTestId('desk-card').filter({ hasText: 'Task Board' }).click();
  await page
    .locator('.tasks-list')
    .nth(0)
    .locator('.tasks-row', { hasText: 'Third note task' })
    .locator('.tasks-note')
    .click();
  // The cursor is on the task's line.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const n = document.getSelection()?.anchorNode;
        const e = n instanceof Element ? n : n?.parentElement;
        return e?.closest('.cm-line')?.textContent ?? '';
      }),
    )
    .toContain('Third note task');
});

test('ticking in the list writes [x] at the task, even after lines moved', async () => {
  const { page } = ctx;
  await openNote(page, 'Task Board');
  const all = page.locator('.tasks-list').nth(0);
  await expect(rowTexts(all)).toHaveCount(5);

  await all.locator('.tasks-row', { hasText: 'Call the lab' }).getByRole('checkbox').check();
  await expect
    .poll(() => readFile(file(`${NOTES}/Tasks B.md`), 'utf8'))
    .toContain(`- [x] Call the lab due:${day(0)}`);
  expect(await readFile(file(`${NOTES}/Tasks B.md`), 'utf8')).toContain('1. [ ] Later B task');
  // The list follows the index: a done task leaves the open list.
  await expect(rowTexts(all)).toHaveCount(4);

  // Lines above the task move on disk; the tick still lands on the task.
  await writeFile(
    file(`${NOTES}/Tasks A.md`),
    `# A\n\nA new first paragraph.\n\nAnd another.\n\n- [ ] Pay the [[Intro]] invoice due:${day(-2)} #work\n- [x] Old done task\n- [ ] Undated A task\n`,
  );
  await all.locator('.tasks-row', { hasText: 'Undated A task' }).getByRole('checkbox').check();
  await expect.poll(() => readFile(file(`${NOTES}/Tasks A.md`), 'utf8')).toContain('- [x] Undated A task');
  const a = await readFile(file(`${NOTES}/Tasks A.md`), 'utf8');
  expect(a).toContain('And another.');
  expect(a).toContain('- [ ] Pay the [[Intro]] invoice');
});

test('due dates show as chips on task lines only; the Tasks view filters', async () => {
  const { page } = ctx;
  await openNote(page, 'Tasks B');
  const editor = page.locator('.vx-editor');
  await expect(editor.locator('.cm-line', { hasText: 'Call the lab' }).locator('.tasks-due')).toHaveText(
    'Today',
  );
  await expect(editor.locator('.cm-line', { hasText: 'Later B task' }).locator('.tasks-due')).toHaveCount(1);
  await expect(editor.locator('.cm-line', { hasText: 'Some text' }).locator('.tasks-due')).toHaveCount(0);

  await runCommand(page, 'Show Open Tasks (This Vault)');
  const view = page.locator('.tasks-view');
  await expect(view.locator('.tasks-title')).toHaveText('Tasks: GNSS Study');
  await expect(rowTexts(view)).toHaveCount(5);
  await view.getByLabel('Due').selectOption('overdue');
  await expect(rowTexts(view)).toHaveText(['Pay the Intro invoice #work']);
  await view.getByLabel('Due').selectOption('any');
  await view.getByLabel('Tag').fill('#home');
  await view.getByLabel('Tag').press('Enter');
  await expect(rowTexts(view)).toHaveText(['Later B task #home']);
});
