import { lazy, Suspense } from 'react';
import { Columns2, FileDiff, MoreHorizontal, Plus, ScrollText, X } from 'lucide-react';
import type { EditorTab } from '../state/app';
import { useAppStore } from '../state/app';
import { cn, FileTypeIcon, IconButton } from './ui';
import { Welcome } from './Welcome';

// Editor surfaces are code-split: Monaco (and its workers) stays out of the
// startup bundle, and the spec/diff views only load when first opened.
const MonacoEditor = lazy(() => import('./MonacoEditor').then((module) => ({ default: module.MonacoEditor })));
const SpecEditor = lazy(() => import('./SpecEditor').then((module) => ({ default: module.SpecEditor })));
const GitDiffView = lazy(() => import('./GitDiffView').then((module) => ({ default: module.GitDiffView })));

function EditorLoading({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center text-[11.5px] text-faint">{label}</div>;
}

function TabIcon({ tab, size = 13 }: { tab: EditorTab; size?: number }) {
  if (tab.kind === 'spec') return <ScrollText size={size} className="shrink-0 text-accent" />;
  if (tab.kind === 'git') return <FileDiff size={size} className="shrink-0 text-warning" />;
  return <FileTypeIcon path={tab.path ?? tab.title} size={size} />;
}

function PaneContent({ tab, focus }: { tab: EditorTab; focus?: boolean }) {
  if (tab.kind === 'spec') {
    return (
      <Suspense fallback={<EditorLoading label="Loading spec editor…" />}>
        <SpecEditor tab={tab} />
      </Suspense>
    );
  }
  if (tab.kind === 'git') {
    return (
      <Suspense fallback={<EditorLoading label="Loading diff…" />}>
        <GitDiffView tab={tab} />
      </Suspense>
    );
  }
  if (tab.kind === 'file') {
    return (
      <Suspense fallback={<EditorLoading label="Loading editor…" />}>
        <MonacoEditor tab={tab} focus={focus} />
      </Suspense>
    );
  }
  return null;
}

export function EditorArea() {
  const tabs = useAppStore((state) => state.tabs);
  const activeTabId = useAppStore((state) => state.activeTabId);
  const splitOpen = useAppStore((state) => state.splitOpen);
  const splitTabId = useAppStore((state) => state.splitTabId);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const closeTab = useAppStore((state) => state.closeTab);
  const toggleSplit = useAppStore((state) => state.toggleSplit);
  const closeSplit = useAppStore((state) => state.closeSplit);
  const setSplitTab = useAppStore((state) => state.setSplitTab);
  const setQuickOpenOpen = useAppStore((state) => state.setQuickOpenOpen);
  const setPaletteOpen = useAppStore((state) => state.setPaletteOpen);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const splitTab = tabs.find((tab) => tab.id === splitTabId) ?? null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <div className="tab-strip app-no-drag">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTabId}
            tabIndex={0}
            className={cn('tab focus-ring', tab.id === activeTabId && 'active')}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setActiveTab(tab.id);
            }}
            onMouseDown={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                void closeTab(tab.id);
              }
            }}
            title={tab.path ?? tab.title}
          >
            <TabIcon tab={tab} />
            <span className="tab-title">{tab.title}</span>
            {tab.kind === 'file' && tab.content !== tab.saved ? (
              <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-accent" title="Unsaved changes" />
            ) : (
              <button
                type="button"
                aria-label={`Close ${tab.title}`}
                className="tab-close"
                onClick={(event) => {
                  event.stopPropagation();
                  void closeTab(tab.id);
                }}
              >
                <X size={11} />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setQuickOpenOpen(true)}
          className="focus-ring flex h-full w-8 shrink-0 items-center justify-center text-faint hover:bg-panel-2 hover:text-fg"
          title="Open file (⌘P)"
        >
          <Plus size={13} />
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 px-1">
          <IconButton
            label="Split editor"
            active={splitOpen}
            disabled={!activeTab}
            onClick={toggleSplit}
            title={activeTab ? 'Split editor (⌘\\)' : 'Open a file to split the editor'}
          >
            <Columns2 size={13} />
          </IconButton>
          <IconButton label="More actions" onClick={() => setPaletteOpen(true)} title="Command palette (⌘⇧P)">
            <MoreHorizontal size={13} />
          </IconButton>
        </div>
      </div>

      {activeTab ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col" onFocusCapture={() => setActiveTab(activeTab.id)}>
            {splitOpen ? (
              <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line-soft bg-panel px-3 text-[10px] text-faint">
                <Columns2 size={10} />
                <span className="truncate font-mono" title={activeTab.path}>
                  {activeTab.path ?? activeTab.title}
                </span>
                {activeTab.kind === 'file' && activeTab.content !== activeTab.saved ? (
                  <span className="text-accent">unsaved</span>
                ) : null}
                <span className="ml-auto">{activeTab.language}</span>
              </div>
            ) : null}
            <div className="min-h-0 flex-1">
              <PaneContent tab={activeTab} focus={!splitOpen} />
            </div>
          </div>
          {splitOpen ? (
            <div className="flex min-w-0 flex-1 flex-col border-l border-line-soft">
              <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-line-soft bg-panel px-2">
                <Columns2 size={10} className="text-faint" />
                <select
                  value={splitTabId ?? ''}
                  onChange={(event) => {
                    const id = event.target.value;
                    if (id) setSplitTab(id);
                  }}
                  className="h-6 min-w-0 flex-1 border-transparent bg-transparent text-[10.5px] text-muted"
                  title="Choose the file in the second pane"
                >
                  <option value="">Choose a file…</option>
                  {tabs.map((tab) => (
                    <option key={tab.id} value={tab.id}>
                      {tab.title}
                    </option>
                  ))}
                </select>
                <IconButton label="Close split" onClick={closeSplit} title="Close split">
                  <X size={11} />
                </IconButton>
              </div>
              <div className="min-h-0 flex-1">
                {splitTab ? (
                  <PaneContent tab={splitTab} />
                ) : (
                  <div className="flex h-full items-center justify-center text-[11.5px] text-faint">
                    Choose a file for the second pane.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <Welcome />
        </div>
      )}
    </div>
  );
}
