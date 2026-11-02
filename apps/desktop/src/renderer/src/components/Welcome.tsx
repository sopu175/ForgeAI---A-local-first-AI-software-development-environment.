import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Command,
  Cpu,
  FileCode2,
  FolderOpen,
  History,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from 'lucide-react';
import type { ProjectSummary } from '@forgeai/shared';
import { useAppStore } from '../state/app';
import { cn } from './ui';
import { compactPath, relativeTime } from '../lib/format';
import { runCommand } from '../lib/commands';

const FEATURES: Array<{ icon: React.ReactNode; title: string; text: string }> = [
  {
    icon: <Sparkles size={15} />,
    title: 'Local models, real tools',
    text: 'Streaming chat and autonomous agents powered by Ollama or any OpenAI-compatible endpoint. No cloud keys required.',
  },
  {
    icon: <ScrollText size={15} />,
    title: 'Spec-driven delivery',
    text: 'Turn an idea into requirements, design and ordered tasks — approve each phase, then let the agent implement.',
  },
  {
    icon: <Search size={15} />,
    title: 'Codebase-aware context',
    text: 'Incremental indexing, embeddings and symbol search keep prompts small and grounded in your real code.',
  },
  {
    icon: <ShieldCheck size={15} />,
    title: 'Approval-gated changes',
    text: 'Every write, command and commit is diffed and permissioned. Checkpoints make rollback one click.',
  },
];

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: '⌘⇧P', label: 'Command palette' },
  { keys: '⌘P', label: 'Go to file' },
  { keys: '⌘K', label: 'Inline AI edit' },
  { keys: '⌘L', label: 'Focus AI chat' },
  { keys: '⌘J', label: 'Toggle panel' },
  { keys: '⌘`', label: 'Terminal' },
];

export function Welcome() {
  const project = useAppStore((state) => state.project);
  const models = useAppStore((state) => state.models);
  const info = useAppStore((state) => state.info);
  const openFolder = useAppStore((state) => state.openFolder);
  const openWorkspace = useAppStore((state) => state.openWorkspace);
  const requestNewSpec = useAppStore((state) => state.requestNewSpec);
  const openAI = useAppStore((state) => state.openAI);
  const setModelsOpen = useAppStore((state) => state.setModelsOpen);
  const setPaletteOpen = useAppStore((state) => state.setPaletteOpen);
  const [recent, setRecent] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    if (project) return;
    void window.forge.workspace
      .recent()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, [project]);

  if (project) {
    return (
      <div className="flex h-full items-start justify-center overflow-auto px-6 py-10">
        <div className="w-full max-w-[640px]">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#007acc] text-[19px] font-black text-white shadow-soft">
              F
            </div>
            <div>
              <h1 className="text-[19px] font-semibold text-fg-strong">{project.name}</h1>
              <p className="font-mono text-[10.5px] text-faint" title={project.root}>
                {compactPath(project.root, 72)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <ActionCard
              icon={<Search size={15} />}
              title="Go to file"
              hint="⌘P"
              onClick={() => useAppStore.getState().setQuickOpenOpen(true)}
            />
            <ActionCard
              icon={<Command size={15} />}
              title="Command palette"
              hint="⌘⇧P"
              onClick={() => setPaletteOpen(true)}
            />
            <ActionCard
              icon={<ScrollText size={15} />}
              title="New feature spec"
              hint="requirements → design → tasks"
              onClick={requestNewSpec}
            />
            <ActionCard
              icon={<Bot size={15} />}
              title="Start an agent"
              hint={models.length ? 'local' : 'needs a model'}
              onClick={() => openAI('agent')}
            />
            <ActionCard
              icon={<TerminalSquare size={15} />}
              title="Open terminal"
              hint="⌘`"
              onClick={() => useAppStore.getState().showBottom('terminal')}
            />
            <ActionCard
              icon={<Cpu size={15} />}
              title="Models & providers"
              hint={models.length ? `${models.length} installed` : 'set up Ollama'}
              onClick={() => setModelsOpen(true)}
            />
          </div>

          <div className="mt-7">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Shortcuts</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
              {SHORTCUTS.map((shortcut) => (
                <div key={shortcut.keys} className="flex items-center justify-between border-b border-line-soft pb-1">
                  <span className="text-[11px] text-muted">{shortcut.label}</span>
                  <span className="rounded border border-line bg-panel-2 px-1.5 py-[1px] font-mono text-[9.5px] text-faint">
                    {shortcut.keys}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-7 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => useAppStore.getState().setActivity('specs')}
              className="card flex items-center gap-2 p-2.5 text-left hover:bg-panel-3"
            >
              <ScrollText size={13} className="text-accent" />
              <span className="text-[11px] text-muted">Browse feature specs</span>
              <ArrowRight size={11} className="ml-auto text-faint" />
            </button>
            <button
              type="button"
              onClick={() => void runCommand('workspace.index')}
              className="card flex items-center gap-2 p-2.5 text-left hover:bg-panel-3"
            >
              <History size={13} className="text-accent" />
              <span className="text-[11px] text-muted">Refresh code index</span>
              <ArrowRight size={11} className="ml-auto text-faint" />
            </button>
          </div>

          <p className="mt-6 text-center text-[10px] text-faint">
            ForgeAI {info?.version ?? ''} · Electron {info?.electron ?? ''} · Node {info?.node ?? ''}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-start justify-center overflow-auto px-6 py-9">
      <div className="w-full max-w-[760px]">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#007acc] text-[24px] font-black text-white shadow-soft">
            F
          </div>
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight text-fg-strong">ForgeAI</h1>
            <p className="text-[12px] text-muted">A local-first AI software development environment.</p>
          </div>
          <span className="chip chip-accent ml-auto !h-[22px]">SopuForge</span>
        </div>

        <div className="mt-6 flex items-center gap-2">
          <button type="button" className="btn btn-primary !h-8 !px-3" onClick={() => void openFolder()}>
            <FolderOpen size={13} /> Open folder
          </button>
          <button
            type="button"
            className="btn !h-8 !px-3"
            onClick={() =>
              useAppStore.getState().askPrompt({
                title: 'Open project by path',
                message: 'Enter the absolute path of an existing folder.',
                placeholder: '/Users/you/projects/my-app',
                submitLabel: 'Open',
                onSubmit: async (value) => {
                  await openWorkspace(value.trim());
                },
              })
            }
          >
            <FileCode2 size={13} /> Open by path
          </button>
          <button type="button" className="btn !h-8 !px-3" onClick={() => setModelsOpen(true)}>
            <Cpu size={13} /> Set up models
          </button>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-2.5">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="card p-3">
              <div className="flex items-center gap-2 text-accent">
                {feature.icon}
                <span className="text-[12px] font-medium text-fg">{feature.title}</span>
              </div>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted">{feature.text}</p>
            </div>
          ))}
        </div>

        <div className="mt-7">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Recent projects</p>
            {recent.length > 0 ? <span className="text-[9.5px] text-faint">{recent.length}</span> : null}
          </div>
          {recent.length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-[11px] text-faint">
              Folders you open appear here. Everything stays on this machine.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border border-line">
              {recent.slice(0, 6).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => void openWorkspace(entry.root)}
                  className="flex w-full items-center gap-2 border-b border-line-soft bg-panel-2 px-3 py-2 text-left last:border-0 hover:bg-panel-3"
                >
                  <FolderOpen size={13} className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] text-fg">{entry.name}</span>
                    <span className="block truncate font-mono text-[9.5px] text-faint" title={entry.root}>
                      {compactPath(entry.root, 64)}
                    </span>
                  </span>
                  <span className="shrink-0 text-[9.5px] text-faint">{relativeTime(entry.lastOpenedAt)}</span>
                  <ArrowRight size={11} className="shrink-0 text-faint" />
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-[10px] text-faint">
          {models.length > 0
            ? `${models.length} local model${models.length === 1 ? '' : 's'} installed · pick one in the top bar`
            : 'No models detected yet · install Ollama, then pull a model from Models & Providers'}
          {info ? ` · v${info.version}` : ''}
        </p>
      </div>
    </div>
  );
}

function ActionCard({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('card flex items-center gap-2.5 p-2.5 text-left transition-colors hover:bg-panel-3')}
    >
      <span className="text-accent">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11.5px] text-fg">{title}</span>
        <span className="block text-[9.5px] text-faint">{hint}</span>
      </span>
      <ArrowRight size={11} className="shrink-0 text-faint" />
    </button>
  );
}
