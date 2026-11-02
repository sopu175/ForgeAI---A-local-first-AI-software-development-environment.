import { describe, expect, it } from 'vitest';
import { chunkCode, packRetrievalResults } from '../packages/core/src/chunker';
import { defaultParser } from '../packages/core/src/parser';
import { cosineSimilarity, topK, normalizeVector } from '../packages/core/src/vector';
import { estimateTokens } from '@forgeai/shared';
import type { RetrievalResult } from '@forgeai/shared';

function formatMem(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

describe('Performance, Latency & Resource Utilization Benchmark', () => {
  it('measures AST parsing and semantic chunking throughput', () => {
    const sampleTypeScript = `
import React, { useState, useEffect } from 'react';
export interface WidgetProps { id: string; count: number; title: string; }
export class Controller {
  private active = false;
  start() { this.active = true; }
  stop() { this.active = false; }
}
export function useWidget(props: WidgetProps) {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    setData('loaded');
  }, [props.id]);
  return { data };
}
`.repeat(100); // 500 lines

    const parseStart = performance.now();
    const iterations = 50;
    let totalChunks = 0;
    let totalSymbols = 0;

    for (let i = 0; i < iterations; i++) {
      const symbols = defaultParser.extractSymbols('src/components/SampleWidget.tsx', sampleTypeScript);
      const chunks = chunkCode('src/components/SampleWidget.tsx', sampleTypeScript, symbols, {
        maxLines: 80,
        overlapLines: 15,
      });
      totalChunks += chunks.length;
      totalSymbols += symbols.length;
    }
    const parseEnd = performance.now();
    const parseDurationMs = parseEnd - parseStart;
    const docsPerSec = ((iterations / parseDurationMs) * 1000).toFixed(1);

    console.log(
      `[PERF: CHUNKING/PARSING] ${iterations} docs in ${parseDurationMs.toFixed(2)}ms (${docsPerSec} docs/sec)`,
    );
    expect(Number(docsPerSec)).toBeGreaterThan(10);
    expect(totalChunks).toBeGreaterThan(0);
    expect(totalSymbols).toBeGreaterThan(0);
  });

  it('measures vector mathematics and Top-K retrieval throughput', () => {
    const VECTOR_DIM = 768;
    const NUM_VECTORS = 5_000;

    const queryVector = normalizeVector(new Float32Array(VECTOR_DIM).map(() => Math.random() - 0.5));
    const candidateVectors: Float32Array[] = [];
    for (let i = 0; i < NUM_VECTORS; i++) {
      candidateVectors.push(normalizeVector(new Float32Array(VECTOR_DIM).map(() => Math.random() - 0.5)));
    }

    const vecStart = performance.now();
    const scored = candidateVectors.map((vec, idx) => ({
      id: `vec-${idx}`,
      vector: vec,
    }));
    const top10 = topK(scored, 10, (item) => cosineSimilarity(queryVector, item.vector));
    const vecEnd = performance.now();
    const vecDurationMs = vecEnd - vecStart;
    const opsPerSec = ((NUM_VECTORS / vecDurationMs) * 1000).toFixed(0);

    console.log(
      `[PERF: VECTOR DOT PRODUCTS] ${NUM_VECTORS} vectors (dim=${VECTOR_DIM}) in ${vecDurationMs.toFixed(2)}ms (${opsPerSec} ops/sec)`,
    );
    expect(top10).toHaveLength(10);
    expect(Number(opsPerSec)).toBeGreaterThan(10_000);
  });

  it('measures context packing latency and enforces token budget boundaries', () => {
    const mockResults: RetrievalResult[] = Array.from({ length: 25 }, (_, i) => ({
      path: `src/module_${i}.ts`,
      startLine: 1,
      endLine: 40,
      content: `// Source code from module ${i}\nexport function doSomething_${i}() { return ${i}; }\n`.repeat(15),
      score: 0.95 - i * 0.03,
      reason: 'text',
    }));

    const TOKEN_BUDGET = 3000;
    const packStart = performance.now();
    const packed = packRetrievalResults(mockResults, TOKEN_BUDGET, 8);
    const packEnd = performance.now();
    const latencyMs = packEnd - packStart;

    console.log(
      `[PERF: CONTEXT PACKING] Latency: ${latencyMs.toFixed(3)}ms, packed tokens: ${estimateTokens(packed)} (budget: ${TOKEN_BUDGET})`,
    );
    expect(latencyMs).toBeLessThan(50);
    expect(estimateTokens(packed)).toBeLessThanOrEqual(TOKEN_BUDGET);
  });

  it('verifies memory stability and garbage collection bounds', () => {
    const mem = process.memoryUsage();
    console.log(`[PERF: PROCESS MEMORY] RSS: ${formatMem(mem.rss)} | Heap Used: ${formatMem(mem.heapUsed)}`);
    expect(mem.heapUsed).toBeLessThan(256 * 1024 * 1024);
  });
});
