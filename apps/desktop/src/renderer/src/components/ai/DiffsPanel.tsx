import { useEffect, useState } from 'react';
import { ChevronRight, FileDiff, GitCompareArrows, RefreshCw } from 'lucide-react';
import type { GitDiffFile } from '@forgeai/shared';
import { useAppStore } from '../../state/app';
import { EmptyState, Spinner, cn } from '../ui';
import { DiffViewer } from '../DiffViewer';
import { errorMessage } from '../../lib/format';

export function DiffsPanel() {
  const project = useAppStore((state) => state.project);
  const agentRun = useAppStore((state) => state.agentRun);
  const openFile = useAppStore((state) => state.openFile);
  const openGitDiff = useAppStore((state) => state.openGitDiff);
  const toast = useAppStore((state) => state.toast);
  const openAI = useAppStore((state) => state.openAI);
  const git = useAppStore((state) => state.git);

  const [mode, setMode] = useState<'agent' | 'working'>('agent');
  const [diffs, setDiffs] = useState<GitDiffFile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (mode !== 'working' || !project) return;
    setLoading(true);
    window.forge.git
      .diff(project.id)
      .then(setDiffs)
      .catch((error) => toast('error', errorMessage(error)))
      .finally(() => setLoading(false));
  }, [mode, project, git?.files.length, toast]);

  const changes = agentRun?.changes ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-line-soft px-2 py-1.5">
        <div className="flex items-center gap-0.5 rounded-md border border-line bg-panel-2 p-0.5">
          <button
            type="button"
            onClick={() => setMode('agent')}
            className={cn(
              'focus-ring rounded px-2 py-0.5 text-[10.5px]',
              mode === 'agent' ? 'bg-panel-3 text-fg' : 'text-muted hover:text-fg',
            )}
          >
            Agent {changes.length > 0 ? `· ${changes.length}` : ''}
          </button>
          <button
            type="button"
            onClick={() => setMode('working')}
            className={cn(
              'focus-ring rounded px-2 py-0.5 text-[10.5px]',
              mode === 'working' ? 'bg-panel-3 text-fg' : 'text-muted hover:text-fg',
            )}
          >
            Working tree {git && git.files.length ? `· ${git.files.length}` : ''}
          </button>
        </div>
        <span className="ml-auto text-[9.5px] text-faint">
          {mode === 'agent' ? 'changes from the current or last run' : 'uncommitted changes'}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {mode === 'agent' ? (
          changes.length === 0 ? (
            <EmptyState
              icon={<FileDiff size={22} />}
              title="No agent changes yet"
              description="When the coding, debugging or testing agent writes files, hunk-level diffs appear here for review."
              action={
                <button type="button" className="btn !h-7 !text-[10.5px]" onClick={() => openAI('agent')}>
                  Open agent
                </button>
              }
            />
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-line-soft px-3 py-1.5 text-[10px] text-faint">
                <span>
                  {agentRun?.agent} · {agentRun?.status}
                </span>
                <button type="button" className="hover:text-fg" onClick={() => openAI('agent')}>
                  open activity <ChevronRight size={9} className="inline" />
                </button>
              </div>
              <DiffViewer changes={changes} onOpenFile={(path) => void openFile(path)} />
            </>
          )
        ) : !project ? (
          <EmptyState title="Open a project to review working tree changes" />
        ) : loading ? (
          <div className="flex items-center gap-2 px-3 py-3 text-[11.5px] text-faint">
            <Spinner className="!h-3 !w-3" /> Loading diffs…
          </div>
        ) : diffs.length === 0 ? (
          <EmptyState
            icon={<GitCompareArrows size={22} />}
            title="Working tree is clean"
            description="Uncommitted edits will appear here with line-level stats."
          />
        ) : (
          <div>
            {diffs.map((diff) => (
              <button
                key={`${diff.staged ? 'staged' : 'work'}:${diff.path}`}
                type="button"
                onClick={() => openGitDiff(diff)}
                className="flex w-full items-center gap-2 border-b border-line-soft px-3 py-2 text-left hover:bg-panel-2"
                title={diff.path}
              >
                <FileDiff size={12} className="shrink-0 text-warning" />
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-fg">{diff.path}</span>
                {diff.staged ? <span className="chip !h-[16px] !text-[8.5px]">staged</span> : null}
                <span className="shrink-0 text-[9.5px] text-success">+{diff.additions}</span>
                <span className="shrink-0 text-[9.5px] text-danger">−{diff.deletions}</span>
                <ChevronRight size={10} className="shrink-0 text-faint" />
              </button>
            ))}
            <p className="px-3 py-2 text-[9.5px] text-faint">
              <RefreshCw size={9} className="mr-1 inline" />
              Refresh by reopening this tab after changes.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
