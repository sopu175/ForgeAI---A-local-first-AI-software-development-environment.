import { Bot, Cpu, Files, GitBranch, History, Puzzle, Search, Settings, Sparkles, ScrollText } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAppStore, type ActivityView } from '../state/app';
import { cn } from './ui';

interface ActivityEntry {
  id: ActivityView;
  label: string;
  shortcut: string;
  icon: ReactNode;
}

const ENTRIES: ActivityEntry[] = [
  { id: 'explorer', label: 'Explorer', shortcut: '⌘⇧E', icon: <Files size={20} /> },
  { id: 'search', label: 'Search', shortcut: '⌘⇧F', icon: <Search size={20} /> },
  { id: 'scm', label: 'Source Control', shortcut: '⌘⇧G', icon: <GitBranch size={20} /> },
  { id: 'specs', label: 'Specs', shortcut: '⌘⇧S', icon: <ScrollText size={20} /> },
  { id: 'agents', label: 'Agents', shortcut: '⌘⇧A', icon: <Bot size={20} /> },
  { id: 'extensions', label: 'AI Rules & Tools', shortcut: '', icon: <Puzzle size={20} /> },
  { id: 'history', label: 'Checkpoints & History', shortcut: '', icon: <History size={20} /> },
];

export function ActivityBar() {
  const activity = useAppStore((state) => state.activity);
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const setActivity = useAppStore((state) => state.setActivity);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const git = useAppStore((state) => state.git);
  const indexing = useAppStore((state) => state.indexing);
  const aiOpen = useAppStore((state) => state.aiOpen);
  const toggleAI = useAppStore((state) => state.toggleAI);
  const setModelsOpen = useAppStore((state) => state.setModelsOpen);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const agentRunning = useAppStore((state) => state.agentRun?.status === 'running');
  const models = useAppStore((state) => state.models);

  const pendingChanges = git?.files.length ?? 0;

  return (
    <nav className="activity-bar app-no-drag" aria-label="Primary navigation">
      {ENTRIES.map((entry) => {
        const active = activity === entry.id && sidebarOpen;
        return (
          <button
            key={entry.id}
            type="button"
            title={`${entry.label}${entry.shortcut ? ` (${entry.shortcut})` : ''}`}
            aria-label={entry.label}
            aria-pressed={active}
            onClick={() => {
              if (activity === entry.id && sidebarOpen) toggleSidebar();
              else setActivity(entry.id);
            }}
            className={cn('activity-button focus-ring', active && 'active')}
          >
            {entry.icon}
            {entry.id === 'scm' && pendingChanges > 0 ? (
              <span className="absolute right-1 top-1 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold text-white">
                {pendingChanges > 99 ? '99+' : pendingChanges}
              </span>
            ) : null}
            {entry.id === 'agents' && agentRunning ? (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 animate-pulse rounded-full bg-success" />
            ) : null}
            {entry.id === 'history' && indexing && indexing.state !== 'ready' && indexing.state !== 'idle' ? (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 animate-pulse rounded-full bg-warning" />
            ) : null}
          </button>
        );
      })}

      <div className="mt-auto flex flex-col items-center gap-1 pb-1">
        <button
          type="button"
          title={aiOpen ? 'Hide AI panel' : 'Show AI panel (⌘⌥B)'}
          aria-label="Toggle AI panel"
          onClick={() => toggleAI()}
          className={cn('activity-button focus-ring', aiOpen && 'text-accent')}
        >
          <Sparkles size={19} />
        </button>
        <button
          type="button"
          title={`Models & providers${models.length ? ` — ${models.length} installed` : ''}`}
          aria-label="Models and providers"
          onClick={() => setModelsOpen(true)}
          className="activity-button focus-ring"
        >
          <span className="relative">
            <Cpu size={19} />
            {models.length === 0 ? (
              <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-danger" />
            ) : null}
          </span>
        </button>
        <button
          type="button"
          title="Settings (⌘,)"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
          className="activity-button focus-ring"
        >
          <Settings size={19} />
        </button>
      </div>
    </nav>
  );
}
