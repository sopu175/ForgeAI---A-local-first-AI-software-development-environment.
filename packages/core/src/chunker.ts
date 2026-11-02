import { estimateTokens } from '@forgeai/shared';
import type { RetrievalResult, SymbolInfo } from '@forgeai/shared';

export interface CodeChunk {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  symbols: string[];
}

export interface ChunkOptions {
  maxLines?: number;
  overlapLines?: number;
  maxChars?: number;
  maxChunks?: number;
}

export function chunkCode(
  path: string,
  content: string,
  symbols: SymbolInfo[] = [],
  options: ChunkOptions = {},
): CodeChunk[] {
  const maxLines = options.maxLines ?? 90;
  const overlap = Math.max(0, Math.min(options.overlapLines ?? 12, maxLines - 1));
  const maxChars = options.maxChars ?? 7000;
  const maxChunks = options.maxChunks ?? 300;
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines.length === 0) return [];

  const symbolsByName = new Map<string, number[]>();
  for (const symbol of symbols) {
    const list = symbolsByName.get(symbol.name) ?? [];
    list.push(symbol.line);
    symbolsByName.set(symbol.name, list);
  }

  const chunks: CodeChunk[] = [];
  let start = 0;
  while (start < lines.length && chunks.length < maxChunks) {
    let end = Math.min(lines.length, start + maxLines);
    let text = lines.slice(start, end).join('\n');
    if (text.length > maxChars) {
      // Shrink the window until the chunk fits.
      let projectedEnd = end;
      while (projectedEnd > start + 1 && lines.slice(start, projectedEnd).join('\n').length > maxChars) {
        projectedEnd -= 1;
      }
      end = Math.max(start + 1, projectedEnd);
      text = lines.slice(start, end).join('\n');
    }
    if (text.length > maxChars) text = text.slice(0, maxChars);
    const symbolsInChunk = symbols
      .filter((symbol) => symbol.line >= start + 1 && symbol.line <= end)
      .map((symbol) => symbol.name);
    chunks.push({
      path,
      startLine: start + 1,
      endLine: end,
      content: text,
      symbols: [...new Set(symbolsInChunk)],
    });
    if (end >= lines.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

export function embeddingText(chunk: CodeChunk): string {
  const header = `File: ${chunk.path}\nLines: ${chunk.startLine}-${chunk.endLine}`;
  const symbolHeader = chunk.symbols.length ? `\nSymbols: ${chunk.symbols.join(', ')}` : '';
  return `${header}${symbolHeader}\n\n${chunk.content}`;
}

export function packRetrievalResults(results: RetrievalResult[], tokenBudget: number, maxResults = 12): string {
  const parts: string[] = [];
  let used = 0;
  const seen = new Set<string>();
  for (const result of results) {
    if (parts.length >= maxResults) break;
    const key = `${result.path}:${result.startLine}-${result.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const header = `### ${result.path} (L${result.startLine}-${result.endLine}) — ${result.reason}\n`;
    const body = result.content;
    const cost = estimateTokens(header + body);
    if (used + cost > tokenBudget) {
      const remaining = tokenBudget - used - estimateTokens(header);
      if (remaining < 80) break;
      const chars = Math.max(320, Math.floor(remaining * 3.2));
      parts.push(`${header}${body.slice(0, chars)}\n… [truncated]`);
      break;
    }
    used += cost;
    parts.push(`${header}${body}`);
  }
  return parts.join('\n\n');
}

export function compactFileTree(paths: string[], maxEntries = 400): string {
  const included = paths.slice(0, maxEntries);
  const mapping: Record<string, string[]> = {};
  for (const path of included) {
    const parts = path.split('/');
    const dir = parts.slice(0, -1).join('/') || '.';
    (mapping[dir] ??= []).push(parts[parts.length - 1] ?? path);
  }
  return Object.entries(mapping)
    .map(
      ([dir, files]) =>
        `${dir}/: ${files.slice(0, 25).join(', ')}${files.length > 25 ? ` …+${files.length - 25}` : ''}`,
    )
    .join('\n');
}
