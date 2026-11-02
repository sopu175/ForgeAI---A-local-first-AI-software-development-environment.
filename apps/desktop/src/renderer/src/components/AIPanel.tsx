import { useEffect, useState } from 'react';
import { FileDiff, MessageSquare, PanelRightClose, Paperclip } from 'lucide-react';
import type { AiTab } from '../state/app';
import { useAppStore } from '../state/app';
import { cn } from './ui';
import { AssistantPanel } from './ai/AssistantPanel';
import { DiffsPanel } from './ai/DiffsPanel';
import { ContextPanel } from './ai/ContextPanel';

const TABS: Array<{ id: AiTab; label: string; icon: React.ReactNode }> = [
  { id: 'chat', label: 'Assistant', icon: <MessageSquare size={11} /> },
  { id: 'diffs', label: 'Diffs', icon: <FileDiff size={11} /> },
  { id: 'context', label: 'Context', icon: <Paperclip size={11} /> },
];

export function AIPanel() {
  const aiOpen = useAppStore((state) => state.aiOpen);
  const aiTab = useAppStore((state) => state.aiTab);
  const setAiTab = useAppStore((state) => state.setAiTab);
  const toggleAI = useAppStore((state) => state.toggleAI);
  const streaming = useAppStore((state) => state.streaming);
  const agentRun = useAppStore((state) => state.agentRun);
  const contextFiles = useAppStore((state) => state.contextFiles);

  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('forgeai:ai-panel-width');
      const parsed = saved ? parseInt(saved, 10) : 420;
      return Number.isFinite(parsed) && parsed >= 320 && parsed <= 900 ? parsed : 420;
    } catch {
      return 420;
    }
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(320, Math.min(900, window.innerWidth - e.clientX));
      setPanelWidth(newWidth);
    };
    const handleMouseUp = () => {
      setIsResizing(false);
      try {
        localStorage.setItem('forgeai:ai-panel-width', String(panelWidth));
      } catch {}
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, panelWidth]);

  if (!aiOpen) return null;

  // Chat and agent runs share the Assistant panel; "agent" stays a valid tab id
  // so existing menu commands and shortcuts keep working.
  const assistantActive = aiTab === 'chat' || aiTab === 'agent';
  const agentRunning = agentRun?.status === 'running';

  return (
    <aside
      className="ai-panel relative app-no-drag"
      style={{ width: panelWidth, flex: `0 0 ${panelWidth}px` }}
      aria-label="AI assistant"
    >
      {/* Left resize handle */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          setIsResizing(true);
        }}
        onDoubleClick={() => {
          setPanelWidth(420);
          try {
            localStorage.setItem('forgeai:ai-panel-width', '420');
          } catch {}
        }}
        className="absolute inset-y-0 -left-1 w-2 cursor-col-resize hover:bg-accent/40 active:bg-accent transition-colors z-20"
        title="Drag to resize AI panel (double-click to reset)"
      />
      <div className="flex h-[38px] shrink-0 items-center gap-0.5 border-b border-line-soft px-1.5">
        {TABS.map((tab) => {
          const active = tab.id === 'chat' ? assistantActive : aiTab === tab.id;
          const count =
            tab.id === 'diffs' ? (agentRun?.changes.length ?? 0) : tab.id === 'context' ? contextFiles.length : 0;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setAiTab(tab.id)}
              className={cn(
                'focus-ring relative flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] transition-colors',
                active ? 'bg-panel-3 text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg',
              )}
              aria-selected={active}
              role="tab"
            >
              {tab.icon}
              {tab.label}
              {count > 0 ? (
                <span
                  className={cn('rounded px-1 text-[8.5px]', active ? 'bg-accent text-white' : 'bg-panel-3 text-faint')}
                >
                  {count}
                </span>
              ) : null}
              {/* Live agent running pulse on the Assistant tab */}
              {tab.id === 'chat' && agentRunning ? (
                <span className="flex items-center gap-1 rounded-full bg-accent/15 border border-accent/40 px-1.5 py-0.5 text-[8.5px] font-semibold text-accent ml-0.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  Running
                </span>
              ) : tab.id === 'chat' && streaming ? (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              ) : null}
            </button>
          );
        })}
        <button
          type="button"
          onClick={toggleAI}
          className="focus-ring ml-auto rounded p-1 text-faint hover:bg-panel-3 hover:text-fg"
          title="Hide AI panel (⌘⌥B)"
          aria-label="Hide AI panel"
        >
          <PanelRightClose size={13} />
        </button>
      </div>

      {assistantActive ? <AssistantPanel /> : null}
      {aiTab === 'diffs' ? <DiffsPanel /> : null}
      {aiTab === 'context' ? <ContextPanel /> : null}
    </aside>
  );
}
