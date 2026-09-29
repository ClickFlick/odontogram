// ng-packagr writes its own package.json into dist; carry over the fields npm needs for
// publishing (publishConfig, repository, keywords, …) that ng-packagr drops.
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..');
const src = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const distPath = join(pkgDir, 'dist', 'package.json');
const dist = JSON.parse(readFileSync(distPath, 'utf8'));

for (const key of [
  'description',
  'license',
  'keywords',
  'repository',
  'homepage',
  'bugs',
  'publishConfig',
  'peerDependencies',
]) {
  if (src[key] !== undefined) dist[key] = src[key];
}
delete dist.scripts;
delete dist.devDependencies;
writeFileSync(distPath, JSON.stringify(dist, null, 2) + '\n');

for (const f of ['CHANGELOG.md', 'README.md']) {
  if (existsSync(join(pkgDir, f))) copyFileSync(join(pkgDir, f), join(pkgDir, 'dist', f));
}
copyFileSync(join(pkgDir, '..', '..', 'LICENSE'), join(pkgDir, 'dist', 'LICENSE'));
console.log('postbuild: dist/package.json updated');
