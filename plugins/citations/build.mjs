// Builds the installable plugin folder `dist/`: manifest.json, main.js, styles.css, and the
// chunks loaded on first use (citeproc-js with the CSL styles, and the BibTeX parser).
// citeproc-js is CPAL-1.0 or AGPL-3.0; its license goes with it.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const out = join(here, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'licenses'), { recursive: true });

await build({
  entryPoints: [join(here, 'src/main.ts')],
  outdir: out,
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  minify: true,
  loader: { '.csl': 'text', '.xml': 'text' },
  legalComments: 'linked',
  logLevel: 'warning',
});
copyFileSync(join(here, 'manifest.json'), join(out, 'manifest.json'));
copyFileSync(join(here, 'styles.css'), join(out, 'styles.css'));
copyFileSync(
  join(dirname(require.resolve('citeproc/package.json')), 'LICENSE'),
  join(out, 'licenses/citeproc-js.txt'),
);
copyFileSync(join(here, 'csl/README.md'), join(out, 'licenses/csl-styles.md'));
console.log(`citations built to ${out}`);
