// Builds the installable plugin folder `dist/` (manifest.json, main.js, styles.css with the shared
// plot frame's styles).
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { writeStyles } from '../../packages/chart/build-css.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(here, 'src/main.ts')],
  outfile: join(out, 'main.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  legalComments: 'none',
  logLevel: 'warning',
});
copyFileSync(join(here, 'manifest.json'), join(out, 'manifest.json'));
writeStyles('data-plot', join(here, 'styles.css'), join(out, 'styles.css'));
console.log(`data-plot built to ${out}`);
