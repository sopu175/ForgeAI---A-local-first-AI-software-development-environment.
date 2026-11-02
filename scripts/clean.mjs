#!/usr/bin/env node
/**
 * Remove previous build output so every package contains only the current code.
 * Runs on macOS, Windows and Linux (plain Node, no shell differences).
 */
import { rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.join(root, 'apps', 'desktop');

const targets = [path.join(desktop, 'out'), path.join(desktop, 'dist'), path.join(desktop, 'node_modules', '.vite')];

for (const target of targets) {
  await rm(target, { recursive: true, force: true });
  console.log(`cleaned ${path.relative(root, target)}`);
}

// Old artifacts sometimes accumulate with different names inside dist; removing
// the whole directory above handles that. Report anything left over.
try {
  const entries = await readdir(path.join(desktop, 'dist'));
  if (entries.length > 0) console.log(`note: ${entries.length} file(s) still in apps/desktop/dist`);
} catch {
  // dist does not exist yet — nothing to do.
}
