import { describe, it, expect } from 'vitest';
import { normalizeVector, vectorToBlob, blobToVector, cosineSimilarity, dotSimilarity, topK } from './vector';

describe('normalizeVector', () => {
  it('produces a unit-length vector', () => {
    const v = normalizeVector([3, 4]);
    const norm = Math.sqrt(v[0]! ** 2 + v[1]! ** 2);
    // Float32 precision: within 1e-6
    expect(norm).toBeCloseTo(1, 5);
  });

  it('handles the zero vector without NaN', () => {
    const v = normalizeVector([0, 0, 0]);
    expect(Array.from(v)).toEqual([0, 0, 0]);
  });

  it('handles a single-element vector', () => {
    const v = normalizeVector([5]);
    expect(v[0]).toBeCloseTo(1, 10);
  });
});

describe('vectorToBlob / blobToVector round-trip', () => {
  it('round-trips a Float32Array without data loss', () => {
    const original = new Float32Array([0.1, 0.2, 0.3, -0.5]);
    const blob = vectorToBlob(original);
    const restored = blobToVector(blob);
    expect(restored.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBeCloseTo(original[i]!, 5);
    }
  });

  it('the blob copy does not share memory with the source', () => {
    const original = new Float32Array([1, 2, 3]);
    const blob = vectorToBlob(original);
    const restored = blobToVector(blob);
    original[0] = 99;
    expect(restored[0]).toBeCloseTo(1, 5);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 10);
  });

  it('returns -1 for opposite vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 10);
  });

  it('returns 0 for a zero vector', () => {
    const a = new Float32Array([0, 0]);
    const b = new Float32Array([1, 0]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('handles mismatched lengths by using the shorter', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0]);
    // Only first 2 dims compared → identical → 1
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });
});

describe('dotSimilarity', () => {
  it('equals cosineSimilarity for pre-normalised vectors', () => {
    const rawA = [3, 1, 4, 1, 5];
    const rawB = [9, 2, 6, 5, 3];
    const a = normalizeVector(rawA);
    const b = normalizeVector(rawB);
    expect(dotSimilarity(a, b)).toBeCloseTo(cosineSimilarity(a, b), 8);
  });

  it('is faster path: returns 1 for same unit vector', () => {
    const v = normalizeVector([1, 2, 3]);
    // Float32 precision: within 1e-6
    expect(dotSimilarity(v, v)).toBeCloseTo(1, 5);
  });
});

describe('topK', () => {
  it('returns k items in descending score order', () => {
    const items = [{ v: 'a' }, { v: 'b' }, { v: 'c' }, { v: 'd' }];
    const result = topK(items, 2, (item) => item.v.charCodeAt(0));
    expect(result.map((r) => r.v)).toEqual(['d', 'c']);
  });

  it('returns all items when k > length', () => {
    const items = [{ v: 1 }, { v: 2 }];
    expect(topK(items, 10, (item) => item.v)).toHaveLength(2);
  });

  it('returns empty array for k=0', () => {
    expect(topK([{ v: 1 }], 0, (item) => item.v)).toHaveLength(0);
  });
});
