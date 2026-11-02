import { useMemo } from 'react';
import { FileDiff, GitCommitHorizontal } from 'lucide-react';
import type { DiffHunk, DiffLine } from '@forgeai/shared';
import type { EditorTab } from '../state/app';
import { cn, EmptyState } from './ui';

interface ParsedFile {
  path: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

function parsePatch(patch: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  let current: ParsedFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const finishHunk = () => {
    if (current && hunk) current.hunks.push(hunk);
    hunk = null;
  };

  for (const raw of patch.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      finishHunk();
      const match = /diff --git a\/(.+) b\/(.+)$/.exec(raw);
      current = { path: match?.[2] ?? match?.[1] ?? raw.slice(11), hunks: [], additions: 0, deletions: 0 };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (
      raw.startsWith('+++ ') ||
      raw.startsWith('--- ') ||
      raw.startsWith('index ') ||
      raw.startsWith('new file mode') ||
      raw.startsWith('deleted file mode') ||
      raw.startsWith('similarity index') ||
      raw.startsWith('rename ')
    ) {
      continue;
    }
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (header) {
      finishHunk();
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      hunk = {
        index: current.hunks.length,
        oldStart: oldLine,
        oldLines: Number(header[2] ?? 1),
        newStart: newLine,
        newLines: Number(header[4] ?? 1),
        lines: [],
      };
      continue;
    }
    if (!hunk || raw.startsWith('\\ No newline')) continue;
    const marker = raw.charAt(0);
    if (marker === '+') {
      hunk.lines.push({ type: 'add', text: raw.slice(1), newLine });
      newLine += 1;
      current.additions += 1;
    } else if (marker === '-') {
      hunk.lines.push({ type: 'delete', text: raw.slice(1), oldLine });
      oldLine += 1;
      current.deletions += 1;
    } else {
      hunk.lines.push({ type: 'context', text: raw.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }
  finishHunk();
  return files;
}

function lineClass(type: DiffLine['type']): string {
  if (type === 'add') return 'diff-add';
  if (type === 'delete') return 'diff-del';
  return '';
}

export function GitDiffView({ tab }: { tab: EditorTab }) {
  const files = useMemo(() => parsePatch(tab.patch ?? ''), [tab.patch]);

  if (files.length === 0) {
    return (
      <EmptyState
        icon={<FileDiff size={22} />}
        title="No textual diff"
        description="This change may be binary, untracked or already identical to HEAD."
      />
    );
  }

  return (
    <div className="h-full overflow-auto bg-bg">
      <div className="sticky top-0 z-[2] flex items-center gap-2 border-b border-line-soft bg-bg-elevated px-3 py-1.5 text-[10.5px] text-faint">
        <GitCommitHorizontal size={11} className="text-accent" />
        <span className="font-mono text-[11px] text-fg">{tab.path}</span>
        <span className="chip !h-[17px] !text-[9px]">{tab.staged ? 'staged' : 'working tree'}</span>
        <span className="ml-auto text-success">
          +{tab.additions ?? files.reduce((sum, file) => sum + file.additions, 0)}
        </span>
        <span className="text-danger">−{tab.deletions ?? files.reduce((sum, file) => sum + file.deletions, 0)}</span>
      </div>
      {files.map((file) => (
        <div key={file.path}>
          <div className="border-b border-line-soft bg-panel-2 px-3 py-1 font-mono text-[10.5px] text-muted">
            {file.path}
          </div>
          {file.hunks.map((hunk) => (
            <div key={`${file.path}:${hunk.index}`}>
              <div className="diff-hunk-header">
                @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
              </div>
              {hunk.lines.map((line, index) => (
                <div key={index} className={cn('diff-line', lineClass(line.type))}>
                  <span className="diff-gutter">
                    <span className="w-6 text-right">{line.type === 'delete' ? line.oldLine : ''}</span>
                    <span className="w-6 text-right">
                      {line.type === 'add' ? line.newLine : line.type === 'context' ? line.newLine : ''}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'diff-content',
                      line.type === 'add' ? 'text-success' : line.type === 'delete' ? 'text-danger' : 'text-muted',
                    )}
                  >
                    {line.type === 'add' ? '+' : line.type === 'delete' ? '−' : ' '}
                    {line.text || ' '}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
