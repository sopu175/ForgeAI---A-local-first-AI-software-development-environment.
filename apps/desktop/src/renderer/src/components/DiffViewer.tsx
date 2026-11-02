import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileDiff } from 'lucide-react';
import type { FileChange } from '@forgeai/shared';
import { cn } from './ui';

export interface DiffViewerProps {
  changes: FileChange[];
  selectedHunks?: Set<string>;
  onToggleHunk?: (path: string, hunkIndex: number) => void;
  onOpenFile?: (path: string) => void;
  className?: string;
  defaultCollapsed?: boolean;
}

export function hunkKey(path: string, index: number): string {
  return `${path}:${index}`;
}

export function DiffViewer({
  changes,
  selectedHunks,
  onToggleHunk,
  onOpenFile,
  className,
  defaultCollapsed = false,
}: DiffViewerProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    if (defaultCollapsed) for (const change of changes) initial[change.path] = true;
    return initial;
  });

  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const change of changes) {
      additions += change.additions;
      deletions += change.deletions;
    }
    return { additions, deletions };
  }, [changes]);

  if (changes.length === 0) {
    return <p className={cn('px-3 py-4 text-[11.5px] text-faint', className)}>No changes.</p>;
  }

  return (
    <div className={cn('min-h-0', className)}>
      <div className="flex items-center gap-2 border-b border-line-soft bg-panel-2 px-3 py-1.5 text-[10.5px] text-faint">
        <FileDiff size={11} />
        <span>
          {changes.length} file{changes.length === 1 ? '' : 's'}
        </span>
        <span className="text-success">+{totals.additions}</span>
        <span className="text-danger">−{totals.deletions}</span>
      </div>
      {changes.map((change) => {
        const isCollapsed = collapsed[change.path] ?? false;
        return (
          <section key={change.path} className="border-b border-line-soft last:border-0">
            <div className="flex items-center gap-1.5 bg-panel-2 px-2 py-1.5">
              <button
                type="button"
                onClick={() => setCollapsed((current) => ({ ...current, [change.path]: !isCollapsed }))}
                className="focus-ring flex min-w-0 flex-1 items-center gap-1.5 text-left"
                title={change.path}
              >
                {isCollapsed ? (
                  <ChevronRight size={11} className="shrink-0 text-faint" />
                ) : (
                  <ChevronDown size={11} className="shrink-0 text-faint" />
                )}
                <span
                  className={cn(
                    'shrink-0 rounded px-1 text-[9px] font-semibold uppercase',
                    change.changeType === 'create'
                      ? 'bg-success-soft text-success'
                      : change.changeType === 'delete'
                        ? 'bg-danger-soft text-danger'
                        : 'bg-warning-soft text-warning',
                  )}
                >
                  {change.changeType}
                </span>
                <span className="truncate font-mono text-[11px] text-fg">{change.path}</span>
              </button>
              {onOpenFile ? (
                <button
                  type="button"
                  className="shrink-0 text-[9.5px] text-faint hover:text-fg"
                  onClick={() => onOpenFile(change.path)}
                >
                  open
                </button>
              ) : null}
              <span className="shrink-0 text-[9.5px] text-success">+{change.additions}</span>
              <span className="shrink-0 text-[9.5px] text-danger">−{change.deletions}</span>
            </div>

            {!isCollapsed ? (
              <div className="max-h-[420px] overflow-auto bg-bg">
                {change.truncated ? (
                  <p className="border-b border-line-soft px-3 py-1 text-[10px] text-warning">
                    Diff truncated — open the file to inspect the rest.
                  </p>
                ) : null}
                {change.hunks.map((hunk) => {
                  const key = hunkKey(change.path, hunk.index);
                  const selected = selectedHunks ? selectedHunks.has(key) : true;
                  return (
                    <div key={key} className={cn('relative', selectedHunks && !selected && 'opacity-45')}>
                      <div className="diff-hunk-header flex items-center gap-2">
                        <span>
                          @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                        </span>
                        {onToggleHunk ? (
                          <label className="ml-auto flex cursor-pointer items-center gap-1 text-[9.5px] text-faint hover:text-fg">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => onToggleHunk(change.path, hunk.index)}
                              className="!h-3 !w-3 !rounded-sm !border-line !bg-panel-2 !p-0"
                            />
                            apply hunk
                          </label>
                        ) : null}
                      </div>
                      {hunk.lines.map((line, index) => (
                        <div
                          key={`${key}:${index}`}
                          className={cn(
                            'diff-line',
                            line.type === 'add' && 'diff-add',
                            line.type === 'delete' && 'diff-del',
                          )}
                        >
                          <span className="diff-gutter">
                            <span className="w-6 text-right">{line.type === 'delete' ? line.oldLine : ''}</span>
                            <span className="w-6 text-right">
                              {line.type === 'add' ? line.newLine : line.type === 'context' ? line.newLine : ''}
                            </span>
                          </span>
                          <span
                            className={cn(
                              'diff-content',
                              line.type === 'add'
                                ? 'text-success'
                                : line.type === 'delete'
                                  ? 'text-danger'
                                  : 'text-muted',
                            )}
                          >
                            {line.type === 'add' ? '+' : line.type === 'delete' ? '−' : ' '}
                            {line.text || ' '}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
                {change.hunks.length === 0 ? (
                  <p className="px-3 py-2 text-[11px] text-faint">
                    {change.changeType === 'create'
                      ? 'New file — content preview available in the editor.'
                      : 'No textual hunks to show.'}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
