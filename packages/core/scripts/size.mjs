// Reports gzipped sizes of the built core (acceptance criterion: ≤ 60 kB gz excluding three
// and the model; model ≤ 500 kB).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const LIMIT_CORE = 60 * 1024;
const LIMIT_MODEL = 500 * 1024;

let core = 0;
let model = 0;
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.js')) {
      const gz = gzipSync(readFileSync(p)).length;
      if (f.includes('default-model')) model += gz;
      else core += gz;
    }
  }
};
walk(dist);
const glb = statSync(join(here, '..', 'model', 'default.glb')).size;
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log(`core runtime (gz, excluding three & model): ${kb(core)} / ${kb(LIMIT_CORE)}`);
console.log(`embedded model chunk (gz):                  ${kb(model)}`);
console.log(`model/default.glb:                          ${kb(glb)} / ${kb(LIMIT_MODEL)}`);
if (core > LIMIT_CORE || glb > LIMIT_MODEL) {
  console.error('size budget exceeded');
  process.exit(1);
}
