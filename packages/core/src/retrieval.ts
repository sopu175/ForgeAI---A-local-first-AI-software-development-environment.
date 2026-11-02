import type { RetrievalResult } from '@forgeai/shared';
import { cosineSimilarity, dotSimilarity } from './vector';

export interface VectorCandidate {
  chunkId: number;
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  vector: Float32Array;
}

export interface TextCandidate {
  chunkId: number;
  path: string;
  startLine: number;
  endLine: number;
  content: string;
}

export function rankByVector(
  query: Float32Array,
  candidates: VectorCandidate[],
  limit = 12,
  minScore = 0.12,
): RetrievalResult[] {
  const scored: RetrievalResult[] = [];
  for (const candidate of candidates) {
    if (candidate.vector.length !== query.length) continue;
    // Both the query vector and stored vectors are L2-normalised, so dot product
    // equals cosine similarity — no sqrt needed, ~2× faster.
    const score = dotSimilarity(query, candidate.vector);
    if (score < minScore) continue;
    scored.push({
      path: candidate.path,
      startLine: candidate.startLine,
      endLine: candidate.endLine,
      content: candidate.content,
      score,
      reason: 'vector',
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'this',
  'that',
  'from',
  'have',
  'into',
  'when',
  'then',
  'than',
  'are',
  'was',
  'you',
  'your',
  'our',
  'can',
  'will',
  'should',
  'would',
  'could',
  'please',
  'make',
  'add',
  'create',
  'code',
  'file',
  'files',
  'using',
  'use',
  'how',
  'what',
  'why',
  'where',
  'which',
  'not',
  'but',
  'all',
  'any',
  'the',
]);

export function tokenize(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[a-z_$][\w$.-]{2,}/g) ?? [])].filter(
    (token) => token.length > 2 && !STOPWORDS.has(token),
  );
}

export function rankByKeywords(query: string, candidates: TextCandidate[], limit = 10): RetrievalResult[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const results: RetrievalResult[] = [];
  for (const candidate of candidates) {
    const haystack = `${candidate.path}\n${candidate.content}`.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      let index = haystack.indexOf(token);
      let occurrences = 0;
      while (index !== -1 && occurrences < 12) {
        occurrences += 1;
        index = haystack.indexOf(token, index + token.length);
      }
      if (occurrences > 0) score += 1 + Math.log(occurrences);
      if (candidate.path.toLowerCase().includes(token)) score += 3;
    }
    if (score > 0) {
      results.push({
        path: candidate.path,
        startLine: candidate.startLine,
        endLine: candidate.endLine,
        content: candidate.content,
        score,
        reason: 'text',
      });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export function mergeResults(...lists: RetrievalResult[][]): RetrievalResult[] {
  const merged = new Map<string, RetrievalResult>();
  for (const list of lists) {
    for (const result of list) {
      const key = `${result.path}:${result.startLine}:${result.endLine}`;
      const existing = merged.get(key);
      if (!existing || existing.score < result.score) merged.set(key, result);
    }
  }
  return [...merged.values()].sort((a, b) => b.score - a.score);
}

export function fileOverlapBoost(results: RetrievalResult[], activeFiles: string[]): RetrievalResult[] {
  if (activeFiles.length === 0) return results;
  const active = new Set(activeFiles);
  return results
    .map((result) => ({
      ...result,
      score: active.has(result.path) ? result.score * 1.12 : result.score,
    }))
    .sort((a, b) => b.score - a.score);
}
