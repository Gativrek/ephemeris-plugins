/**
 * Launches a built Ephemeris for the contract tests. The app is the core repository this one
 * is checked out in (`../apps/desktop`), or EPHEMERIS_APP_DIR; build it there first
 * (`pnpm --filter @ephemeris-notes/desktop build`). Test mode keeps windows off screen and
 * external effects recorded, as in the core's own E2E tests.
 */
import { existsSync } from 'node:fs';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
export const pluginsRoot = path.resolve(here, '..');
const appDir = path.resolve(process.env.EPHEMERIS_APP_DIR ?? path.join(pluginsRoot, '../apps/desktop'));
const appMain = path.join(appDir, 'out/main/index.js');

export interface Launched {
  app: ElectronApplication;
  page: Page;
  /** The library: a copy of the core's fixture library. */
  lib: string;
  close(): Promise<void>;
}

/**
 * Opens a copy of the core's fixture library, in the Vault "GNSS Constellation Study"
 * (folder Academic/GNSS Study). `setup` adds files before the library opens.
 */
export async function launchWithLibrary(setup?: (lib: string) => Promise<void>): Promise<Launched> {
  if (!existsSync(appMain))
    throw new Error(`No built Ephemeris at ${appMain}: build the app, or set EPHEMERIS_APP_DIR.`);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vx-plugins-e2e-'));
  const lib = path.join(dir, 'library');
  await cp(path.join(appDir, 'test/fixtures/library'), lib, { recursive: true });
  await setup?.(lib);
  const executablePath = createRequire(path.join(appDir, 'package.json'))('electron') as unknown as string;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && k !== 'ELECTRON_RENDERER_URL') env[k] = v;
  const app = await electron.launch({
    executablePath,
    args: [appMain],
    cwd: appDir,
    env: { ...env, VX_TEST: '1', VX_USER_DATA: path.join(dir, 'userdata') },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await pickFolder(app, lib);
  await page.getByRole('button', { name: 'Open Library…' }).click();
  await expect(page.getByTestId('chooser')).toBeVisible();
  await page.getByTestId('vault-card').filter({ hasText: 'GNSS Constellation Study' }).dblclick();
  await expect(page.getByTestId('workspace')).toBeVisible();
  return {
    app,
    page,
    lib,
    async close() {
      await app.close();
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    },
  };
}

/** Makes the next folder dialogs return `folder` without showing anything. */
export async function pickFolder(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate((_electron, f) => {
    (globalThis as { __vxPickFolder?: string }).__vxPickFolder = f;
  }, folder);
}

/** Installs plugins/<id>/dist from Settings > Plugins and enables it. */
export async function installPlugin(ctx: Launched, id: string, name: string): Promise<void> {
  const { page } = ctx;
  await page.keyboard.press('ControlOrMeta+,');
  await page
    .getByTestId('settings')
    .getByRole('navigation')
    .first()
    .getByRole('link', { name: 'Plugins', exact: true })
    .click();
  await pickFolder(ctx.app, path.join(pluginsRoot, 'plugins', id, 'dist'));
  await page.getByRole('button', { name: 'Install from Folder…' }).click();
  await expect(page.getByTestId('settings-plugins')).toContainText(`Installed ${name}.`);
  await page.getByRole('checkbox', { name: `Enable ${name}` }).check();
  await expect(page.getByTestId(`plugin-${id}`)).toContainText('Enabled');
  await page.keyboard.press('Escape');
}

export async function runCommand(page: Page, title: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+p');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  await page.keyboard.type(title);
  await expect(palette.locator('.vx-row').first()).toContainText(title);
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
}
