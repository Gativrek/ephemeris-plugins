/** Contract test for Control Plots' discrete time (SPECS 13.3): sampled systems in the real app. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { installPlugin, launchWithLibrary, type Launched } from './app';

const NOTES = 'Academic/GNSS Study/Notes';
const NOTE = [
  '# Sampled loop',
  '',
  '```bode',
  'G  = 1/(s(s+1))',
  'Gd = c2d(G, 0.5)',
  '```',
  '',
  '```step',
  'Ts = 0.1',
  'D  = 0.5/(z - 0.5)',
  'H  = tf([0.2 0.1], [1 -1.2 0.5], 0.1)',
  '```',
  '',
  '```pzmap',
  'Ts = 0.1',
  'H = (z - 1.5)/(z^2 - z + 0.5)',
  '```',
  '',
  '```step',
  'Ts = 0.1',
  'C = 1/(z - 1)',
  'G = 1/(s + 1)',
  'L = C*G',
  '```',
  '',
  'End.',
  '',
].join('\n');

let ctx: Launched;

test.beforeEach(async () => {
  ctx = await launchWithLibrary(async (lib) => {
    const notes = path.join(lib, ...NOTES.split('/'));
    await mkdir(notes, { recursive: true });
    await writeFile(path.join(notes, 'Sampled Loop.md'), NOTE);
  });
  await installPlugin(ctx, 'control-plots', 'Control Plots');
  const { page } = ctx;
  await page.getByTestId('section-tile').filter({ hasText: 'Notes' }).click();
  await page.getByTestId('tree').getByRole('treeitem', { name: 'Sampled Loop', exact: true }).click();
});

test.afterEach(async () => {
  await ctx.close();
});

test('sampled systems: Nyquist line, stairs with k on hover, the unit circle, and a mixing error', async () => {
  const { page } = ctx;
  const blocks = page.locator('.vx-plugin-block[data-plugin="control-plots"]');
  await expect(blocks).toHaveCount(4);
  const [bode, step, pzmap, mixed] = [0, 1, 2, 3].map((i) => blocks.nth(i));

  // Bode: a continuous plant and its sampled version; the sampled curve ends at π/0.5.
  await expect(bode!.locator('.control-plots-legend')).toContainText('Gd (Ts = 0.5 s)');
  await expect(bode!.locator('.control-plots-nyquist-line')).toHaveCount(2);
  await expect(bode!.locator('.control-plots-nyquist-label')).toHaveText('Nyquist');

  // Step: stairs, and hover reads the sample number.
  await expect(step!.locator('.control-plots-line')).toHaveCount(2);
  const d = await step!.locator('.control-plots-line').first().getAttribute('d');
  expect(d).toMatch(/^M[\d.]+,[\d.]+L/);
  await expect(step!.locator('.control-plots-notes')).toContainText('D (Ts = 0.1 s): final value 1');
  const hit = step!.locator('.control-plots-hit');
  const box = (await hit.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await expect(step!.locator('.control-plots-tooltip-head')).toContainText(/k = \d+ · t = /);

  // Pole-zero map: the unit circle instead of the imaginary axis, on a square plot.
  await expect(pzmap!.locator('.control-plots-unit-circle')).toHaveCount(1);
  const frame = (await pzmap!.locator('.control-plots-frame').boundingBox())!;
  expect(Math.abs(frame.width - frame.height)).toBeLessThan(2);
  const circle = (await pzmap!.locator('.control-plots-unit-circle').boundingBox())!;
  expect(Math.abs(circle.width - circle.height)).toBeLessThan(2);

  // Continuous and discrete in one expression: the error names the line and the fix.
  await expect(mixed!.locator('.vx-plugin-block__message')).toContainText(
    'Line 4: C is discrete and G is continuous; discretize G with c2d first',
  );

  if (process.env.SHOTS) {
    for (const [i, b] of [bode, step, pzmap].entries())
      await b!.screenshot({ path: path.join(process.env.SHOTS, `discrete-${i}.png`) });
  }
});
