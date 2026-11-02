import { useAppStore } from '../state/app';
import { activeSelection, getActiveEditor } from './editorRegistry';
import { errorMessage } from './format';
import { requestTerminalCommand } from './terminalBus';
import { absolutePath, copyToClipboard, isHtmlFile, openInBrowser, revealInFileManager } from './workspaceActions';

export interface CommandDefinition {
  id: string;
  title: string;
  category: string;
  shortcut?: string;
  keywords?: string;
}

export const COMMANDS: CommandDefinition[] = [
  { id: 'file.openFolder', title: 'Open Folder…', category: 'File', shortcut: '⌘O', keywords: 'workspace project' },
  { id: 'file.newFile', title: 'New File…', category: 'File', shortcut: '⌘N' },
  { id: 'file.newFolder', title: 'New Folder…', category: 'File' },
  { id: 'file.save', title: 'Save', category: 'File', shortcut: '⌘S' },
  { id: 'file.saveAll', title: 'Save All', category: 'File', shortcut: '⌘⌥S' },
  { id: 'file.closeTab', title: 'Close Editor', category: 'File', shortcut: '⌘W' },
  { id: 'file.closeWorkspace', title: 'Close Folder', category: 'File' },
  {
    id: 'file.openInBrowser',
    title: 'Open in Browser',
    category: 'File',
    keywords: 'preview chrome firefox safari html web page',
  },
  { id: 'file.copyPath', title: 'Copy Absolute Path', category: 'File', keywords: 'clipboard filename' },
  { id: 'file.revealInFinder', title: 'Reveal in File Manager', category: 'File', keywords: 'finder explorer reveal' },
  { id: 'edit.commandPalette', title: 'Show Command Palette', category: 'Edit', shortcut: '⌘⇧P' },
  { id: 'edit.quickOpen', title: 'Go to File…', category: 'Edit', shortcut: '⌘P' },
  { id: 'editor.find', title: 'Find in Editor', category: 'Edit', shortcut: '⌘F' },
  { id: 'editor.replace', title: 'Replace in Editor', category: 'Edit', shortcut: '⌘⌥F' },
  { id: 'editor.toggleWordWrap', title: 'Toggle Word Wrap', category: 'Edit', keywords: 'line wrap soft wrap' },
  { id: 'editor.toggleMinimap', title: 'Toggle Minimap', category: 'Edit', keywords: 'code overview map' },
  { id: 'editor.formatDocument', title: 'Format Document', category: 'Edit', keywords: 'prettier indent' },
  { id: 'editor.selectAll', title: 'Select All', category: 'Edit' },
  { id: 'view.explorer', title: 'Show Explorer', category: 'View', shortcut: '⌘⇧E' },
  { id: 'view.search', title: 'Show Search', category: 'View', shortcut: '⌘⇧F' },
  { id: 'view.scm', title: 'Show Source Control', category: 'View', shortcut: '⌘⇧G' },
  { id: 'view.specs', title: 'Show Specs', category: 'View', shortcut: '⌘⇧S' },
  { id: 'view.agents', title: 'Show Agents', category: 'View', shortcut: '⌘⇧A' },
  { id: 'view.history', title: 'Show Checkpoints & History', category: 'View' },
  { id: 'view.models', title: 'Models & Providers', category: 'View' },
  { id: 'view.settings', title: 'Open Settings', category: 'View', shortcut: '⌘,' },
  { id: 'view.toggleSidebar', title: 'Toggle Side Bar', category: 'View', shortcut: '⌘B' },
  { id: 'view.toggleAIPanel', title: 'Toggle AI Panel', category: 'View', shortcut: '⌘⌥B' },
  { id: 'view.toggleBottomPanel', title: 'Toggle Panel', category: 'View', shortcut: '⌘J' },
  { id: 'view.splitEditor', title: 'Split Editor', category: 'View', shortcut: '⌘\\' },
  { id: 'view.terminal', title: 'Show Terminal', category: 'View', shortcut: '⌘`' },
  { id: 'view.problems', title: 'Show Problems', category: 'View', shortcut: '⌘⇧M' },
  { id: 'view.debug', title: 'Show Run & Debug', category: 'View' },
  { id: 'view.git', title: 'Show Git Panel', category: 'View' },
  { id: 'workspace.index', title: 'Index Project', category: 'Workspace' },
  { id: 'workspace.reindex', title: 'Rebuild Project Index', category: 'Workspace' },
  { id: 'specs.new', title: 'New Spec…', category: 'Specs' },
  { id: 'agent.run', title: 'Run Coding Agent', category: 'AI', shortcut: '⌘⇧↵' },
  { id: 'agent.seo', title: 'Run SEO Agent', category: 'AI', keywords: 'search metadata sitemap audit' },
  { id: 'ai.focusChat', title: 'Focus AI Chat', category: 'AI', shortcut: '⌘⌥C' },
  { id: 'ai.newChat', title: 'New Chat', category: 'AI', shortcut: '⌘⌥N' },
  { id: 'ai.inlineEdit', title: 'Inline AI Edit Selection', category: 'AI', shortcut: '⌘K' },
  { id: 'ai.explainSelection', title: 'Explain Selection', category: 'AI', shortcut: '⌘⇧E' },
  { id: 'ai.generateTests', title: 'Generate Tests for Selection', category: 'AI' },
  { id: 'ai.generateDocs', title: 'Generate Documentation for Selection', category: 'AI' },
];

function requireSelection(): ReturnType<typeof activeSelection> {
  const selection = activeSelection();
  if (!selection) {
    useAppStore.getState().toast('info', 'Open a file in the editor first.');
    return null;
  }
  const state = useAppStore.getState();
  const path = selection.path || state.activeTabId?.replace(/^file:/, '') || '';
  if (!path) {
    state.toast('info', 'Open a file in the editor first.');
    return null;
  }
  return { ...selection, path };
}

/** Path of the file in the active editor, used by the file-level commands. */
function currentFilePath(): string | null {
  const state = useAppStore.getState();
  const fromEditor = activeSelection()?.path || state.activeTabId?.replace(/^file:/, '') || '';
  const tab = state.tabs.find((entry) => entry.id === state.activeTabId);
  if (tab && tab.kind !== 'file') return null;
  return fromEditor || null;
}

export async function runCommand(id: string): Promise<void> {
  const store = useAppStore.getState();
  switch (id) {
    case 'file.openFolder':
      await store.openFolder();
      return;
    case 'file.newFile':
      store.askPrompt({
        title: 'New file',
        message: 'Enter a path relative to the workspace root.',
        placeholder: 'src/components/NewComponent.tsx',
        submitLabel: 'Create file',
        onSubmit: async (value) => {
          const path = value.trim().replace(/^\/+/, '');
          if (!path) return;
          try {
            await window.forge.workspace.createFile(path);
            await store.refreshTree();
            await store.openFile(path);
          } catch (error) {
            store.toast('error', errorMessage(error));
          }
        },
      });
      return;
    case 'file.newFolder':
      store.askPrompt({
        title: 'New folder',
        message: 'Enter a path relative to the workspace root.',
        placeholder: 'src/features/new-feature',
        submitLabel: 'Create folder',
        onSubmit: async (value) => {
          const path = value.trim().replace(/^\/+/, '');
          if (!path) return;
          try {
            await window.forge.workspace.createDirectory(path);
            await store.refreshTree();
          } catch (error) {
            store.toast('error', errorMessage(error));
          }
        },
      });
      return;
    case 'file.save':
      await store.saveTab();
      return;
    case 'file.saveAll':
      await store.saveAll();
      return;
    case 'file.closeTab':
      if (store.activeTabId) await store.closeTab(store.activeTabId);
      return;
    case 'file.closeWorkspace':
      await store.closeWorkspace();
      return;
    case 'file.openInBrowser': {
      const path = currentFilePath();
      if (!path) {
        store.toast('info', 'Open an HTML file first.');
        return;
      }
      if (!isHtmlFile(path)) {
        store.toast('info', `${path.split('/').pop() ?? path} is not a web page.`);
        return;
      }
      await openInBrowser(path);
      return;
    }
    case 'file.copyPath': {
      const path = currentFilePath();
      if (!path) {
        store.toast('info', 'Open a file first.');
        return;
      }
      await copyToClipboard(absolutePath(path), 'absolute path');
      return;
    }
    case 'file.revealInFinder': {
      const path = currentFilePath();
      if (!path) {
        store.toast('info', 'Open a file first.');
        return;
      }
      await revealInFileManager(path);
      return;
    }
    case 'edit.commandPalette':
      store.setPaletteOpen(true);
      return;
    case 'edit.quickOpen':
      store.setQuickOpenOpen(true);
      return;
    case 'editor.find':
      void getActiveEditor()?.getAction('actions.find')?.run();
      return;
    case 'editor.replace':
      void getActiveEditor()?.getAction('editor.action.startFindReplaceAction')?.run();
      return;
    case 'editor.toggleWordWrap':
      await store.updateSettings({ wordWrap: !(store.settings?.wordWrap ?? false) });
      return;
    case 'editor.toggleMinimap':
      await store.updateSettings({ editorMinimap: !(store.settings?.editorMinimap ?? false) });
      return;
    case 'editor.formatDocument':
      void getActiveEditor()?.getAction('editor.action.formatDocument')?.run();
      return;
    case 'editor.selectAll':
      void getActiveEditor()?.getAction('editor.action.selectAll')?.run();
      return;
    case 'view.explorer':
      store.setActivity('explorer');
      return;
    case 'view.search':
      store.bumpSearchFocus();
      return;
    case 'view.scm':
      store.setActivity('scm');
      return;
    case 'view.specs':
      store.setActivity('specs');
      return;
    case 'view.agents':
      store.setActivity('agents');
      return;
    case 'view.history':
      store.setActivity('history');
      return;
    case 'view.extensions':
      store.setActivity('extensions');
      return;
    case 'view.models':
      store.setModelsOpen(true);
      return;
    case 'view.settings':
      store.setSettingsOpen(true);
      return;
    case 'view.toggleSidebar':
      store.toggleSidebar();
      return;
    case 'view.toggleAIPanel':
      store.toggleAI();
      return;
    case 'view.toggleBottomPanel':
      store.toggleBottom();
      return;
    case 'view.splitEditor':
      if (!store.activeTabId) {
        store.toast('info', 'Open a file before splitting the editor.');
        return;
      }
      store.toggleSplit();
      return;
    case 'view.terminal':
      store.showBottom('terminal');
      return;
    case 'view.problems':
      store.showBottom('problems');
      return;
    case 'view.debug':
      store.showBottom('debug');
      return;
    case 'view.git':
      store.showBottom('git');
      return;
    case 'workspace.index':
      await store.startIndex(false);
      return;
    case 'workspace.reindex':
      await store.startIndex(true);
      return;
    case 'specs.new':
      store.requestNewSpec();
      return;
    case 'agent.run':
      store.setAgentMode('coding');
      store.openAI('agent');
      store.setActivity('agents');
      return;
    case 'agent.seo':
      store.setAgentMode('seo');
      store.openAI('agent');
      store.setActivity('agents');
      return;
    case 'ai.focusChat':
      store.openAI('chat');
      return;
    case 'ai.newChat':
      store.newChat();
      return;
    case 'ai.inlineEdit': {
      const selection = requireSelection();
      if (!selection) return;
      store.openQuickEdit('refactor', selection.code, selection.language, selection.path, selection.hasSelection);
      return;
    }
    case 'ai.explainSelection': {
      const selection = requireSelection();
      if (!selection) return;
      store.openQuickEdit('explain', selection.code, selection.language, selection.path, false);
      return;
    }
    case 'ai.generateTests': {
      const selection = requireSelection();
      if (!selection) return;
      store.openQuickEdit('tests', selection.code, selection.language, selection.path, selection.hasSelection);
      return;
    }
    case 'ai.generateDocs': {
      const selection = requireSelection();
      if (!selection) return;
      store.openQuickEdit('docs', selection.code, selection.language, selection.path, false);
      return;
    }
    case 'terminal.run': {
      const command = (globalThis as { __forgeRunCommand?: string }).__forgeRunCommand;
      if (command) {
        store.showBottom('terminal');
        requestTerminalCommand(command);
      }
      return;
    }
    default:
      return;
  }
}
