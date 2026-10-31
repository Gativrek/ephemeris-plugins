// Writes `licenses/THIRD-PARTY.txt` into a plugin's dist: the license of every npm package
// that ended up in the bundle, read from esbuild's metafile, so the notices travel with
// the copies their licenses cover. Workspace packages (packages/chart) are this repository's.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\..*)?$/i;

/** The packages whose code is in the output, as { root, name } (one entry per package). */
function bundledPackages(metafile) {
  const roots = new Map();
  for (const output of Object.values(metafile.outputs)) {
    for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
      if (!bytesInOutput) continue;
      const path = resolve(input.replace(/^[a-z-]+:(?![\\/])/i, '')).replace(/\\/g, '/');
      const at = path.lastIndexOf('/node_modules/');
      if (at < 0) continue;
      const parts = path.slice(at + '/node_modules/'.length).split('/');
      const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
      roots.set(name, `${path.slice(0, at)}/node_modules/${name}`);
    }
  }
  return [...roots].map(([name, root]) => ({ name, root })).sort((a, b) => a.name.localeCompare(b.name));
}

export function writeThirdParty(metafile, out) {
  const packages = bundledPackages(metafile);
  if (!packages.length) return [];
  const sections = packages.map(({ name, root }) => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? null);
    const files = readdirSync(root).filter((f) => LICENSE_FILE.test(f));
    const text = files.length
      ? files.map((f) => readFileSync(join(root, f), 'utf8').trim()).join('\n\n')
      : `The package has no license file. Its package.json gives the license as ${license ?? 'unknown'}` +
        (pkg.author ? `, author ${typeof pkg.author === 'string' ? pkg.author : pkg.author.name}.` : '.');
    const title = `${name} ${pkg.version}${license ? ` (${license})` : ''}`;
    return `${'='.repeat(78)}\n${title}\n${'='.repeat(78)}\n\n${text}\n`;
  });
  const dir = join(out, 'licenses');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'THIRD-PARTY.txt'),
    `Third-party software bundled in this plugin, with its licenses.\n\n${sections.join('\n')}`,
  );
  return packages.map((p) => p.name);
}
