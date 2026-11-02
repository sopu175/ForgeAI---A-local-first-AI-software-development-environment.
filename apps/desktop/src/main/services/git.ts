import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitDiffFile, GitFileState, GitFileStatus, GitLogEntry, GitStatus } from '@forgeai/shared';
import type { WorkspaceService } from './workspace';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 12 * 1024 * 1024;

export class GitService {
  constructor(private readonly workspace: WorkspaceService) {}

  private async run(args: string[], allowFailure = false): Promise<{ stdout: string; stderr: string; code: number }> {
    try {
      const { stdout, stderr } = await execFileAsync('git', args, {
        cwd: this.workspace.root,
        maxBuffer: MAX_BUFFER,
        timeout: 30_000,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat' },
      });
      return { stdout, stderr, code: 0 };
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
      if (allowFailure) {
        return {
          stdout: failure.stdout ?? '',
          stderr: failure.stderr ?? failure.message,
          code: typeof failure.code === 'number' ? failure.code : 1,
        };
      }
      throw new Error((failure.stderr ?? failure.message ?? 'git failed').trim().slice(0, 2000));
    }
  }

  async isRepo(): Promise<boolean> {
    if (!this.workspace.isOpen()) return false;
    try {
      const { stdout, code } = await this.run(['rev-parse', '--is-inside-work-tree'], true);
      return code === 0 && stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  async status(): Promise<GitStatus | null> {
    if (!(await this.isRepo())) return null;
    const { stdout } = await this.run(['status', '--porcelain=v1', '--branch', '--untracked-files=all']);
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    let branch = 'HEAD';
    let upstream: string | undefined;
    let ahead = 0;
    let behind = 0;
    let detached = false;
    const files: GitFileStatus[] = [];

    for (const line of lines) {
      if (line.startsWith('## ')) {
        const header = line.slice(3);
        if (header.startsWith('HEAD (no branch)') || header.startsWith('No commits yet on HEAD')) {
          detached = header.startsWith('HEAD (no branch)');
          branch =
            header.replace('HEAD (no branch)', 'HEAD').replace('No commits yet on ', '').split('...')[0] ?? 'HEAD';
        } else {
          const [namePart, ...restParts] = header.split(' ');
          const [local, remote] = (namePart ?? 'HEAD').split('...');
          branch = local ?? 'HEAD';
          upstream = remote;
          const rest = restParts.join(' ');
          const aheadMatch = /ahead (\d+)/.exec(rest);
          const behindMatch = /behind (\d+)/.exec(rest);
          ahead = aheadMatch ? Number(aheadMatch[1]) : 0;
          behind = behindMatch ? Number(behindMatch[1]) : 0;
        }
        continue;
      }
      const indexCode = line[0] ?? ' ';
      const worktreeCode = line[1] ?? ' ';
      let filePath = line.slice(3);
      if (filePath.includes(' -> ')) {
        filePath = filePath.split(' -> ').pop() ?? filePath;
      }
      filePath = unquote(filePath);
      const state = mapState(indexCode, worktreeCode);
      files.push({
        path: filePath,
        index: indexCode,
        worktree: worktreeCode,
        state,
        staged: indexCode !== ' ' && indexCode !== '?',
      });
    }

    return {
      branch,
      upstream,
      ahead,
      behind,
      detached,
      clean: files.length === 0,
      files,
    };
  }

  async diff(relativePath?: string, staged = false): Promise<GitDiffFile[]> {
    if (!(await this.isRepo())) return [];
    const args = ['diff', '--no-color', '--no-ext-diff', '--unified=3'];
    if (staged) args.push('--cached');
    if (relativePath) args.push('--', relativePath);
    const { stdout } = await this.run(args, true);
    if (!stdout.trim()) return [];
    const sections = stdout.split(/^diff --git /m).filter((section) => section.trim().length > 0);
    const results: GitDiffFile[] = [];
    for (const section of sections) {
      const header = /^a\/(.+?) b\/(.+)$/m.exec(section);
      let filePath = header?.[2] ?? relativePath ?? 'unknown';
      if (filePath.includes(' -> ')) filePath = filePath.split(' -> ').pop() ?? filePath;
      let additions = 0;
      let deletions = 0;
      for (const line of section.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
        else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
      }
      results.push({ path: unquote(filePath), patch: `diff --git ${section}`, staged, additions, deletions });
    }
    return results;
  }

  async branches(): Promise<{ current: string; all: string[] }> {
    const [{ stdout: currentOut }, { stdout: allOut }] = await Promise.all([
      this.run(['branch', '--show-current'], true),
      this.run(['branch', '--format=%(refname:short)'], true),
    ]);
    return {
      current: currentOut.trim(),
      all: allOut
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    };
  }

  async checkout(branch: string): Promise<void> {
    await this.run(['checkout', branch]);
  }

  async createBranch(name: string): Promise<void> {
    await this.run(['checkout', '-b', name]);
  }

  async stage(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.run(['add', '--', ...paths]);
  }

  async unstage(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const result = await this.run(['restore', '--staged', '--', ...paths], true);
    if (result.code !== 0) {
      await this.run(['reset', '--', ...paths], true);
    }
  }

  async commit(message: string, paths?: string[]): Promise<string> {
    if (paths && paths.length > 0) await this.stage(paths);
    await this.run(['commit', '-m', message]);
    const { stdout } = await this.run(['rev-parse', 'HEAD']);
    return stdout.trim();
  }

  async log(limit = 30): Promise<GitLogEntry[]> {
    if (!(await this.isRepo())) return [];
    const { stdout } = await this.run(
      ['log', `-n${Math.min(limit, 200)}`, '--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e'],
      true,
    );
    return stdout
      .split('\x1e')
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [hash, shortHash, author, date, subject] = record.split('\x1f');
        return {
          hash: hash ?? '',
          shortHash: shortHash ?? '',
          author: author ?? '',
          date: date ?? '',
          subject: subject ?? '',
        };
      });
  }

  async discard(paths: string[]): Promise<void> {
    const status = await this.status();
    if (!status) return;
    const untracked = new Set(status.files.filter((file) => file.state === 'untracked').map((file) => file.path));
    const tracked = paths.filter((relative) => !untracked.has(relative));
    const toDelete = paths.filter((relative) => untracked.has(relative));
    if (tracked.length > 0) {
      await this.run(['restore', '--', ...tracked], true);
      await this.run(['checkout', '--', ...tracked], true);
    }
    for (const relative of toDelete) {
      const absolute = await this.workspace.resolveSafe(relative, false);
      const stat = await fs.stat(absolute);
      if (stat.isDirectory()) await fs.rm(absolute, { recursive: true, force: true });
      else await fs.unlink(absolute);
    }
  }

  async workingTreePatch(): Promise<string> {
    if (!(await this.isRepo())) return '';
    const [{ stdout: unstaged }, { stdout: staged }, status] = await Promise.all([
      this.run(['diff', '--no-color', '--unified=2'], true),
      this.run(['diff', '--cached', '--no-color', '--unified=2'], true),
      this.status(),
    ]);
    const untracked = status?.files.filter((file) => file.state === 'untracked').map((file) => `?? ${file.path}`) ?? [];
    return [staged.trim(), unstaged.trim(), untracked.length ? `Untracked files:\n${untracked.join('\n')}` : '']
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 60_000);
  }
}

function mapState(index: string, worktree: string): GitFileState {
  if (index === '?' || worktree === '?') return 'untracked';
  if (index === '!' || worktree === '!') return 'ignored';
  if (index === 'U' || worktree === 'U' || (index === 'A' && worktree === 'A') || (index === 'D' && worktree === 'D'))
    return 'conflicted';
  if (index === 'R' || worktree === 'R') return 'renamed';
  if (index === 'A' || worktree === 'A') return 'added';
  if (index === 'D' || worktree === 'D') return 'deleted';
  return 'modified';
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
  }
  return trimmed;
}

export function gitRootOf(file: string): string {
  return path.dirname(file);
}
