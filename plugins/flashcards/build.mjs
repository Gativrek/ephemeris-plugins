// Builds the installable plugin folder `dist/` (manifest.json, main.js, styles.css).
// ts-fsrs (MIT) is bundled into main.js.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { writeThirdParty } from '../../scripts/third-party.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const result = await build({
  entryPoints: [join(here, 'src/main.ts')],
  outfile: join(out, 'main.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',

  legalComments: 'none',
  logLevel: 'warning',
  metafile: true,
});
copyFileSync(join(here, 'manifest.json'), join(out, 'manifest.json'));
copyFileSync(join(here, 'styles.css'), join(out, 'styles.css'));
writeThirdParty(result.metafile, out);
console.log(`flashcards built to ${out}`);
