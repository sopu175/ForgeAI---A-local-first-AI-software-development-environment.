import { describe, it, expect } from 'vitest';
import { rankByKeywords, rankByVector, mergeResults, fileOverlapBoost, tokenize } from './retrieval';
import { normalizeVector } from './vector';
import type { RetrievalResult } from '@forgeai/shared';

const makeResult = (path: string, score: number, reason: RetrievalResult['reason'] = 'text'): RetrievalResult => ({
  path,
  startLine: 1,
  endLine: 10,
  score,
  content: `content of ${path}`,
  reason,
});

describe('tokenize', () => {
  it('lowercases and deduplicates tokens', () => {
    const tokens = tokenize('IndexService IndexService');
    expect(tokens.filter((t) => t === 'indexservice')).toHaveLength(1);
  });

  it('strips stopwords', () => {
    const tokens = tokenize('how can the agent use files');
    expect(tokens).not.toContain('how');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('can');
    expect(tokens).not.toContain('use');
  });

  it('returns empty array for all-stopword input', () => {
    expect(tokenize('the and for with')).toHaveLength(0);
  });

  it('requires tokens of length > 2', () => {
    const tokens = tokenize('ab cd efg');
    expect(tokens).not.toContain('ab');
    expect(tokens).not.toContain('cd');
    expect(tokens).toContain('efg');
  });
});

describe('rankByKeywords', () => {
  const candidates = [
    {
      chunkId: 1,
      path: 'src/auth/login.ts',
      startLine: 1,
      endLine: 20,
      content: 'function loginUser(email, password)',
    },
    { chunkId: 2, path: 'src/api/routes.ts', startLine: 1, endLine: 10, content: 'router.get("/health", healthCheck)' },
    { chunkId: 3, path: 'src/auth/token.ts', startLine: 1, endLine: 15, content: 'function generateToken(userId)' },
  ];

  it('scores matches above zero', () => {
    const results = rankByKeywords('login user authentication', candidates, 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.path).toBe('src/auth/login.ts');
  });

  it('returns empty array when no tokens match', () => {
    const results = rankByKeywords('the and for', candidates, 5);
    expect(results).toHaveLength(0);
  });

  it('boosts path matches', () => {
    const results = rankByKeywords('token', candidates, 5);
    const tokenResult = results.find((r) => r.path === 'src/auth/token.ts');
    expect(tokenResult).toBeDefined();
    // Path contains "token", so it should score higher than a content-only match
    expect(tokenResult!.score).toBeGreaterThan(1);
  });

  it('respects the limit', () => {
    const results = rankByKeywords('auth token login', candidates, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('results are sorted descending by score', () => {
    const results = rankByKeywords('auth login token', candidates, 10);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });
});

describe('rankByVector', () => {
  function makeCandidate(id: number, vec: number[]) {
    const vector = normalizeVector(vec);
    return { chunkId: id, path: `chunk${id}.ts`, startLine: 1, endLine: 5, content: `chunk ${id}`, vector };
  }

  it('returns the closest vector', () => {
    const query = normalizeVector([1, 0, 0]);
    const candidates = [
      makeCandidate(1, [1, 0, 0]), // identical
      makeCandidate(2, [0, 1, 0]), // orthogonal
      makeCandidate(3, [-1, 0, 0]), // opposite
    ];
    const results = rankByVector(query, candidates, 3);
    expect(results[0]!.path).toBe('chunk1.ts');
  });

  it('filters results below minScore', () => {
    const query = normalizeVector([1, 0]);
    const candidates = [makeCandidate(1, [0, 1])]; // orthogonal → score ~0
    const results = rankByVector(query, candidates, 5, 0.12);
    expect(results).toHaveLength(0);
  });

  it('skips candidates with mismatched dimensions', () => {
    const query = normalizeVector([1, 0, 0]);
    const candidate = {
      chunkId: 1,
      path: 'x.ts',
      startLine: 1,
      endLine: 1,
      content: '',
      vector: normalizeVector([1, 0]),
    };
    const results = rankByVector(query, [candidate], 5);
    expect(results).toHaveLength(0);
  });

  it('respects the limit', () => {
    const query = normalizeVector([1, 1, 1]);
    const candidates = Array.from({ length: 10 }, (_, i) => makeCandidate(i, [i + 1, 1, 1]));
    const results = rankByVector(query, candidates, 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});

describe('mergeResults', () => {
  it('deduplicates by path:startLine:endLine key, keeping the higher score', () => {
    const a = [makeResult('a.ts', 0.9), makeResult('b.ts', 0.5)];
    const b = [makeResult('a.ts', 0.7), makeResult('c.ts', 0.8)];
    const merged = mergeResults(a, b);
    const aEntry = merged.find((r) => r.path === 'a.ts');
    expect(aEntry!.score).toBe(0.9);
    expect(merged).toHaveLength(3);
  });

  it('sorts by score descending', () => {
    const a = [makeResult('x.ts', 0.3)];
    const b = [makeResult('y.ts', 0.9)];
    const merged = mergeResults(a, b);
    expect(merged[0]!.path).toBe('y.ts');
  });
});

describe('fileOverlapBoost', () => {
  it('boosts results whose path is in activeFiles', () => {
    const results = [makeResult('active.ts', 0.5), makeResult('other.ts', 0.5)];
    const boosted = fileOverlapBoost(results, ['active.ts']);
    const activeEntry = boosted.find((r) => r.path === 'active.ts');
    const otherEntry = boosted.find((r) => r.path === 'other.ts');
    expect(activeEntry!.score).toBeGreaterThan(otherEntry!.score);
  });

  it('does not change results when activeFiles is empty', () => {
    const results = [makeResult('a.ts', 0.5)];
    const boosted = fileOverlapBoost(results, []);
    expect(boosted[0]!.score).toBe(0.5);
  });

  it('returns results sorted by score', () => {
    // a.ts starts at 0.8, gets a 1.12× boost → 0.896; b.ts stays at 0.5
    const results = [makeResult('a.ts', 0.8), makeResult('b.ts', 0.5)];
    const boosted = fileOverlapBoost(results, ['a.ts']);
    expect(boosted[0]!.path).toBe('a.ts');
  });
});
