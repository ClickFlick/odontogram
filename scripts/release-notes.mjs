// Prints the CHANGELOG sections for a version (both packages) as GitHub Release notes.
import { readFileSync, existsSync } from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('usage: node scripts/release-notes.mjs <version>');
  process.exit(1);
}

function section(file, heading) {
  if (!existsSync(file)) return '';
  const text = readFileSync(file, 'utf8');
  const re = new RegExp(
    `^## ${version.replace(/\./g, '\\.')}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`,
    'm',
  );
  const m = re.exec(text);
  if (!m) return '';
  return `### ${heading}\n${m[1].trim()}\n`;
}

const parts = [
  section('packages/core/CHANGELOG.md', '@oozkul/dental-3d'),
  section('packages/angular/CHANGELOG.md', '@oozkul/dental-3d-angular'),
].filter(Boolean);

const install =
  `\n### Install\n\n\`\`\`sh\nnpm install @oozkul/dental-3d@${version} three\n` +
  `npm install @oozkul/dental-3d-angular@${version}   # Angular\n\`\`\`\n\n` +
  `Live demo: https://clickflick.github.io/odontogram/\n`;

console.log((parts.length ? parts.join('\n') : `Release ${version}.\n`) + install);
