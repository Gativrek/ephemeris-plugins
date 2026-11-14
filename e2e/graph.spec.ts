/** Contract test for the Graph view plugin (SPECS 13.11). Needs an app with plugin API 1.4.0. */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installPlugin, launchWithLibrary, runCommand, type Launched } from './app';

const VAULT = 'Academic/GNSS Study';
const INTRO = `${VAULT}/Notes/Intro.md`;

let ctx: Launched;

test.beforeEach(async () => {
  ctx = await launchWithLibrary();
  await installPlugin(ctx, 'graph', 'Graph view');
  const { page } = ctx;
  await page.getByTestId('section-tile').filter({ hasText: 'Notes' }).click();
  await page.getByTestId('tree').getByRole('treeitem', { name: 'Intro', exact: true }).click();
  await expect(page.getByTestId('desk-card').filter({ hasText: 'Intro' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test.afterEach(async () => {
  await ctx.close();
});

type Graph = { notes: Array<{ path: string }>; links: Array<{ from: string; to: string }> };
/** The core's link graph, as the plugin reads it. */
const linkGraph = (page: Page, scope: object) =>
  page.evaluate(async (s) => {
    const vx = (window as unknown as { vx: { index: { linkGraph(s: object): Promise<{ value?: Graph }> } } })
      .vx;
    return (await vx.index.linkGraph(s)).value!;
  }, scope);

/** Waits for the layout to settle (the dots stop moving), then returns a dot's screen position. */
async function dot(page: Page, notePath: string) {
  const canvas = page.locator('.graph-canvas');
  let last = '';
  await expect
    .poll(
      async () => {
        const p = await canvas.evaluate(
          (c, id) =>
            (c as HTMLCanvasElement & { graphPoint(p: string): { x: number; y: number } | null }).graphPoint(
              id,
            ),
          notePath,
        );
        const now = JSON.stringify(p && { x: Math.round(p.x), y: Math.round(p.y) });
        const still = now === last && p !== null;
        last = now;
        return still;
      },
      { intervals: [300], timeout: 15_000 },
    )
    .toBe(true);
  return JSON.parse(last) as { x: number; y: number };
}

test('the Vault graph matches the core link graph; search and a click open notes; it follows new links', async () => {
  const { page } = ctx;
  await runCommand(page, 'Open Graph');
  const view = page.locator('.graph-view');
  await expect(page.getByTestId('desk-card').filter({ hasText: 'Graph: GNSS Study' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // The core's graph, without templates (`_templates/`), which the plugin leaves out.
  const g = await linkGraph(page, { kind: 'vault', vaultPath: VAULT });
  const tpl = (p: string) => p.split('/').includes('_templates');
  const notes = g.notes.filter((n) => !tpl(n.path));
  expect(notes.length).toBeLessThan(g.notes.length);
  const noteLinks = g.links.filter((l) => l.to.endsWith('.md') && !tpl(l.from) && !tpl(l.to)).length;
  const status = view.locator('.graph-status');
  await expect(status).toHaveText(`${notes.length} notes, ${noteLinks} links`);

  // Search lights matches; Enter opens the first.
  await view.getByLabel('Find a note in the graph').fill('intro');
  await expect(status).toContainText('found');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('desk-card').filter({ hasText: /^Intro/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // A click on a dot opens its note.
  await page.getByTestId('desk-card').filter({ hasText: 'Graph: GNSS Study' }).click();
  await view.getByLabel('Find a note in the graph').fill('');
  const p = await dot(page, INTRO);
  await page.locator('.graph-canvas').hover({ position: p });
  await expect(status).toContainText('· Intro');
  await page.locator('.graph-canvas').click({ position: p });
  await expect(page.getByTestId('desk-card').filter({ hasText: /^Intro/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // A new note linking to Intro: one more note, one more link.
  await page.getByTestId('desk-card').filter({ hasText: 'Graph: GNSS Study' }).click();
  await writeFile(
    path.join(ctx.lib, ...`${VAULT}/Notes/Graph Test.md`.split('/')),
    '# Graph test\n\nSee [[Intro]].\n',
  );
  await expect(status).toHaveText(`${notes.length + 1} notes, ${noteLinks + 1} links`, { timeout: 15_000 });
});

test('a local graph shows the note and its neighbours, to the chosen depth', async () => {
  const { page } = ctx;
  await runCommand(page, 'Open Local Graph');
  const view = page.locator('.graph-view');
  await expect(page.getByTestId('desk-card').filter({ hasText: 'Local graph: Intro' })).toBeVisible();

  const all = await linkGraph(page, { kind: 'all' });
  const near = (ids: Set<string>) => {
    const out = new Set(ids);
    for (const l of all.links) {
      if (!l.to.endsWith('.md')) continue;
      if (ids.has(l.from)) out.add(l.to);
      if (ids.has(l.to)) out.add(l.from);
    }
    return out;
  };
  const one = near(new Set([INTRO]));
  const two = near(one);
  const status = view.locator('.graph-status');
  await expect(status).toHaveText(new RegExp(`^${one.size} notes,`));
  await view.getByLabel('Depth').selectOption('2');
  await expect(status).toHaveText(new RegExp(`^${two.size} notes,`));
  expect(two.size).toBeGreaterThan(one.size);
});
