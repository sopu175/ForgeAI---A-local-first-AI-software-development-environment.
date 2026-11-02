import { promises as fs } from 'node:fs';
import path from 'node:path';
import { shell } from 'electron';
import chokidar, { type FSWatcher } from 'chokidar';
import ignore, { type Ignore } from 'ignore';
import {
  isBinaryName,
  languageFromPath,
  normalizeRelative,
  looksBinary,
  type DirEntry,
  type FileContent,
  type FileNode,
  type ProjectStack,
  type ProjectSummary,
  type RuleFile,
  type WorkspaceChangeEvent,
} from '@forgeai/shared';
import { createIgnoreMatcher, defaultGlobalRulesTemplate, detectStack } from '@forgeai/core';
import type { Database } from '../db';

const MAX_READ = 4 * 1024 * 1024;
const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.sopuforge',
  'dist',
  'build',
  'out',
  'release',
  '.next',
  '.nuxt',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  'coverage',
]);

export type Broadcast = (channel: string, payload: unknown) => void;

export class WorkspaceService {
  private current: { id: string; name: string; root: string } | null = null;
  private watcher: FSWatcher | null = null;
  private ignoreMatcher: Ignore = ignore();
  private readonly rulesDir: string;
  private fileEventListeners: Array<(events: WorkspaceChangeEvent[]) => void> = [];

  constructor(
    private readonly db: Database,
    private readonly userDataDir: string,
    private readonly broadcast: Broadcast,
  ) {
    this.rulesDir = path.join(userDataDir, 'rules');
  }

  get project(): { id: string; name: string; root: string } {
    if (!this.current) throw new Error('No workspace is open');
    return this.current;
  }

  get root(): string {
    return this.project.root;
  }

  get projectId(): string {
    return this.project.id;
  }

  isOpen(): boolean {
    return this.current !== null;
  }

  onFileEvents(listener: (events: WorkspaceChangeEvent[]) => void): void {
    this.fileEventListeners.push(listener);
  }

  async open(rootInput: string): Promise<ProjectSummary> {
    const resolved = await fs.realpath(rootInput);
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw new Error('The selected path is not a directory');

    if (this.current?.root === resolved) {
      this.db.touchProject(this.current.id);
      return this.currentSummary() ?? this.db.upsertProject(resolved, path.basename(resolved) || resolved);
    }
    if (this.current) await this.close();

    const stack = await detectStack(resolved).catch(() => undefined);
    const summary = this.db.upsertProject(resolved, path.basename(resolved) || resolved, stack);
    this.current = { id: summary.id, name: summary.name, root: resolved };
    this.ignoreMatcher = await createIgnoreMatcher(resolved);
    await this.startWatcher();
    this.broadcast('workspace:opened', summary);
    return summary;
  }

  async close(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.current = null;
  }

  currentSummary(): ProjectSummary | null {
    if (!this.current) return null;
    return this.db.getProject(this.current.id) ?? null;
  }

  recent(): ProjectSummary[] {
    return this.db.listProjects();
  }

  async getStack(): Promise<ProjectStack> {
    const stack = await detectStack(this.root);
    this.db.updateProjectStack(this.projectId, stack);
    return stack;
  }

  private async startWatcher(): Promise<void> {
    const root = this.root;
    this.watcher = chokidar.watch(root, {
      ignored: (candidate: string) => {
        const relative = normalizeRelative(path.relative(root, candidate));
        if (!relative) return false;
        const segments = relative.split('/');
        if (segments.some((segment) => IGNORED_DIRS.has(segment))) return true;
        if (relative.startsWith('.sopuforge/')) return true;
        if (isBinaryName(relative)) return true;
        try {
          return this.ignoreMatcher.ignores(relative);
        } catch {
          return false;
        }
      },
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
      depth: 20,
    });

    const pending: WorkspaceChangeEvent[] = [];
    let timer: NodeJS.Timeout | null = null;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const events = pending.splice(0, pending.length);
        if (events.length === 0) return;
        for (const event of events) this.broadcast('workspace:changed', event);
        for (const listener of this.fileEventListeners) listener(events);
      }, 80);
    };

    for (const eventName of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) {
      this.watcher.on(eventName, (absolute: string) => {
        if (!this.current) return;
        const relative = normalizeRelative(path.relative(root, absolute));
        if (!relative || relative.startsWith('.git/')) return;
        pending.push({ type: eventName, path: relative });
        schedule();
      });
    }
  }

  private isIgnored(relative: string): boolean {
    const segments = relative.split('/');
    if (segments.some((segment) => IGNORED_DIRS.has(segment))) return true;
    try {
      return this.ignoreMatcher.ignores(relative);
    } catch {
      return false;
    }
  }

  async resolveSafe(relative: string, allowMissing = true): Promise<string> {
    const root = this.root;
    const normalized = normalizeRelative(relative);
    if (!normalized) return root;
    if (normalized.split('/').includes('..')) throw new Error('Path traversal is not permitted');
    const absolute = path.resolve(root, normalized);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw new Error('Path escapes the workspace');
    }
    const relativeResolved = normalizeRelative(path.relative(root, absolute));
    if (relativeResolved === '.git' || relativeResolved.startsWith('.git/')) {
      throw new Error('ForgeAI does not modify Git internals');
    }
    let existing = absolute;
    while (true) {
      try {
        const real = await fs.realpath(existing);
        if (real !== root && !real.startsWith(root + path.sep)) throw new Error('Symlink escapes the workspace');
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw error;
        const parent = path.dirname(existing);
        if (parent === existing) break;
        existing = parent;
      }
    }
    if (!allowMissing) {
      await fs.access(absolute);
    }
    return absolute;
  }

  async list(dir = ''): Promise<DirEntry[]> {
    const absolute = await this.resolveSafe(dir, false);
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    const results: DirEntry[] = [];
    for (const entry of entries) {
      const relative = normalizeRelative(path.join(dir, entry.name));
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
      if (this.isIgnored(relative) && !entry.isDirectory()) continue;
      if (entry.isFile() && isBinaryName(relative)) continue;
      results.push({
        name: entry.name,
        path: relative,
        type: entry.isDirectory() ? 'directory' : 'file',
      });
    }
    results.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return results;
  }

  async tree(): Promise<FileNode[]> {
    const build = async (dir: string, depth: number): Promise<FileNode[]> => {
      if (depth > 6) return [];
      const entries = await this.list(dir);
      const nodes: FileNode[] = [];
      for (const entry of entries) {
        if (entry.type === 'directory') {
          const children = depth < 2 ? await build(entry.path, depth + 1) : [];
          nodes.push({ name: entry.name, path: entry.path, type: 'directory', children });
        } else {
          nodes.push({ name: entry.name, path: entry.path, type: 'file' });
        }
        if (nodes.length >= 4000) break;
      }
      return nodes;
    };
    return build('', 0);
  }

  async readFile(relative: string): Promise<FileContent> {
    const absolute = await this.resolveSafe(relative, false);
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new Error('Not a file');
    if (stat.size > MAX_READ) {
      const handle = await fs.open(absolute, 'r');
      try {
        const buffer = Buffer.alloc(MAX_READ);
        await handle.read(buffer, 0, MAX_READ, 0);
        if (looksBinary(buffer)) throw new Error('Binary files cannot be opened in the editor');
        return {
          path: normalizeRelative(relative),
          content: buffer.toString('utf8'),
          language: languageFromPath(relative),
          size: stat.size,
          mtime: stat.mtimeMs,
          truncated: true,
        };
      } finally {
        await handle.close();
      }
    }
    const buffer = await fs.readFile(absolute);
    if (looksBinary(buffer)) throw new Error('Binary files cannot be opened in the editor');
    return {
      path: normalizeRelative(relative),
      content: buffer.toString('utf8'),
      language: languageFromPath(relative),
      size: stat.size,
      mtime: stat.mtimeMs,
    };
  }

  async writeFile(relative: string, content: string): Promise<{ mtime: number }> {
    const absolute = await this.resolveSafe(relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, 'utf8');
    const stat = await fs.stat(absolute);
    return { mtime: stat.mtimeMs };
  }

  async createFile(relative: string, content = ''): Promise<void> {
    const absolute = await this.resolveSafe(relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, { encoding: 'utf8', flag: 'wx' });
  }

  async createDirectory(relative: string): Promise<void> {
    const absolute = await this.resolveSafe(relative);
    await fs.mkdir(absolute, { recursive: true });
  }

  async rename(oldRelative: string, newRelative: string): Promise<void> {
    const from = await this.resolveSafe(oldRelative, false);
    const to = await this.resolveSafe(newRelative);
    const exists = await fs
      .access(to)
      .then(() => true)
      .catch(() => false);
    if (exists) throw new Error('A file or folder with that name already exists');
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
  }

  async remove(relatives: string[], approved: boolean): Promise<void> {
    if (!approved) throw new Error('Deletion requires explicit approval');
    for (const relative of relatives) {
      const absolute = await this.resolveSafe(relative, false);
      await fs.rm(absolute, { recursive: true, force: false });
    }
  }

  async reveal(relative: string): Promise<void> {
    const absolute = await this.resolveSafe(relative, false);
    shell.showItemInFolder(absolute);
  }

  canRead(relative: string): boolean {
    return !normalizeRelative(relative).split('/').includes('..');
  }

  async loadRules(): Promise<RuleFile[]> {
    const rules: RuleFile[] = [];
    await fs.mkdir(this.rulesDir, { recursive: true });
    const globalFile = path.join(this.rulesDir, 'global.md');
    try {
      await fs.access(globalFile);
    } catch {
      await fs.writeFile(globalFile, defaultGlobalRulesTemplate(), 'utf8');
    }
    const globalContent = await fs.readFile(globalFile, 'utf8').catch(() => '');
    if (globalContent.trim()) {
      rules.push({ path: 'global.md', scope: 'global', name: 'Global rules', content: globalContent.slice(0, 60_000) });
    }
    for (const candidate of DEFAULT_RULE_FILES) {
      const content = await fs.readFile(path.join(this.root, candidate), 'utf8').catch(() => null);
      if (content?.trim()) {
        rules.push({
          path: candidate,
          scope: 'project',
          name: path.basename(candidate),
          content: content.slice(0, 60_000),
        });
      }
    }
    for (const dir of DEFAULT_RULE_DIRS) {
      const absolute = path.join(this.root, dir);
      let entries: string[] = [];
      try {
        entries = await fs.readdir(absolute);
      } catch {
        continue;
      }
      for (const entry of entries.slice(0, 60)) {
        if (!/\.(md|mdc|txt)$/i.test(entry)) continue;
        const content = await fs.readFile(path.join(absolute, entry), 'utf8').catch(() => null);
        if (content?.trim()) {
          rules.push({
            path: `${dir}/${entry}`,
            scope: 'project',
            name: entry,
            content: content.slice(0, 60_000),
          });
        }
      }
    }
    return rules;
  }

  async saveGlobalRule(name: string, content: string): Promise<void> {
    await fs.mkdir(this.rulesDir, { recursive: true });
    const safeName = name.replace(/[^a-z0-9-_]/gi, '-');
    await fs.writeFile(path.join(this.rulesDir, `${safeName}.md`), content, 'utf8');
  }
}

const DEFAULT_RULE_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
  'FORGEAI.md',
  '.sopuforge/rules.md',
  '.kiro/steering.md',
  '.kiro/steering/product.md',
  '.kiro/steering/tech.md',
  '.kiro/steering/structure.md',
];

const DEFAULT_RULE_DIRS = ['.cursor/rules', '.sopuforge/rules', '.kiro/rules'];
