// Creates the git tag for the current package version (after `npm run version`).
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const core = JSON.parse(readFileSync('packages/core/package.json', 'utf8')).version;
const ng = JSON.parse(readFileSync('packages/angular/package.json', 'utf8')).version;
if (core !== ng) {
  console.error(`Version mismatch: core ${core}, angular ${ng}. Run "npm run version" first.`);
  process.exit(1);
}
const pending = readdirSync('.changeset').filter((f) => f.endsWith('.md') && f !== 'README.md');
if (pending.length) {
  console.error(
    `Unapplied changesets: ${pending.join(', ')}. Run "npm run version" and commit first.`,
  );
  process.exit(1);
}
const dirty = execSync('git status --porcelain').toString().trim();
if (dirty) {
  console.error('Working tree is not clean. Commit the version bump before tagging.');
  process.exit(1);
}
const tag = `v${core}`;
execSync(`git tag -a ${tag} -m "${tag}"`, { stdio: 'inherit' });
console.log(`Created tag ${tag}. Push it with:\n\n  git push origin main --follow-tags\n`);
