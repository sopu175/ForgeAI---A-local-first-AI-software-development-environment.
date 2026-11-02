import { describe, expect, it } from 'vitest';
import {
  applySelectedHunks,
  blobToVector,
  computeDiffLines,
  cosineSimilarity,
  createFileChange,
  normalizeVector,
  topK,
  unifiedPatch,
  vectorToBlob,
} from '@forgeai/core';

describe('diff engine', () => {
  const before = `${['alpha', 'beta', 'gamma', 'delta', 'epsilon'].join('\n')}\n`;
  const after = `${['alpha', 'BETA', 'gamma', 'delta', 'epsilon', 'zeta'].join('\n')}\n`;

  it('counts additions and deletions', () => {
    const change = createFileChange('src/example.ts', before, after);
    expect(change.changeType).toBe('update');
    expect(change.additions).toBe(2);
    expect(change.deletions).toBe(1);
    expect(change.hunks.length).toBeGreaterThan(0);
  });

  it('applies every hunk when all are accepted', () => {
    const change = createFileChange('src/example.ts', before, after);
    expect(applySelectedHunks(before, change, undefined)).toBe(after);
    expect(
      applySelectedHunks(
        before,
        change,
        change.hunks.map((hunk) => hunk.index),
      ),
    ).toBe(after);
  });

  it('keeps rejected hunks out of the result', () => {
    const change = createFileChange('src/example.ts', before, after);
    const result = applySelectedHunks(before, change, []);
    expect(result).toBe(before);
  });

  it('marks created and deleted files', () => {
    expect(createFileChange('new.ts', '', 'export {};\n').changeType).toBe('create');
    expect(createFileChange('old.ts', 'export {};\n', '').changeType).toBe('delete');
  });

  it('emits a unified patch with headers', () => {
    const change = createFileChange('src/example.ts', before, after);
    const patch = unifiedPatch('src/example.ts', change);
    expect(patch).toContain('--- a/src/example.ts');
    expect(patch).toContain('+++ b/src/example.ts');
    expect(patch).toContain('@@');
    expect(patch).toContain('+BETA');
  });

  it('tracks line numbers in the diff', () => {
    const lines = computeDiffLines('a\nb\n', 'a\nc\n');
    const added = lines.find((line) => line.type === 'add');
    expect(added?.text).toBe('c');
    expect(added?.newLine).toBe(2);
  });
});

describe('vector helpers', () => {
  it('normalizes to unit length', () => {
    const normalized = normalizeVector([3, 4]);
    expect(normalized[0]).toBeCloseTo(0.6);
    expect(normalized[1]).toBeCloseTo(0.8);
  });

  it('round-trips through the SQLite blob representation', () => {
    const vector = normalizeVector([1, -2, 3.5, 0]);
    const blob = vectorToBlob(vector);
    expect(blob).toBeInstanceOf(Uint8Array);
    expect(Array.from(blobToVector(blob))).toEqual(Array.from(vector));
  });

  it('scores similarity and returns the top k', () => {
    const a = normalizeVector([1, 0]);
    const b = normalizeVector([1, 0]);
    const c = normalizeVector([0, 1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1);
    expect(cosineSimilarity(a, c)).toBeCloseTo(0);
    expect(cosineSimilarity(new Float32Array(), a)).toBe(0);

    const results = topK(
      [
        { id: 'a', vector: a },
        { id: 'b', vector: c },
      ],
      1,
      (item) => cosineSimilarity(item.vector, a),
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('a');
  });
});
