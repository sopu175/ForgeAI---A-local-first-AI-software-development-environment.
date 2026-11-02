#!/usr/bin/env node
/**
 * npm/yarn extraction does not always keep the executable bit on node-pty's
 * `spawn-helper` binaries. Without it `pty.spawn()` fails with
 * "posix_spawnp failed" and the app silently drops to pipe mode, where the
 * integrated terminal has no echo and no prompt. Running this after every
 * install restores the bit before Electron ever starts.
 */
import { chmod, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const targets = [];

/** Walk up from the current directory so this works from the repo root or a workspace. */
async function findPtyRoot(from) {
  let dir = from;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, 'node_modules', 'node-pty');
    if (await exists(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function walk(dir, depth) {
  if (depth > 6) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      await walk(full, depth + 1);
    } else if (entry.isFile() && (entry.name === 'spawn-helper' || entry.name.endsWith('.node'))) {
      targets.push(full);
    }
  }
}

const ptyRoot = await findPtyRoot(process.cwd());
if (ptyRoot) {
  await walk(ptyRoot, 0);
  const root = path.dirname(path.dirname(ptyRoot));

  let changed = 0;
  for (const file of targets) {
    const info = await stat(file);
    if (info.mode & 0o111) continue;
    await chmod(file, info.mode | 0o755);
    changed += 1;
    console.log(`chmod +x ${path.relative(root, file)}`);
  }
  console.log(changed ? `node-pty helpers: ${changed} made executable` : 'node-pty helpers already executable');
} else {
  console.log('node-pty not installed; nothing to fix');
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}
