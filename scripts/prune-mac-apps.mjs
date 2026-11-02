#!/usr/bin/env node
/**
 * electron-builder leaves unpacked .app bundles in the dist/mac... directories.
 * macOS indexes any app bundle under the home folder, so those copies show up in
 * Launchpad next to the installed app. Keep the DMG/ZIP artefacts and remove the
 * unpacked copies.
 */
import { rm, readdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'apps', 'desktop', 'dist');

let removed = 0;
const entries = await readdir(dist, { withFileTypes: true }).catch(() => []);
for (const entry of entries) {
  if (!entry.isDirectory() || !/^mac(-|$)/.test(entry.name)) continue;
  const dir = path.join(dist, entry.name);
  const apps = await readdir(dir).catch(() => []);
  for (const name of apps) {
    if (!name.endsWith('.app')) continue;
    await rm(path.join(dir, name), { recursive: true, force: true });
    removed += 1;
    console.log(`removed unpacked ${path.relative(root, path.join(dir, name))}`);
  }
  // Drop the directory too when it is now empty (blockmaps live in dist/).
  await rmdir(dir).catch(() => undefined);
}

if (removed === 0) console.log('no unpacked .app bundles to remove');
