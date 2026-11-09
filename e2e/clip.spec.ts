/** Contract test for the Clip plugin (SPECS 13.8). fixtures/clip.webm: an 8 s, 5 fps test pattern. */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { installPlugin, launchWithLibrary, type Launched } from './app';

const NOTES = 'Academic/GNSS Study/Notes';
const NOTE = [
  '# Clip test',
  '',
  '```clip',
  'file: clips/take.webm',
  'start: 0:02',
  'end: 0:04',
  '```',
  '',
  '```clip',
  'file: [[missing.mp4]]',
  '```',
  '',
  'End.',
  '',
].join('\n');

let ctx: Launched;
const file = (rel: string) => path.join(ctx.lib, ...rel.split('/'));

test.beforeEach(async () => {
  ctx = await launchWithLibrary(async (lib) => {
    const notes = path.join(lib, ...NOTES.split('/'));
    await mkdir(path.join(notes, 'clips'), { recursive: true });
    await copyFile(path.join(import.meta.dirname, 'fixtures/clip.webm'), path.join(notes, 'clips/take.webm'));
    await writeFile(path.join(notes, 'Clip Test.md'), NOTE);
  });
  await installPlugin(ctx, 'clip', 'Clip');
  const { page } = ctx;
  await page.getByTestId('section-tile').filter({ hasText: 'Notes' }).click();
  await page.getByTestId('tree').getByRole('treeitem', { name: 'Clip Test', exact: true }).click();
});

test.afterEach(async () => {
  await ctx.close();
});

test('a clip plays inside its segment, loops, and keeps seeks at its edges', async () => {
  const { page } = ctx;
  const box = page.locator('.clip-box').first();
  await expect(box.locator('.clip-caption')).toHaveText('take.webm · 0:02.0 → 0:04.0 (2.0 s)');
  const video = box.locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
  // It opens on the clip's first frame.
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(2, 1);

  // Played for 3 s, it stays between 2 and 4 and goes round at least once.
  const seen = await video.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    await v.play();
    const times: number[] = [];
    const until = performance.now() + 3000;
    while (performance.now() < until) {
      times.push(v.currentTime);
      await new Promise((r) => setTimeout(r, 50));
    }
    v.pause();
    return times;
  });
  expect(Math.min(...seen)).toBeGreaterThanOrEqual(1.99);
  expect(Math.max(...seen)).toBeLessThanOrEqual(4.15);
  expect(seen.some((t, i) => i > 0 && t < seen[i - 1]! - 0.5)).toBe(true);

  // Seeking outside the segment lands on its nearest edge.
  const seek = (t: number) =>
    video.evaluate(async (v: HTMLVideoElement, to: number) => {
      v.currentTime = to;
      await new Promise((r) => setTimeout(r, 300));
      return v.currentTime;
    }, t);
  expect(await seek(6.5)).toBeCloseTo(4, 1);
  expect(await seek(0.5)).toBeCloseTo(2, 1);
});

test('Set Start writes the block and keeps the video; a missing file is named', async () => {
  const { page } = ctx;
  const box = page.locator('.clip-box').first();
  const video = box.locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
  await video.evaluate(async (v: HTMLVideoElement) => {
    (v as HTMLVideoElement & { marked?: boolean }).marked = true;
    v.currentTime = 2.5;
    await new Promise((r) => setTimeout(r, 300));
  });
  await box.getByRole('button', { name: 'Set Start' }).click();
  await expect
    .poll(() => readFile(file(`${NOTES}/Clip Test.md`), 'utf8'))
    .toContain('start: 0:02.50\nend: 0:04');
  await expect(box.locator('.clip-caption')).toHaveText('take.webm · 0:02.5 → 0:04.0 (1.5 s)');
  // The same video element: the clip was updated in place, not reloaded.
  expect(
    await box.locator('video').evaluate((v) => (v as HTMLVideoElement & { marked?: boolean }).marked),
  ).toBe(true);

  // The new start holds at once: a seek before it lands on it.
  await video.evaluate(async (v: HTMLVideoElement) => {
    v.currentTime = 2.2;
    await new Promise((r) => setTimeout(r, 300));
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(2.5, 1);

  await expect(page.locator('.clip-box').nth(1).locator('.clip-problem')).toHaveText(
    'No video at missing.mp4.',
  );
});
