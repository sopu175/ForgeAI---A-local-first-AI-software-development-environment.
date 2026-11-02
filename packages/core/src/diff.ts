import { diffLines } from 'diff';
import type { DiffHunk, DiffLine, FileChange } from '@forgeai/shared';

const MAX_LINES = 12_000;
const CONTEXT = 3;

function splitLines(value: string): string[] {
  if (value === '') return [];
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  // `diff` emits chunks that normally end at a newline; don't turn that
  // terminator into a phantom empty line in the hunk.
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function computeDiffLines(before: string, after: string): DiffLine[] {
  const parts = diffLines(before, after, { newlineIsToken: false });
  const lines: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const part of parts) {
    const partLines = splitLines(part.value);
    for (const text of partLines) {
      if (part.removed) {
        lines.push({ type: 'delete', text, oldLine });
        oldLine += 1;
      } else if (part.added) {
        lines.push({ type: 'add', text, newLine });
        newLine += 1;
      } else {
        lines.push({ type: 'context', text, oldLine, newLine });
        oldLine += 1;
        newLine += 1;
      }
    }
  }
  return lines;
}

export function buildHunks(lines: DiffLine[], context = CONTEXT): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let index = 0;
  let cursor = 0;
  while (cursor < lines.length) {
    if (lines[cursor]?.type === 'context') {
      cursor += 1;
      continue;
    }
    const start = Math.max(0, cursor - context);
    let lastChange = cursor;
    let scan = cursor;
    while (scan < lines.length) {
      if (lines[scan]?.type !== 'context') lastChange = scan;
      if (scan - lastChange > context * 2 && scan > lastChange) break;
      scan += 1;
    }
    const end = Math.min(lines.length, lastChange + context + 1);
    const slice = lines.slice(start, end);
    const oldLines = slice.filter((line) => line.type !== 'add');
    const newLines = slice.filter((line) => line.type !== 'delete');
    hunks.push({
      index: index,
      oldStart: oldLines[0]?.oldLine ?? 1,
      oldLines: oldLines.length,
      newStart: newLines[0]?.newLine ?? 1,
      newLines: newLines.length,
      lines: slice,
    });
    index += 1;
    cursor = end;
  }
  return hunks;
}

export function countChanges(lines: DiffLine[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.type === 'add') additions += 1;
    if (line.type === 'delete') deletions += 1;
  }
  return { additions, deletions };
}

export interface CreateChangeOptions {
  changeType?: FileChange['changeType'];
  maxLines?: number;
}

export function createFileChange(
  path: string,
  before: string,
  after: string,
  options: CreateChangeOptions = {},
): FileChange {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const truncated =
    beforeLines.length > (options.maxLines ?? MAX_LINES) || afterLines.length > (options.maxLines ?? MAX_LINES);
  const lines = computeDiffLines(before, after);
  const { additions, deletions } = countChanges(lines);
  const changeType = options.changeType ?? (before === '' ? 'create' : after === '' ? 'delete' : 'update');
  return {
    path,
    changeType,
    before,
    after,
    additions,
    deletions,
    hunks: buildHunks(lines),
    truncated: truncated || undefined,
  };
}

/**
 * Applies only the selected hunks to `before`. This is how partial acceptance works:
 * the new file content is reconstructed from the old content plus accepted hunks, so
 * rejected hunks remain untouched even when they sit next to accepted ones.
 */
export function applySelectedHunks(before: string, change: FileChange, accepted: number[] | undefined): string {
  if (!accepted || accepted.includes(-1)) return change.after;
  const selected = new Set(accepted);
  if (change.hunks.length === 0) return before;
  if (change.hunks.every((hunk) => selected.has(hunk.index))) return change.after;

  const beforeLines = before.replace(/\r\n/g, '\n').split('\n');
  const hunks = [...change.hunks]
    .filter((hunk) => selected.has(hunk.index))
    .sort((a, b) => b.oldStart - a.oldStart || b.index - a.index);

  for (const hunk of hunks) {
    const replacement = hunk.lines.filter((line) => line.type !== 'delete').map((line) => line.text);
    const start = Math.max(0, hunk.oldStart - 1);
    const deleteCount = hunk.oldLines;
    // A hunk may touch the trailing empty line; guard the splice range.
    const safeStart = Math.min(start, beforeLines.length);
    const safeDelete = Math.max(0, Math.min(deleteCount, beforeLines.length - safeStart));
    beforeLines.splice(safeStart, safeDelete, ...replacement);
  }
  return beforeLines.join('\n');
}

export function formatHunkHeader(hunk: DiffHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}

export function unifiedPatch(path: string, change: FileChange): string {
  const header = [
    `--- ${change.changeType === 'create' ? '/dev/null' : `a/${path}`}`,
    `+++ ${change.changeType === 'delete' ? '/dev/null' : `b/${path}`}`,
  ];
  const body = change.hunks.flatMap((hunk) => [
    formatHunkHeader(hunk),
    ...hunk.lines.map((line) => {
      const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';
      return `${prefix}${line.text}`;
    }),
  ]);
  return [...header, ...body].join('\n');
}
