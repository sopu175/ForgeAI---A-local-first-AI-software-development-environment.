import { useEffect, useState } from 'react';
import { ChevronDown, Cpu, FolderOpen, GitBranch, Play, Search, Settings, Sparkles } from 'lucide-react';
import type { AgentKind } from '@forgeai/shared';
import { useAppStore } from '../state/app';
import { cn, IconButton } from './ui';
import { shortModelName } from '../lib/format';
import { primaryRunCommand } from '../lib/stack';
import { requestTerminalCommand } from '../lib/terminalBus';

const AGENT_LABELS: Record<AgentKind, string> = {
  coding: 'Coding agent',
  planner: 'Planner agent',
  frontend: 'Frontend agent',
  animation: 'Animation agent',
  backend: 'Backend agent',
  debugging: 'Debugging agent',
  testing: 'Testing agent',
  review: 'Review agent',
  docs: 'Docs agent',
  seo: 'SEO agent',
};

export function TopBar() {
  const project = useAppStore((state) => state.project);
  const models = useAppStore((state) => state.models);
  const providers = useAppStore((state) => state.providers);
  const selectedModel = useAppStore((state) => state.selectedModel);
  const info = useAppStore((state) => state.info);
  const theme = useAppStore((state) => state.settings?.theme);
  const agentMode = useAppStore((state) => state.agentMode);
  const stack = useAppStore((state) => state.stack);
  const git = useAppStore((state) => state.git);
  const aiOpen = useAppStore((state) => state.aiOpen);
  const setSelectedModel = useAppStore((state) => state.setSelectedModel);
  const setAgentMode = useAppStore((state) => state.setAgentMode);
  const openFolder = useAppStore((state) => state.openFolder);
  const setPaletteOpen = useAppStore((state) => state.setPaletteOpen);
  const setModelsOpen = useAppStore((state) => state.setModelsOpen);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const toggleAI = useAppStore((state) => state.toggleAI);
  const openAI = useAppStore((state) => state.openAI);
  const showBottom = useAppStore((state) => state.showBottom);
  const toast = useAppStore((state) => state.toast);
  const [platform, setPlatform] = useState<string>('');

  useEffect(() => {
    setPlatform(info?.platform ?? '');
  }, [info?.platform]);

  const isMac = platform === 'darwin';
  const isWindows = platform === 'win32';

  const grouped = new Map<string, typeof models>();
  for (const model of models) {
    const key = `${model.providerId}`;
    const list = grouped.get(key) ?? [];
    list.push(model);
    grouped.set(key, list);
  }

  const selectionValue = selectedModel ? `${selectedModel.providerId}::${selectedModel.model}` : '';

  const toggleTheme = () => {
    void useAppStore.getState().updateSettings({ theme: theme === 'light' ? 'dark' : 'light' });
  };

  return (
    <header
      className={cn('topbar app-drag', isMac && 'pl-[78px]')}
      style={isWindows ? { paddingRight: 142 } : undefined}
    >
      <div className="app-no-drag flex min-w-0 flex-1 items-center gap-2 pl-2 pr-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#007acc] text-[13px] font-black text-white shadow-sm">
          F
        </div>
        {project ? (
          <button
            type="button"
            onClick={() => openFolder()}
            className="focus-ring flex min-w-0 items-center gap-2 rounded px-1.5 py-1 text-[12.5px] font-medium text-fg hover:bg-panel-2"
            title={project.root}
          >
            <span className="max-w-[220px] truncate">{project.name}</span>
            <ChevronDown size={12} className="text-faint" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => openFolder()}
            className="focus-ring flex items-center gap-1.5 rounded border border-line bg-panel-2 px-2 py-1 text-[11.5px] text-muted hover:text-fg"
          >
            <FolderOpen size={13} />
            Open folder
          </button>
        )}
        {git && !git.detached ? (
          <span className="hidden items-center gap-1 rounded-full border border-line-soft bg-panel-2 px-2 py-[3px] text-[10.5px] text-muted lg:flex">
            <GitBranch size={11} className="text-accent" />
            {git.branch}
            {git.ahead > 0 ? <span className="text-success">↑{git.ahead}</span> : null}
            {git.behind > 0 ? <span className="text-warning">↓{git.behind}</span> : null}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="focus-ring ml-2 hidden h-7 w-[300px] items-center gap-2 rounded-md border border-line bg-panel-2 px-2 text-[11.5px] text-faint transition-colors hover:border-line hover:text-muted xl:flex"
        >
          <Search size={12} />
          <span className="flex-1 text-left">Search files and commands</span>
          <span className="rounded border border-line bg-panel-3 px-1 py-[1px] font-mono text-[9.5px]">⌘⇧P</span>
        </button>
      </div>

      <div className="app-no-drag flex shrink-0 items-center gap-1.5 pr-2">
        <div className="relative hidden items-center gap-1.5 md:flex">
          <Cpu size={13} className="text-faint" />
          <select
            value={selectionValue}
            onChange={(event) => {
              const value = event.target.value;
              if (!value) {
                void setSelectedModel(null);
                return;
              }
              const [providerId, ...rest] = value.split('::');
              const model = rest.join('::');
              if (providerId && model) void setSelectedModel({ providerId, model });
            }}
            className="h-7 max-w-[210px] border-transparent bg-transparent pr-6 text-[11.5px] text-fg hover:border-line focus:border-accent"
            title="Chat model"
          >
            {models.length === 0 ? <option value="">No models — open Models</option> : null}
            {models.length > 0 && !selectionValue ? <option value="">Select a model…</option> : null}
            {[...grouped.entries()].map(([providerId, list]) => {
              const provider = providers.find((entry) => entry.id === providerId);
              return (
                <optgroup key={providerId} label={provider?.name ?? providerId}>
                  {list.map((model) => (
                    <option key={`${providerId}::${model.id}`} value={`${providerId}::${model.id}`}>
                      {shortModelName(model.id)}
                      {model.parameterSize ? ` · ${model.parameterSize}` : ''}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          <IconButton label="Manage models" onClick={() => setModelsOpen(true)} title="Models & providers">
            <Settings size={13} />
          </IconButton>
        </div>

        <div className="mx-1 hidden h-4 w-px bg-line-soft md:block" />

        <select
          value={agentMode}
          onChange={(event) => {
            const agent = event.target.value as AgentKind;
            setAgentMode(agent);
            openAI('agent');
          }}
          className="hidden h-7 max-w-[132px] border-transparent bg-transparent text-[11.5px] text-muted hover:border-line sm:block"
          title="Agent mode"
        >
          {(Object.keys(AGENT_LABELS) as AgentKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {AGENT_LABELS[kind]}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => {
            const command = stack ? primaryRunCommand(stack) : null;
            if (!command) {
              toast('info', 'No run command detected for this project. Open a terminal to run commands manually.');
              showBottom('terminal');
              return;
            }
            showBottom('terminal');
            requestTerminalCommand(command);
          }}
          disabled={!project}
          className="focus-ring hidden h-7 items-center gap-1.5 rounded-md border border-line bg-panel-2 px-2.5 text-[11.5px] text-fg hover:bg-panel-3 disabled:opacity-40 sm:flex"
          title={stack ? (primaryRunCommand(stack) ?? 'Run project') : 'Run project'}
        >
          <Play size={11} className="text-success" fill="currentColor" />
          Run
        </button>

        <IconButton label="Toggle AI panel" active={aiOpen} onClick={() => toggleAI()} title="Toggle AI panel (⌘⌥B)">
          <Sparkles size={15} className={aiOpen ? 'text-accent' : undefined} />
        </IconButton>
        <IconButton
          label="Toggle theme"
          onClick={toggleTheme}
          title="Toggle light/dark theme"
          className="hidden sm:inline-flex"
        >
          <span className="text-[13px] leading-none">{theme === 'light' ? '☾' : '☀'}</span>
        </IconButton>
        <IconButton label="Settings" onClick={() => setSettingsOpen(true)} title="Settings (⌘,)">
          <Settings size={15} />
        </IconButton>
      </div>
    </header>
  );
}
