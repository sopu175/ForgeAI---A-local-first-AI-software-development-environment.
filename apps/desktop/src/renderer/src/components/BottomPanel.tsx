import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Copy, GitBranch, Play, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import type { GitLogEntry } from '@forgeai/shared';
import { useAppStore, type BottomTab } from '../state/app';
import { errorMessage, relativeTime } from '../lib/format';
import { primaryRunCommand, suggestedCommands } from '../lib/stack';
import { requestTerminalCommand } from '../lib/terminalBus';
import { FileTypeIcon, Spinner, cn } from './ui';

// xterm and its addons are only fetched when the terminal is first opened.
const TerminalPanel = lazy(() => import('./TerminalPanel').then((module) => ({ default: module.TerminalPanel })));

const TABS: { id: BottomTab; label: string }[] = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'problems', label: 'Problems' },
  { id: 'output', label: 'Output' },
  { id: 'debug', label: 'Run & Debug' },
  { id: 'git', label: 'Git' },
];

export function BottomPanel() {
  const open = useAppStore((state) => state.bottomOpen);
  const tab = useAppStore((state) => state.bottomTab);
  const showBottom = useAppStore((state) => state.showBottom);
  const toggleBottom = useAppStore((state) => state.toggleBottom);
  const problems = useAppStore((state) => state.problems);
  const outputs = useAppStore((state) => state.outputs);
  // Mount the terminal on first use, then keep it alive (hidden) so switching
  // tabs does not destroy the shell session or its scrollback.
  const [terminalMounted, setTerminalMounted] = useState(false);

  useEffect(() => {
    if (tab === 'terminal') setTerminalMounted(true);
  }, [tab]);

  if (!open) return null;
  const errorCount = problems.filter((problem) => problem.severity === 'error').length;
  const warningCount = problems.filter((problem) => problem.severity === 'warning').length;

  return (
    <section className="bottom-panel app-no-drag" style={{ height: 264 }} aria-label="Panel">
      <div className="flex h-8 flex-none items-center gap-0.5 border-b border-line-soft px-2">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => showBottom(entry.id)}
            className={cn(
              'focus-ring relative h-full rounded-none px-2.5 text-[11px] uppercase tracking-wide',
              tab === entry.id ? 'text-fg-strong' : 'text-muted hover:text-fg',
            )}
          >
            {entry.label}
            {entry.id === 'problems' && problems.length > 0 ? (
              <span className={cn('ml-1.5 text-[10px]', errorCount ? 'text-danger' : 'text-warning')}>
                {problems.length}
              </span>
            ) : null}
            {entry.id === 'output' && outputs.length > 0 ? (
              <span className="ml-1.5 text-[10px] text-faint">{outputs.length}</span>
            ) : null}
            {tab === entry.id ? <span className="absolute inset-x-2 -bottom-px h-[2px] rounded bg-accent" /> : null}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {tab === 'problems' ? (
            <span className="px-2 text-[10px] text-faint">
              {errorCount} errors · {warningCount} warnings
            </span>
          ) : null}
          <button
            type="button"
            className="focus-ring rounded p-1 text-faint hover:bg-panel-3 hover:text-fg"
            onClick={toggleBottom}
            title="Close panel"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {terminalMounted ? (
        <div className={cn('min-h-0 flex-1', tab === 'terminal' ? 'flex' : 'hidden')}>
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center text-[11.5px] text-faint">Starting terminal…</div>
            }
          >
            <TerminalPanel />
          </Suspense>
        </div>
      ) : null}
      {tab === 'problems' ? <ProblemsPanel /> : null}
      {tab === 'output' ? <OutputPanel /> : null}
      {tab === 'debug' ? <DebugPanel /> : null}
      {tab === 'git' ? <GitPanel /> : null}
    </section>
  );
}

function ProblemsPanel() {
  const problems = useAppStore((state) => state.problems);
  const openFile = useAppStore((state) => state.openFile);
  const openAI = useAppStore((state) => state.openAI);
  const sendChat = useAppStore((state) => state.sendChat);
  const addContextFile = useAppStore((state) => state.addContextFile);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof problems>();
    for (const problem of problems) {
      const list = map.get(problem.path) ?? [];
      list.push(problem);
      map.set(problem.path, list);
    }
    return [...map.entries()];
  }, [problems]);

  if (problems.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[11.5px] text-muted">
        No problems detected. Monaco reports TypeScript, JavaScript, JSON, CSS and HTML diagnostics here.
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-1">
      {grouped.map(([path, list]) => (
        <div key={path}>
          <div className="flex items-center gap-1.5 px-3 py-1 text-[11px] text-muted">
            <FileTypeIcon path={path} size={12} />
            <span className="truncate">{path}</span>
            <span className="ml-1 text-faint">{list.length}</span>
          </div>
          {list.map((problem, index) => (
            <button
              key={`${problem.line}:${problem.column}:${index}`}
              type="button"
              onClick={() => void openFile(path, problem.line)}
              className="flex w-full items-start gap-2 px-6 py-1 text-left text-[11px] hover:bg-panel-2"
            >
              <AlertTriangle
                size={11}
                className={cn(
                  'mt-0.5 shrink-0',
                  problem.severity === 'error'
                    ? 'text-danger'
                    : problem.severity === 'warning'
                      ? 'text-warning'
                      : 'text-cyan',
                )}
              />
              <span className="min-w-0 flex-1 truncate text-fg">{problem.message}</span>
              <span className="shrink-0 text-faint">
                {problem.source} [{problem.line}:{problem.column}]
              </span>
              <button
                type="button"
                className="focus-ring ml-1 rounded p-1 text-faint hover:bg-panel-3 hover:text-accent"
                title="Ask AI to explain and fix this problem"
                onClick={(e) => {
                  e.stopPropagation();
                  addContextFile(path);
                  openAI('chat');
                  void sendChat(
                    `Please explain and fix this diagnostic error in \`${path}\` line ${problem.line}: "${problem.message}".`,
                  );
                }}
              >
                <Sparkles size={11} />
              </button>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function OutputPanel() {
  const outputs = useAppStore((state) => state.outputs);
  const clearOutput = useAppStore((state) => state.clearOutput);
  const toast = useAppStore((state) => state.toast);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 flex-none items-center justify-end gap-2 border-b border-line-soft px-2 text-[10px] text-faint">
        <span className="mr-auto">Runtime log from indexing, agents and the local model bootstrap.</span>
        <button
          type="button"
          className="focus-ring rounded p-1 hover:bg-panel-3 hover:text-fg"
          title="Copy output"
          onClick={() => {
            void navigator.clipboard
              .writeText(
                outputs
                  .map((line) => `[${new Date(line.time).toLocaleTimeString()}] ${line.source}: ${line.text}`)
                  .join('\n'),
              )
              .then(() => toast('success', 'Output copied'));
          }}
        >
          <Copy size={11} />
        </button>
        <button
          type="button"
          className="focus-ring rounded p-1 hover:bg-panel-3 hover:text-fg"
          title="Clear"
          onClick={clearOutput}
        >
          <Trash2 size={11} />
        </button>
      </div>
      <div className="mono min-h-0 flex-1 overflow-y-auto px-3 py-1 text-[11px] leading-relaxed">
        {outputs.length === 0 ? (
          <div className="py-4 text-center text-muted">Nothing yet.</div>
        ) : (
          outputs.map((line) => (
            <div key={line.id} className="flex gap-2">
              <span className="shrink-0 text-faint">{new Date(line.time).toLocaleTimeString()}</span>
              <span
                className={cn(
                  'shrink-0 uppercase',
                  line.level === 'error'
                    ? 'text-danger'
                    : line.level === 'warn'
                      ? 'text-warning'
                      : line.level === 'success'
                        ? 'text-success'
                        : 'text-cyan',
                )}
              >
                {line.source}
              </span>
              <span className="whitespace-pre-wrap break-words text-fg">{line.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DebugPanel() {
  const stack = useAppStore((state) => state.stack);
  const showBottom = useAppStore((state) => state.showBottom);
  const project = useAppStore((state) => state.project);
  const commands = stack ? suggestedCommands(stack) : [];
  const run = primaryRunCommand(
    stack ?? { languages: [], frameworks: [], packageManagers: [], testRunners: [], hasGit: false, entryPoints: [] },
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <Play size={12} className="text-accent" />
        <span className="font-medium text-fg">Run configurations</span>
        <span className="text-faint">Derived from the detected project stack.</span>
      </div>
      {!project ? (
        <div className="mt-4 text-[11.5px] text-muted">Open a folder to detect run configurations.</div>
      ) : (
        <div className="mt-2 grid grid-cols-1 gap-1.5 lg:grid-cols-2">
          {(commands.length > 0 ? commands : [{ label: 'Shell', command: '', kind: 'other' as const }]).map(
            (entry, index) => (
              <div
                key={`${entry.label}:${index}`}
                className="flex items-center gap-2 rounded-md border border-line-soft bg-panel px-2.5 py-1.5"
              >
                <span className="chip">{entry.kind}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] text-fg">{entry.label}</div>
                  <div className="mono truncate text-[10px] text-faint">{entry.command || 'interactive shell'}</div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary h-6 px-2 text-[10.5px]"
                  onClick={() => {
                    showBottom('terminal');
                    if (entry.command) requestTerminalCommand(entry.command);
                  }}
                >
                  <Play size={10} /> Run
                </button>
              </div>
            ),
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {stack?.languages.map((language) => (
          <span key={language} className="chip">
            {language}
          </span>
        ))}
        {stack?.frameworks.map((framework) => (
          <span key={framework} className="chip chip-accent">
            {framework}
          </span>
        ))}
      </div>
      {run ? (
        <p className="mt-3 text-[10.5px] leading-relaxed text-faint">
          Debugging uses the language runtime directly (Node inspector, PHP/Xdebug, pdb, Delve) through the integrated
          terminal. Full DAP adapters are not bundled yet; breakpoints are set in the editor and the process is launched
          with the command above.
        </p>
      ) : null}
    </div>
  );
}

function GitPanel() {
  const project = useAppStore((state) => state.project);
  const git = useAppStore((state) => state.git);
  const refreshGit = useAppStore((state) => state.refreshGit);
  const openGitDiff = useAppStore((state) => state.openGitDiff);
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!project) return;
    setLoading(true);
    window.forge.git
      .log(project.id, 20)
      .then(setLog)
      .catch(() => setLog([]))
      .finally(() => setLoading(false));
  }, [project, git?.branch, git?.files.length]);

  if (!project) {
    return <div className="flex flex-1 items-center justify-center text-[11.5px] text-muted">Open a folder first.</div>;
  }
  if (!git) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[11.5px] text-muted">
        <GitBranch size={16} />
        This folder is not a git repository.
        <button type="button" className="btn h-6 px-2 text-[11px]" onClick={() => void refreshGit()}>
          <RefreshCw size={11} /> Check again
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="min-w-0 flex-1 overflow-y-auto py-1">
        <div className="flex items-center gap-2 px-3 py-1 text-[11px] text-muted">
          <GitBranch size={12} className="text-accent" />
          <span className="text-fg">{git.branch}</span>
          {git.ahead > 0 ? <span>↑{git.ahead}</span> : null}
          {git.behind > 0 ? <span>↓{git.behind}</span> : null}
          <span className="ml-auto text-faint">{git.clean ? 'clean' : `${git.files.length} changes`}</span>
          <button
            type="button"
            className="focus-ring rounded p-1 hover:bg-panel-3 hover:text-fg"
            onClick={() => void refreshGit()}
            title="Refresh"
          >
            <RefreshCw size={11} />
          </button>
        </div>
        {git.files.map((file) => (
          <button
            key={`${file.staged}:${file.path}`}
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1 text-left text-[11px] hover:bg-panel-2"
            onClick={() =>
              void window.forge.git
                .diff(project.id, file.path, file.staged)
                .then((files) => {
                  if (files[0]) openGitDiff(files[0]);
                })
                .catch((error) => useAppStore.getState().toast('error', errorMessage(error)))
            }
          >
            <FileTypeIcon path={file.path} size={12} />
            <span className="min-w-0 flex-1 truncate text-fg">{file.path}</span>
            <span className="mono text-[10px] text-faint">
              {file.staged ? 'staged' : 'working'} · {file.state}
            </span>
          </button>
        ))}
        {git.clean ? <div className="px-3 py-4 text-center text-[11px] text-muted">Working tree clean.</div> : null}
      </div>
      <div className="w-[42%] min-w-[280px] overflow-y-auto border-l border-line-soft py-1">
        <button
          type="button"
          className="flex w-full items-center gap-1 px-3 py-1 text-[10px] uppercase tracking-wide text-faint"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Recent commits
          {loading ? <Spinner className="!h-3 !w-3" /> : null}
        </button>
        {expanded
          ? log.map((entry) => (
              <div key={entry.hash} className="px-3 py-1 text-[10.5px]">
                <div className="flex items-center gap-1.5">
                  <span className="mono text-accent">{entry.shortHash}</span>
                  <span className="truncate text-fg">{entry.subject}</span>
                </div>
                <div className="text-faint">
                  {entry.author} · {relativeTime(Date.parse(entry.date) || Date.now())}
                </div>
              </div>
            ))
          : null}
      </div>
    </div>
  );
}
