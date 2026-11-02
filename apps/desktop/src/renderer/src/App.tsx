import { useEffect } from 'react';
import { useAppStore } from './state/app';
import { runCommand } from './lib/commands';
import { TopBar } from './components/TopBar';
import { ActivityBar } from './components/ActivityBar';
import { Sidebar } from './components/Sidebar';
import { EditorArea } from './components/EditorArea';
import { AIPanel } from './components/AIPanel';
import { BottomPanel } from './components/BottomPanel';
import { StatusBar } from './components/StatusBar';
import { RuntimeBanner } from './components/RuntimeBanner';
import { Toasts } from './components/Toasts';
import { PromptDialog, ConfirmDialog } from './components/Dialogs';
import { PermissionModal } from './components/PermissionModal';
import { SettingsModal } from './components/SettingsModal';
import { ModelsModal } from './components/ModelsModal';
import { CommandPalette } from './components/CommandPalette';
import { QuickOpen } from './components/QuickOpen';
import { QuickEditDialog } from './components/QuickEditDialog';

function LoadingScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-bg text-fg">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#007acc] text-2xl font-black text-white shadow-lg">
        F
      </div>
      <div className="text-center">
        <div className="text-[15px] font-semibold text-fg-strong">ForgeAI</div>
        <div className="mt-1 text-[11.5px] text-muted">Starting the local-first workspace…</div>
      </div>
      <span className="spinner" />
    </div>
  );
}

export function App() {
  const ready = useAppStore((state) => state.ready);
  const settings = useAppStore((state) => state.settings);

  useEffect(() => {
    void useAppStore.getState().init();
  }, []);

  // Apply theme and font tokens to the document.
  useEffect(() => {
    if (!settings) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme;
      document.documentElement.dataset['theme'] = resolved;
      document.documentElement.style.colorScheme = resolved;
      document.documentElement.style.setProperty('--font-size-ui', `${settings.uiFontSize}px`);
      document.documentElement.style.setProperty('--font-size-code', `${settings.codeFontSize}px`);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings]);

  // One-time IPC event wiring.
  useEffect(() => {
    const store = useAppStore.getState();
    const offs = [
      window.forge.events.on('workspace:changed', (change) => store.handleWorkspaceChange(change.path)),
      window.forge.events.on('workspace:opened', (project) => {
        void store.applyProject(project);
        store.toast('success', `Opened ${project.name}`);
      }),
      window.forge.events.on('index:progress', (status) => store.handleIndexProgress(status)),
      window.forge.events.on('ai:stream', ({ requestId, delta }) => store.handleChatDelta(requestId, delta)),
      window.forge.events.on('permission:request', (request) => {
        store.addPermission(request);
        store.openAI('agent');
      }),
      window.forge.events.on('permission:resolved', ({ id }) => store.removePermission(id)),
      window.forge.events.on('agent:event', ({ runId, event }) => store.handleAgentEvent(runId, event)),
      window.forge.events.on('spec:changed', () => store.handleSpecChanged()),
      window.forge.events.on('git:changed', ({ projectId }) => {
        const current = useAppStore.getState().project;
        if (current?.id === projectId) void useAppStore.getState().refreshGit();
      }),
      window.forge.events.on('runtime:progress', (status) => store.handleRuntimeProgress(status)),
      window.forge.events.on('app:command', ({ command }) => void runCommand(command)),
      window.forge.events.on('app:open-workspace', ({ root }) => void store.openWorkspace(root)),
      window.forge.events.on('app:toast', ({ kind, message }) => store.toast(kind, message)),
    ];

    window.forge.agent
      .pending()
      .then((requests) => {
        for (const request of requests) useAppStore.getState().addPermission(request);
      })
      .catch(() => undefined);

    return () => {
      for (const off of offs) off();
    };
  }, []);

  // Global keyboard shortcuts. Monaco owns editing shortcuts; these are the
  // workbench-level bindings.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const store = useAppStore.getState();
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (event.key === 'Escape' && store.paletteOpen) {
        store.setPaletteOpen(false);
        return;
      }
      if (!mod) {
        if (event.key === 'F5') {
          event.preventDefault();
          void runCommand('view.debug');
        }
        return;
      }

      const run = (id: string) => {
        event.preventDefault();
        void runCommand(id);
      };

      if (key === 'p') {
        event.preventDefault();
        if (event.shiftKey) store.setPaletteOpen(true);
        else store.setQuickOpenOpen(true);
        return;
      }
      if (key === 'o' && !event.shiftKey && !event.altKey) return run('file.openFolder');
      if (key === 's') {
        if (event.shiftKey) return run('view.specs');
        if (event.altKey) return run('file.saveAll');
        return run('file.save');
      }
      if (key === 'w') return run('file.closeTab');
      if (key === ',') return run('view.settings');
      if (key === 'b') return run(event.altKey ? 'view.toggleAIPanel' : 'view.toggleSidebar');
      if (key === 'j') return run('view.toggleBottomPanel');
      if (key === '\\') return run('view.splitEditor');
      if (key === '`') return run('view.terminal');
      if (key === 'm' && event.shiftKey) return run('view.problems');
      if (key === 'f') return run(event.shiftKey ? 'view.search' : 'editor.find');
      if (key === 'g' && event.shiftKey) return run('view.scm');
      if (key === 'e' && event.shiftKey) return run('view.explorer');
      if (key === 'a' && event.shiftKey) return run('view.agents');
      if (key === 'k') return run('ai.inlineEdit');
      if (key === 'enter' && event.shiftKey) return run('agent.run');
      if (key === 'c' && event.altKey) return run('ai.focusChat');
      if (key === 'n' && event.altKey) return run('ai.newChat');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!ready) return <LoadingScreen />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-fg" data-app-ready="true">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <RuntimeBanner />
          <div className="flex min-h-0 flex-1 flex-col">
            <EditorArea />
          </div>
          <BottomPanel />
        </main>
        <AIPanel />
      </div>
      <StatusBar />

      <Toasts />
      <PromptDialog />
      <ConfirmDialog />
      <PermissionModal />
      <SettingsModal />
      <ModelsModal />
      <CommandPalette />
      <QuickOpen />
      <QuickEditDialog />
    </div>
  );
}
