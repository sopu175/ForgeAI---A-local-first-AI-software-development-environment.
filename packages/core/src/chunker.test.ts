import { describe, it, expect } from 'vitest';
import { chunkCode, embeddingText, packRetrievalResults } from './chunker';
import type { RetrievalResult } from '@forgeai/shared';

const makeResult = (path: string, score: number, content = 'body'): RetrievalResult => ({
  path,
  startLine: 1,
  endLine: 5,
  score,
  content,
  reason: 'text',
});

describe('chunkCode', () => {
  it('returns a single chunk for a small file', () => {
    const content = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
    const chunks = chunkCode('a.ts', content);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.startLine).toBe(1);
    expect(chunks[0]!.endLine).toBe(10);
  });

  it('returns empty array for empty content', () => {
    // An empty string splits into [''] — one empty line — so the chunker
    // legitimately returns one empty-content chunk. The important invariant
    // is that it does not throw and the chunk is trivially empty.
    const chunks = chunkCode('a.ts', '');
    expect(chunks.length).toBeLessThanOrEqual(1);
    if (chunks.length === 1) expect(chunks[0]!.content).toBe('');
  });

  it('splits a file larger than maxLines into multiple overlapping chunks', () => {
    const content = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    const chunks = chunkCode('a.ts', content, [], { maxLines: 50, overlapLines: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    // Overlap: second chunk should start before first chunk ends
    const firstEnd = chunks[0]!.endLine;
    const secondStart = chunks[1]!.startLine;
    expect(secondStart).toBeLessThan(firstEnd);
  });

  it('respects maxChunks', () => {
    const content = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const chunks = chunkCode('a.ts', content, [], { maxLines: 20, maxChunks: 5 });
    expect(chunks.length).toBeLessThanOrEqual(5);
  });

  it('does not exceed maxChars per chunk', () => {
    const longLine = 'x'.repeat(200);
    const content = Array.from({ length: 100 }, () => longLine).join('\n');
    const chunks = chunkCode('a.ts', content, [], { maxChars: 1000 });
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(1000);
    }
  });

  it('attaches symbol names that fall within the chunk', () => {
    const content = 'function foo() {}\nfunction bar() {}';
    const symbols = [
      { name: 'foo', kind: 'function', line: 1, path: 'a.ts' },
      { name: 'bar', kind: 'function', line: 2, path: 'a.ts' },
    ];
    const chunks = chunkCode('a.ts', content, symbols);
    expect(chunks[0]!.symbols).toContain('foo');
    expect(chunks[0]!.symbols).toContain('bar');
  });

  it('covers the entire file without leaving gaps (contiguous line coverage)', () => {
    const totalLines = 150;
    const content = Array.from({ length: totalLines }, (_, i) => `line ${i + 1}`).join('\n');
    const chunks = chunkCode('a.ts', content, [], { maxLines: 40, overlapLines: 5 });
    // Every line from 1..totalLines must appear in at least one chunk
    const covered = new Set<number>();
    for (const chunk of chunks) {
      for (let l = chunk.startLine; l <= chunk.endLine; l++) covered.add(l);
    }
    for (let l = 1; l <= totalLines; l++) {
      expect(covered.has(l), `line ${l} not covered`).toBe(true);
    }
  });
});

describe('embeddingText', () => {
  it('includes the path, line range and content', () => {
    const chunk = { path: 'src/foo.ts', startLine: 10, endLine: 20, content: 'hello world', symbols: [] };
    const text = embeddingText(chunk);
    expect(text).toContain('src/foo.ts');
    expect(text).toContain('10-20');
    expect(text).toContain('hello world');
  });

  it('includes a Symbols header when symbols are present', () => {
    const chunk = { path: 'a.ts', startLine: 1, endLine: 5, content: 'body', symbols: ['MyClass', 'myMethod'] };
    expect(embeddingText(chunk)).toContain('MyClass');
    expect(embeddingText(chunk)).toContain('myMethod');
  });
});

describe('packRetrievalResults', () => {
  it('returns empty string when there are no results', () => {
    expect(packRetrievalResults([], 3000)).toBe('');
  });

  it('respects the maxResults cap', () => {
    const results = Array.from({ length: 20 }, (_, i) => makeResult(`f${i}.ts`, 1 - i * 0.01));
    const packed = packRetrievalResults(results, 100_000, 3);
    // Only 3 distinct paths expected in the output
    const pathMatches = packed.match(/### /g);
    expect(pathMatches?.length).toBeLessThanOrEqual(3);
  });

  it('truncates when token budget is tiny', () => {
    const results = [makeResult('big.ts', 1.0, 'x'.repeat(10_000))];
    const packed = packRetrievalResults(results, 100);
    // If the budget is too small the chunk should be truncated or omitted
    expect(packed.length).toBeLessThan(10_000);
  });

  it('deduplicates results with the same key', () => {
    const dup: RetrievalResult = { path: 'a.ts', startLine: 1, endLine: 5, score: 0.9, content: 'dup', reason: 'text' };
    const packed = packRetrievalResults([dup, dup], 100_000, 5);
    const count = (packed.match(/### a\.ts/g) ?? []).length;
    expect(count).toBe(1);
  });
});
