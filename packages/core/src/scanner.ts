import { promises as fs } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import ignore, { type Ignore } from 'ignore';
import { isBinaryName } from '@forgeai/shared';

export const HEAVY_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/out/**',
  '**/build/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.svelte-kit/**',
  '**/target/**',
  '**/vendor/**',
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/.idea/**',
  '**/.vscode/**',
  '**/.cache/**',
  '**/coverage/**',
  '**/release/**',
  '**/.turbo/**',
  '**/.parcel-cache/**',
  '**/*.min.js',
  '**/*.map',
];

export const SECRET_IGNORE = [
  '**/.env',
  '**/.env.*',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/id_rsa*',
  '**/id_ed25519*',
  '**/.npmrc',
  '**/.netrc',
  '**/credentials.json',
  '**/service-account*.json',
];

export interface ScannedFile {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface ScanOptions {
  maxFileSizeKb?: number;
  extraIgnore?: string[];
  includeBinary?: boolean;
  signal?: AbortSignal;
}

export async function createIgnoreMatcher(root: string): Promise<Ignore> {
  const matcher = ignore();
  const candidates = ['.gitignore', '.git/info/exclude', '.sopuforge/ignore'];
  for (const relative of candidates) {
    try {
      const content = await fs.readFile(path.join(root, relative), 'utf8');
      matcher.add(content.split(/\r?\n/).filter((line) => !line.trim().startsWith('#')));
    } catch {
      // optional
    }
  }
  matcher.add(['.git', 'node_modules', '.sopuforge']);
  return matcher;
}

export async function scanProject(root: string, options: ScanOptions = {}): Promise<ScannedFile[]> {
  const maxBytes = (options.maxFileSizeKb ?? 512) * 1024;
  const matcher = await createIgnoreMatcher(root);
  const entries = await fg('**/*', {
    cwd: root,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    absolute: false,
    ignore: [...HEAVY_IGNORE, ...SECRET_IGNORE, ...(options.extraIgnore ?? [])],
    suppressErrors: true,
  });
  const filtered = matcher.filter(entries);
  const results: ScannedFile[] = [];
  for (const relative of filtered) {
    if (options.signal?.aborted) break;
    if (!options.includeBinary && isBinaryName(relative)) continue;
    try {
      const stat = await fs.stat(path.join(root, relative));
      if (!stat.isFile() || stat.size > maxBytes || stat.size === 0) continue;
      results.push({ path: relative.replace(/\\/g, '/'), size: stat.size, mtimeMs: stat.mtimeMs });
    } catch {
      // File vanished during scan.
    }
    if (results.length >= 100_000) break;
  }
  return results;
}

export async function readTextFile(root: string, relative: string, maxBytes = 2 * 1024 * 1024): Promise<string | null> {
  try {
    const buffer = await fs.readFile(path.join(root, relative));
    if (buffer.byteLength > maxBytes) return buffer.subarray(0, maxBytes).toString('utf8');
    return buffer.toString('utf8');
  } catch {
    return null;
  }
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function isGitRepository(root: string): Promise<boolean> {
  return pathExists(path.join(root, '.git'));
}

export function isIgnored(relative: string, matcher: Ignore): boolean {
  return matcher.ignores(relative);
}
