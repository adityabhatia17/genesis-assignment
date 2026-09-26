#!/usr/bin/env node
// Copies functions/src/contracts/*.ts → frontend/src/contracts/ with a generated header.
// `--check` exits 1 when the frontend copy is missing, stale or has extra files.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'functions', 'src', 'contracts');
const DEST = join(root, 'frontend', 'src', 'contracts');
const HEADER =
  '// GENERATED FILE — DO NOT EDIT.\n// Source of truth: functions/src/contracts. Run `npm run contracts:sync` from the repo root.\n\n';
const check = process.argv.includes('--check');

const listTs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.ts')).sort() : []);

if (!existsSync(join(root, 'frontend', 'package.json'))) {
  console.log('frontend/ not initialized yet — skipping contracts sync');
  process.exit(0);
}

const expected = new Map(listTs(SRC).map((f) => [f, HEADER + readFileSync(join(SRC, f), 'utf8')]));

if (check) {
  const problems = [];
  for (const [file, content] of expected) {
    const target = join(DEST, file);
    if (!existsSync(target) || readFileSync(target, 'utf8') !== content)
      problems.push(`stale or missing: frontend/src/contracts/${file}`);
  }
  for (const file of listTs(DEST)) if (!expected.has(file)) problems.push(`unexpected: frontend/src/contracts/${file}`);
  if (problems.length > 0) {
    console.error(`Contracts drift detected:\n  ${problems.join('\n  ')}\nRun: npm run contracts:sync`);
    process.exit(1);
  }
  console.log(`contracts in sync (${expected.size} files)`);
  process.exit(0);
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
for (const [file, content] of expected) writeFileSync(join(DEST, file), content);
console.log(`synced ${expected.size} contract files → frontend/src/contracts`);
