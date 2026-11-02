import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Cpu,
  GitBranch,
  Info,
  Radio,
  RefreshCw,
  Settings,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useAppStore } from '../state/app';
import { cn, Spinner } from './ui';
import { shortModelName } from '../lib/format';

export function StatusBar() {
  const project = useAppStore((state) => state.project);
  const git = useAppStore((state) => state.git);
  const problems = useAppStore((state) => state.problems);
  const indexing = useAppStore((state) => state.indexing);
  const selectedModel = useAppStore((state) => state.selectedModel);
  const cursor = useAppStore((state) => state.cursor);
  const tabs = useAppStore((state) => state.tabs);
  const activeTabId = useAppStore((state) => state.activeTabId);
  const agentRun = useAppStore((state) => state.agentRun);
  const streaming = useAppStore((state) => state.streaming);
  const settings = useAppStore((state) => state.settings);
  const setModelsOpen = useAppStore((state) => state.setModelsOpen);
  const showBottom = useAppStore((state) => state.showBottom);
  const openAI = useAppStore((state) => state.openAI);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const startIndex = useAppStore((state) => state.startIndex);
  const refreshGit = useAppStore((state) => state.refreshGit);

  const active = tabs.find((tab) => tab.id === activeTabId);
  const errors = problems.filter((problem) => problem.severity === 'error').length;
  const warnings = problems.filter((problem) => problem.severity === 'warning').length;
  const language = active?.language ?? (active?.kind === 'spec' ? 'markdown' : '');
  const indexState = indexing?.state ?? 'idle';
  const indexingBusy = indexState === 'scanning' || indexState === 'embedding';
  const indexesAt = indexState === 'ready' ? `${indexing?.filesIndexed ?? 0} files indexed` : null;

  return (
    <footer className="statusbar app-no-drag">
      <button
        type="button"
        className="status-item focus-ring"
        onClick={() => showBottom('git')}
        disabled={!project}
        title={git ? `${git.files.length} changed file(s)` : 'No git repository'}
      >
        <GitBranch size={12} className={git ? 'text-accent' : undefined} />
        {git ? git.branch : project ? 'no git' : 'no folder'}
        {git && !git.clean ? <span className="text-warning">●</span> : null}
        {git && git.ahead > 0 ? <span>↑{git.ahead}</span> : null}
        {git && git.behind > 0 ? <span>↓{git.behind}</span> : null}
      </button>

      <button
        type="button"
        className="status-item focus-ring"
        onClick={() => refreshGit()}
        disabled={!git}
        title="Refresh source control status"
      >
        <RefreshCw size={11} />
      </button>

      <button
        type="button"
        className="status-item focus-ring"
        onClick={() => showBottom('problems')}
        title="Show problems"
      >
        <XCircle size={12} className={errors > 0 ? 'text-danger' : 'text-faint'} />
        {errors}
        <AlertTriangle size={12} className={cn('ml-1', warnings > 0 ? 'text-warning' : 'text-faint')} />
        {warnings}
      </button>

      {indexingBusy ? (
        <span className="status-item">
          <Spinner className="!h-3 !w-3" />
          indexing {indexing?.filesIndexed ?? 0}/{indexing?.filesTotal ?? 0}
        </span>
      ) : indexState === 'error' ? (
        <button
          type="button"
          className="status-item text-danger focus-ring"
          onClick={() => startIndex(true)}
          title={indexing?.error ?? 'Index failed'}
        >
          <AlertTriangle size={11} />
          index error
        </button>
      ) : indexesAt ? (
        <button
          type="button"
          className="status-item focus-ring"
          onClick={() => startIndex(false)}
          title={`${indexesAt} · ${indexing?.chunks ?? 0} chunks · ${indexing?.embedded ?? 0} embedded. Click to refresh.`}
        >
          <CheckCircle2 size={11} className="text-success" />
          {indexesAt}
        </button>
      ) : project ? (
        <button type="button" className="status-item focus-ring" onClick={() => startIndex(false)}>
          <Info size={11} />
          index not built
        </button>
      ) : null}

      {agentRun ? (
        <button
          type="button"
          className={cn('status-item focus-ring', agentRun.status === 'running' && 'text-success')}
          onClick={() => openAI('agent')}
          title="Open agent activity"
        >
          <Bot size={12} />
          {agentRun.status === 'running'
            ? `agent ${agentRun.steps.step}/${agentRun.steps.maxSteps}`
            : `agent ${agentRun.status}`}
        </button>
      ) : null}

      <div className="ml-auto flex items-center gap-1">
        {streaming ? (
          <button type="button" className="status-item text-accent focus-ring" onClick={() => openAI('chat')}>
            <Radio size={11} className="animate-pulse" />
            streaming
          </button>
        ) : null}
        <button type="button" className="status-item focus-ring" onClick={() => openAI('chat')} title="Chat model">
          <Sparkles size={11} className="text-accent" />
          {selectedModel ? shortModelName(selectedModel.model) : 'no model'}
        </button>
        <button
          type="button"
          className="status-item focus-ring"
          onClick={() => setModelsOpen(true)}
          title="Manage models"
        >
          <Cpu size={11} />
        </button>
        <div className="mx-1 h-3 w-px bg-line-soft" />
        {active?.path ? (
          <span className="status-item" title={active.path}>
            {active.path.split('/').slice(-2).join('/')}
          </span>
        ) : null}
        <span className="status-item" title="Cursor position">
          Ln {cursor.line}, Col {cursor.column}
        </span>
        {language ? <span className="status-item">{language}</span> : null}
        <span className="status-item">UTF-8</span>
        <span className="status-item">{settings?.theme === 'light' ? 'Light' : 'Dark'}</span>
        <button type="button" className="status-item focus-ring" onClick={() => setSettingsOpen(true)} title="Settings">
          <Settings size={11} />
        </button>
      </div>
    </footer>
  );
}
