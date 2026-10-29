// The plugin's styles.css for dist/: the shared plot frame's CSS with the plugin's class
// prefix (SPECS 12.2), followed by the plugin's own styles.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function writeStyles(prefix, ownCss, outFile) {
  const chart = readFileSync(join(here, 'src/chart.css'), 'utf8').replaceAll('PREFIX', prefix);
  writeFileSync(outFile, `${chart}\n${readFileSync(ownCss, 'utf8')}`);
}
