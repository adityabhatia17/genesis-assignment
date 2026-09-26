#!/usr/bin/env node
// Fails the build when the code needed for first paint grows past the budget.
// "First paint" = the entry chunk plus everything it imports statically (Monaco is lazy and excluded).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = Number(process.env.BUNDLE_BUDGET_KB ?? 350);
const dist = join(import.meta.dirname, '..', 'dist');
const manifest = JSON.parse(readFileSync(join(dist, '.vite', 'manifest.json'), 'utf8'));

const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry);
if (!entryKey)
  throw new Error('No entry chunk in dist/.vite/manifest.json (is build.manifest enabled?)');

const seen = new Set();
const visit = (key) => {
  if (seen.has(key)) return;
  seen.add(key);
  for (const dep of manifest[key].imports ?? []) visit(dep);
};
visit(entryKey);

let total = 0;
for (const key of seen) {
  const file = manifest[key].file;
  const kb = gzipSync(readFileSync(join(dist, file))).length / 1024;
  total += kb;
  console.log(`${kb.toFixed(1).padStart(8)} KB  ${file}`);
}
console.log(`${total.toFixed(1).padStart(8)} KB  total (gzip) — budget ${BUDGET_KB} KB`);
if (total > BUDGET_KB) {
  console.error(
    'Initial bundle is over budget. Lazy-load the new dependency or raise the budget deliberately.',
  );
  process.exit(1);
}
