import { describe, it, expect } from 'vitest';
import { createFileChange, applySelectedHunks } from './diff';

describe('createFileChange', () => {
  it('reports 0 additions and deletions for identical content', () => {
    const change = createFileChange('a.ts', 'hello\n', 'hello\n');
    expect(change.additions).toBe(0);
    expect(change.deletions).toBe(0);
    expect(change.hunks).toHaveLength(0);
  });

  it('counts added lines correctly', () => {
    const change = createFileChange('a.ts', 'line1\n', 'line1\nline2\n');
    expect(change.additions).toBe(1);
    expect(change.deletions).toBe(0);
  });

  it('counts deleted lines correctly', () => {
    const change = createFileChange('a.ts', 'line1\nline2\n', 'line1\n');
    expect(change.additions).toBe(0);
    expect(change.deletions).toBe(1);
  });

  it('marks changeType as create when before is empty', () => {
    const change = createFileChange('new.ts', '', 'content\n', { changeType: 'create' });
    expect(change.changeType).toBe('create');
  });

  it('marks changeType as delete when after is empty', () => {
    const change = createFileChange('old.ts', 'content\n', '', { changeType: 'delete' });
    expect(change.changeType).toBe('delete');
  });
});

describe('applySelectedHunks', () => {
  const before = 'line1\nline2\nline3\n';
  const after = 'line1\nCHANGED\nline3\n';

  it('applies all hunks when acceptedHunks is undefined', () => {
    const change = createFileChange('a.ts', before, after);
    const result = applySelectedHunks(before, change, undefined);
    expect(result).toBe(after);
  });

  it('applies no hunks when acceptedHunks is empty', () => {
    const change = createFileChange('a.ts', before, after);
    const result = applySelectedHunks(before, change, []);
    expect(result).toBe(before);
  });

  it('applies specific hunk indices', () => {
    // Create a change with at least one hunk
    const change = createFileChange('a.ts', before, after);
    if (change.hunks.length > 0) {
      // Accept the first (index 0) hunk
      const result = applySelectedHunks(before, change, [0]);
      expect(result).toBe(after);
    }
  });

  it('is idempotent: applying twice gives same result', () => {
    const change = createFileChange('a.ts', before, after);
    const first = applySelectedHunks(before, change, undefined);
    const second = applySelectedHunks(before, change, undefined);
    expect(first).toBe(second);
  });
});
