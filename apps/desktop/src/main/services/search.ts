import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { languageFromPath, type FileSearchResult, type SearchOptions, type TextSearchResult } from '@forgeai/shared';
import { HEAVY_IGNORE, SECRET_IGNORE, scanProject } from '@forgeai/core';
import type { WorkspaceService } from './workspace';

interface RgMatchEvent {
  type: string;
  data?: {
    path?: { text?: string };
    lines?: { text?: string };
    line_number?: number;
    submatches?: Array<{ start?: number; end?: number }>;
  };
}

export class SearchService {
  private rgPath: string | null | undefined;

  constructor(private readonly workspace: WorkspaceService) {}

  private async findRipgrep(): Promise<string | null> {
    if (this.rgPath !== undefined) return this.rgPath;
    const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
    const names = process.platform === 'win32' ? ['rg.exe', 'rg'] : ['rg'];
    for (const directory of pathEntries) {
      for (const name of names) {
        const candidate = path.join(directory, name);
        try {
          await fs.access(candidate);
          this.rgPath = candidate;
          return candidate;
        } catch {
          // keep looking
        }
      }
    }
    this.rgPath = null;
    return null;
  }

  private quoteGlob(pattern: string): string {
    return pattern.includes('/') || pattern.includes('*') ? pattern : `**/${pattern}`;
  }

  async text(options: SearchOptions): Promise<TextSearchResult[]> {
    const rg = await this.findRipgrep();
    const maxResults = Math.min(options.maxResults ?? 500, 2000);
    if (rg) {
      const results = await this.rgSearch(rg, options, maxResults);
      if (results) return results;
    }
    return this.fallbackText(options, maxResults);
  }

  private rgSearch(rg: string, options: SearchOptions, maxResults: number): Promise<TextSearchResult[] | null> {
    return new Promise((resolve) => {
      const args = ['--json', '--line-number', '--no-heading', '--color=never', '--max-filesize', '2M'];
      if (options.caseSensitive) args.push('--case-sensitive');
      else args.push('--ignore-case');
      if (!options.regex) args.push('--fixed-strings');
      if (options.wholeWord) args.push('--word-regexp');
      for (const include of (options.include ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)) {
        args.push('-g', this.quoteGlob(include));
      }
      for (const exclude of (options.exclude ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)) {
        args.push('-g', `!${this.quoteGlob(exclude)}`);
      }
      for (const ignore of ['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '.next', '.venv']) {
        args.push('-g', `!${ignore}`);
      }
      args.push('--', options.query);

      const child = spawn(rg, args, { cwd: this.workspace.root, stdio: ['ignore', 'pipe', 'pipe'] });
      const results: TextSearchResult[] = [];
      let buffer = '';
      let settled = false;
      const finish = (value: TextSearchResult[] | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(results.length ? results : null);
      }, 20_000);

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        let index = buffer.indexOf('\n');
        while (index !== -1) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          index = buffer.indexOf('\n');
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as RgMatchEvent;
            if (event.type !== 'match' || !event.data) continue;
            const filePath = event.data.path?.text ?? '';
            const rawLine = (event.data.lines?.text ?? '').replace(/\n$/, '');
            const match = event.data.submatches?.[0];
            const relative = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
            results.push({
              path: relative,
              line: event.data.line_number ?? 1,
              column: (match?.start ?? 0) + 1,
              preview: rawLine.length > 400 ? `${rawLine.slice(0, 400)}…` : rawLine,
              matchLength: Math.max(1, (match?.end ?? 1) - (match?.start ?? 0)),
            });
            if (results.length >= maxResults) {
              child.kill('SIGTERM');
              return;
            }
          } catch {
            // ignore malformed JSONL
          }
        }
      });
      child.on('error', () => {
        clearTimeout(timer);
        finish(null);
      });
      child.on('close', () => {
        clearTimeout(timer);
        finish(results);
      });
    });
  }

  private async fallbackText(options: SearchOptions, maxResults: number): Promise<TextSearchResult[]> {
    let matcher: RegExp;
    try {
      const escaped = options.regex ? options.query : options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const source = options.wholeWord ? `\\b${escaped}\\b` : escaped;
      matcher = new RegExp(source, options.caseSensitive ? 'g' : 'gi');
    } catch {
      return [];
    }
    const files = await scanProject(this.workspace.root, { maxFileSizeKb: 1024 });
    const results: TextSearchResult[] = [];
    for (const file of files) {
      if (results.length >= maxResults) break;
      if (options.include) {
        const include = options.include.split(',').map((value) => value.trim());
        if (!include.some((pattern) => file.path.includes(pattern.replace(/\*/g, '')))) continue;
      }
      let content: string;
      try {
        content = await fs.readFile(path.join(this.workspace.root, file.path), 'utf8');
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length && results.length < maxResults; index += 1) {
        const text = lines[index] ?? '';
        matcher.lastIndex = 0;
        const match = matcher.exec(text);
        if (!match) continue;
        results.push({
          path: file.path,
          line: index + 1,
          column: match.index + 1,
          preview: text.length > 400 ? `${text.slice(0, 400)}…` : text,
          matchLength: Math.max(1, match[0].length),
        });
      }
    }
    return results;
  }

  async files(query: string, limit = 100): Promise<string[]> {
    const rg = await this.findRipgrep();
    let files: string[] = [];
    if (rg) {
      files = await this.rgFiles(rg);
    }
    if (files.length === 0) {
      files = (await scanProject(this.workspace.root, { maxFileSizeKb: 1024 })).map((file) => file.path);
    }
    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery) {
      return files.sort((a, b) => a.localeCompare(b)).slice(0, limit);
    }
    const scored: FileSearchResult[] = files
      .map((file) => ({ path: file, score: fuzzyScore(normalizedQuery, file.toLowerCase()) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return scored.map((entry) => entry.path);
  }

  private rgFiles(rg: string): Promise<string[]> {
    return new Promise((resolve) => {
      const args = [
        '--files',
        '--hidden',
        '--glob',
        '!.git',
        ...HEAVY_IGNORE.flatMap((pattern) => ['--glob', `!${pattern.replace('**/', '')}`]),
        ...SECRET_IGNORE.flatMap((pattern) => ['--glob', `!${pattern.replace('**/', '')}`]),
      ];
      const child = spawn(rg, args, { cwd: this.workspace.root, stdio: ['ignore', 'pipe', 'ignore'] });
      let output = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        output += chunk;
        if (output.length > 4_000_000) child.kill();
      });
      child.on('error', () => resolve([]));
      child.on('close', () => {
        resolve(
          output
            .split(/\r?\n/)
            .filter((line) => line.trim().length > 0)
            .map((line) => line.replace(/\\/g, '/')),
        );
      });
    });
  }
}

function fuzzyScore(query: string, candidate: string): number {
  if (candidate.endsWith(`/${query}`) || candidate === query) return 1000;
  const base = path.posix.basename(candidate);
  if (base === query) return 900;
  if (base.startsWith(query)) return 800 - base.length;
  if (candidate.includes(query)) return 600 - candidate.length / 10;
  let score = 0;
  let index = 0;
  let streak = 0;
  for (const char of query) {
    const found = candidate.indexOf(char, index);
    if (found === -1) return 0;
    if (found === index) streak += 1;
    else streak = 0;
    score += 5 + streak * 4 - Math.min(3, found - index);
    index = found + 1;
  }
  return Math.max(1, score - candidate.length / 30);
}

export function languageForSearch(path: string): string {
  return languageFromPath(path);
}
