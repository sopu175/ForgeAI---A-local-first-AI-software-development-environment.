import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  GitBranch,
  GitCommitHorizontal,
  Plus,
  RefreshCw,
  Sparkles,
  Undo2,
} from 'lucide-react';
import type { GitFileStatus, GitLogEntry } from '@forgeai/shared';
import { useAppStore } from '../../state/app';
import { cn, EmptyState, FileTypeIcon, IconButton, SectionLabel, Spinner } from '../ui';
import { errorMessage } from '../../lib/format';

const STATE_LABEL: Record<GitFileStatus['state'], string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicted: '!',
  ignored: 'I',
};

const STATE_COLOR: Record<GitFileStatus['state'], string> = {
  modified: 'text-warning',
  added: 'text-success',
  deleted: 'text-danger',
  renamed: 'text-cyan',
  untracked: 'text-success',
  conflicted: 'text-danger',
  ignored: 'text-faint',
};

export function SourceControl() {
  const project = useAppStore((state) => state.project);
  const git = useAppStore((state) => state.git);
  const refreshGit = useAppStore((state) => state.refreshGit);
  const openGitDiff = useAppStore((state) => state.openGitDiff);
  const openFile = useAppStore((state) => state.openFile);
  const toast = useAppStore((state) => state.toast);
  const askConfirm = useAppStore((state) => state.askConfirm);
  const askPrompt = useAppStore((state) => state.askPrompt);
  const refreshTree = useAppStore((state) => state.refreshTree);

  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [branches, setBranches] = useState<{ current: string; all: string[] } | null>(null);
  const [showBranches, setShowBranches] = useState(false);

  // Refresh git status every time the SCM panel becomes visible so it always
  // reflects the latest state after a terminal command (e.g. yarn install).
  useEffect(() => {
    void refreshGit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const staged = useMemo(() => git?.files.filter((file) => file.staged) ?? [], [git]);
  const unstaged = useMemo(() => git?.files.filter((file) => !file.staged) ?? [], [git]);

  const branch = git?.branch;
  const fileCount = git?.files.length ?? 0;

  useEffect(() => {
    if (!project || !branch) {
      setLog([]);
      setBranches(null);
      return;
    }
    void window.forge.git
      .branches(project.id)
      .then(setBranches)
      .catch(() => setBranches(null));
  }, [project, branch, fileCount]);

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    try {
      await action();
    } catch (error) {
      toast('error', errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  if (!project) {
    return (
      <EmptyState
        icon={<GitBranch size={22} />}
        title="No folder open"
        description="Open a folder to see its Git status, review diffs and commit changes."
      />
    );
  }

  if (!git) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-line-soft p-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="focus-ring flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded border border-line bg-panel-2 px-2 text-[11.5px] text-muted"
            >
              <GitBranch size={12} className="shrink-0 text-faint" />
              <span className="truncate">Not a git repository</span>
            </button>
            <IconButton label="Refresh" onClick={() => void refreshGit()} title="Refresh status">
              <RefreshCw size={12} />
            </IconButton>
          </div>
        </div>
        <EmptyState
          icon={<GitBranch size={22} />}
          title="Not a Git repository"
          description="Initialise Git to track changes, commit, and use the model-powered commit message drafting."
          action={
            <div className="flex flex-col gap-2 w-full max-w-[220px]">
              <button
                type="button"
                className="btn btn-primary w-full text-[11px]"
                onClick={async () => {
                  useAppStore.getState().showBottom('terminal');
                  // Send git init command to the active terminal
                  await new Promise((r) => setTimeout(r, 400));
                  toast('info', 'Type: git init  then press Enter');
                }}
              >
                <GitBranch size={12} /> Open terminal to run git init
              </button>
              <p className="text-center text-[9.5px] text-faint">
                After initialising, click the{' '}
                <span className="inline-flex items-center gap-0.5 font-medium text-muted">
                  <RefreshCw size={9} /> refresh
                </span>{' '}
                button above.
              </p>
            </div>
          }
        />
      </div>
    );
  }

  const openDiff = async (file: GitFileStatus) => {
    await run(`diff:${file.path}`, async () => {
      const diffs = await window.forge.git.diff(project.id, file.path, file.staged);
      if (diffs.length === 0) {
        await openFile(file.path);
        return;
      }
      openGitDiff(diffs[0]!);
    });
  };

  const stage = (file: GitFileStatus) =>
    run(`stage:${file.path}`, async () => {
      await window.forge.git.stage(project.id, [file.path]);
      await refreshGit();
    });

  const unstage = (file: GitFileStatus) =>
    run(`unstage:${file.path}`, async () => {
      await window.forge.git.unstage(project.id, [file.path]);
      await refreshGit();
    });

  const discard = (file: GitFileStatus) => {
    askConfirm({
      title: `Discard changes in ${file.path.split('/').pop()}?`,
      message: 'All unstaged edits in this file are permanently lost. This cannot be undone.',
      confirmLabel: 'Discard changes',
      danger: true,
      action: async () => {
        try {
          await window.forge.git.discard(project.id, [file.path]);
          await refreshGit();
          await refreshTree();
          toast('success', 'Changes discarded');
        } catch (error) {
          toast('error', errorMessage(error));
        }
      },
    });
  };

  const generateMessage = () =>
    run('generate', async () => {
      const generated = await window.forge.git.generateMessage(project.id);
      setMessage(generated);
      toast('success', 'Commit message drafted by the local model');
    });

  const commit = () =>
    run('commit', async () => {
      if (!message.trim()) return;
      if (staged.length === 0) {
        toast('info', 'Stage at least one file before committing.');
        return;
      }
      const hash = await window.forge.git.commit(project.id, message.trim());
      setMessage('');
      await refreshGit();
      toast('success', `Committed ${hash.slice(0, 8)}`);
    });

  const loadLog = () =>
    run('log', async () => {
      setLog(await window.forge.git.log(project.id, 20));
      setShowLog(true);
    });

  const checkout = (branch: string) => {
    if (branch === git.branch) return;
    askConfirm({
      title: `Switch to ${branch}?`,
      message: 'Uncommitted changes may block the checkout or carry over to the new branch.',
      confirmLabel: 'Switch branch',
      action: async () => {
        try {
          await window.forge.git.checkout(project.id, branch);
          await refreshGit();
          await refreshTree();
          toast('success', `On branch ${branch}`);
        } catch (error) {
          toast('error', errorMessage(error));
        }
      },
    });
  };

  const createBranch = () =>
    askPrompt({
      title: 'Create branch',
      message: 'The new branch starts from the current HEAD and becomes the active branch.',
      placeholder: 'feature/my-change',
      submitLabel: 'Create branch',
      onSubmit: async (value) => {
        try {
          await window.forge.git.createBranch(project.id, value.trim());
          await refreshGit();
          toast('success', `Created branch ${value.trim()}`);
        } catch (error) {
          toast('error', errorMessage(error));
        }
      },
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line-soft p-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowBranches((value) => !value)}
            className="focus-ring flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded border border-line bg-panel-2 px-2 text-[11.5px] text-fg hover:bg-panel-3"
            title="Switch branch"
          >
            <GitBranch size={12} className="shrink-0 text-accent" />
            <span className="truncate">{git.branch || 'detached'}</span>
            {git.ahead > 0 ? <span className="text-[10px] text-success">↑{git.ahead}</span> : null}
            {git.behind > 0 ? <span className="text-[10px] text-warning">↓{git.behind}</span> : null}
            <ChevronDown size={11} className="ml-auto shrink-0 text-faint" />
          </button>
          <IconButton label="New branch" onClick={createBranch} title="Create branch">
            <Plus size={13} />
          </IconButton>
          <IconButton label="Refresh" onClick={() => void refreshGit()} title="Refresh status">
            <RefreshCw size={12} />
          </IconButton>
        </div>
        {showBranches && branches ? (
          <div className="mt-1.5 max-h-[160px] overflow-auto rounded border border-line bg-panel-2 py-1">
            {branches.all.map((branch) => (
              <button
                key={branch}
                type="button"
                onClick={() => {
                  setShowBranches(false);
                  checkout(branch);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1 text-left text-[11.5px] hover:bg-panel-3',
                  branch === branches.current ? 'text-accent' : 'text-muted',
                )}
              >
                <GitBranch size={11} />
                <span className="truncate">{branch}</span>
                {branch === branches.current ? <span className="ml-auto text-[9px] uppercase">current</span> : null}
              </button>
            ))}
          </div>
        ) : null}

        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={`Commit message${staged.length ? ` (${staged.length} staged)` : ' — stage files first'}`}
          rows={3}
          className="mt-2 w-full resize-none text-[11.5px] leading-snug"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void commit();
            }
          }}
        />
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            type="button"
            className="btn btn-primary !h-7 flex-1 !text-[11px]"
            disabled={!message.trim() || staged.length === 0 || busy === 'commit'}
            onClick={() => void commit()}
            title="Commit staged changes (⌘↵)"
          >
            {busy === 'commit' ? <Spinner className="!h-3 !w-3" /> : <GitCommitHorizontal size={12} />}
            Commit
          </button>
          <button
            type="button"
            className="btn !h-7 !px-2 !text-[11px]"
            disabled={busy === 'generate' || git.files.length === 0}
            onClick={() => void generateMessage()}
            title="Draft a commit message with the local model"
          >
            {busy === 'generate' ? <Spinner className="!h-3 !w-3" /> : <Sparkles size={12} className="text-accent" />}
            Draft
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {git.clean ? (
          <EmptyState
            icon={<GitCommitHorizontal size={20} />}
            title="Working tree clean"
            description={`${git.branch} is up to date. Change something and it will appear here instantly.`}
          />
        ) : null}

        {staged.length > 0 ? (
          <>
            <SectionLabel
              right={
                <button
                  type="button"
                  className="text-[10px] text-faint hover:text-fg"
                  onClick={() =>
                    void run('unstage-all', async () => {
                      await window.forge.git.unstage(
                        project.id,
                        staged.map((file) => file.path),
                      );
                      await refreshGit();
                    })
                  }
                >
                  Unstage all
                </button>
              }
            >
              Staged changes · {staged.length}
            </SectionLabel>
            {staged.map((file) => (
              <FileRow
                key={`staged:${file.path}`}
                file={file}
                onOpen={() => void openDiff(file)}
                onToggle={() => void unstage(file)}
                toggleIcon={<ArrowDownToLine size={12} />}
                toggleTitle="Unstage"
              />
            ))}
          </>
        ) : null}

        {unstaged.length > 0 ? (
          <>
            <SectionLabel
              right={
                <button
                  type="button"
                  className="text-[10px] text-faint hover:text-fg"
                  onClick={() =>
                    void run('stage-all', async () => {
                      await window.forge.git.stage(
                        project.id,
                        unstaged.map((file) => file.path),
                      );
                      await refreshGit();
                    })
                  }
                >
                  Stage all
                </button>
              }
            >
              Changes · {unstaged.length}
            </SectionLabel>
            {unstaged.map((file) => (
              <FileRow
                key={`work:${file.path}`}
                file={file}
                onOpen={() => void openDiff(file)}
                onToggle={() => void stage(file)}
                toggleIcon={<ArrowUpFromLine size={12} />}
                toggleTitle="Stage"
                onDiscard={() => discard(file)}
              />
            ))}
          </>
        ) : null}

        <SectionLabel
          right={
            <button type="button" className="text-[10px] text-faint hover:text-fg" onClick={() => void loadLog()}>
              {showLog ? 'Refresh log' : 'Show log'}
            </button>
          }
        >
          History
        </SectionLabel>
        {showLog ? (
          log.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-faint">No commits loaded.</p>
          ) : (
            log.map((entry) => (
              <div key={entry.hash} className="border-b border-line-soft px-3 py-1.5 last:border-0" title={entry.hash}>
                <p className="truncate text-[11.5px] text-fg">{entry.subject}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-faint">
                  <span className="font-mono">{entry.shortHash}</span>
                  <span className="truncate">{entry.author}</span>
                  <span className="ml-auto whitespace-nowrap">{entry.date}</span>
                </p>
              </div>
            ))
          )
        ) : (
          <button
            type="button"
            className="px-3 py-2 text-left text-[11px] text-faint hover:text-fg"
            onClick={() => void loadLog()}
          >
            Load recent commits
          </button>
        )}
      </div>
    </div>
  );
}

function FileRow({
  file,
  onOpen,
  onToggle,
  toggleIcon,
  toggleTitle,
  onDiscard,
}: {
  file: GitFileStatus;
  onOpen: () => void;
  onToggle: () => void;
  toggleIcon: React.ReactNode;
  toggleTitle: string;
  onDiscard?: () => void;
}) {
  const name = file.path.split('/').pop() ?? file.path;
  const dir = file.path.slice(0, Math.max(0, file.path.length - name.length - 1));
  return (
    <div className="group flex items-center gap-1.5 px-2 py-0.5 hover:bg-panel-2">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
        title={`${file.path} — click to view diff`}
      >
        <FileTypeIcon path={file.path} size={12} />
        <span className="truncate text-[11.5px] text-fg">{name}</span>
        {dir ? <span className="truncate text-[10px] text-faint">{dir}</span> : null}
        <span className={cn('ml-auto shrink-0 font-mono text-[10px] font-semibold', STATE_COLOR[file.state])}>
          {STATE_LABEL[file.state]}
        </span>
      </button>
      <div className="hidden items-center group-hover:flex">
        {onDiscard ? (
          <button
            type="button"
            onClick={onDiscard}
            title="Discard changes"
            className="focus-ring rounded p-1 text-faint hover:bg-panel-3 hover:text-danger"
          >
            <Undo2 size={12} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onToggle}
          title={toggleTitle}
          className="focus-ring rounded p-1 text-faint hover:bg-panel-3 hover:text-fg"
        >
          {toggleIcon}
        </button>
      </div>
    </div>
  );
}
