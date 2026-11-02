import { Menu, app, shell, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import { broadcast } from './broadcast';
import { openWorkspace, type AppContext } from './context';

function command(name: string): void {
  broadcast('app:command', { command: name });
}

export function installMenu(ctx: AppContext): void {
  const isMac = process.platform === 'darwin';
  const recent = ctx.workspace.recent().slice(0, 10);

  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => command('view.settings') },
        { label: 'Model Manager…', click: () => command('view.models') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push({
    label: 'File',
    submenu: [
      { label: 'New File…', accelerator: 'CmdOrCtrl+N', click: () => command('file.newFile') },
      {
        label: 'Open Folder…',
        accelerator: 'CmdOrCtrl+O',
        click: () => command('file.openFolder'),
      },
      {
        label: 'Open Recent',
        enabled: recent.length > 0,
        submenu:
          recent.length > 0
            ? recent.map<MenuItemConstructorOptions>((project) => ({
                label: `${project.name} — ${project.root.replace(/^\/Users\/[^/]+/, '~').slice(0, 60)}`,
                click: async () => {
                  try {
                    const summary = await openWorkspace(ctx, project.root);
                    broadcast('app:open-workspace', { root: summary.root });
                  } catch (error) {
                    broadcast('app:toast', {
                      kind: 'error',
                      message: error instanceof Error ? error.message : String(error),
                    });
                  }
                },
              }))
            : [{ label: 'No recent projects', enabled: false }],
      },
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => command('file.save') },
      { label: 'Save All', accelerator: 'CmdOrCtrl+Alt+S', click: () => command('file.saveAll') },
      { type: 'separator' },
      {
        label: 'Open in Browser',
        sublabel: 'Opens the active HTML file in your default browser',
        click: () => command('file.openInBrowser'),
      },
      { label: 'Reveal in File Manager', click: () => command('file.revealInFinder') },
      { label: 'Copy Absolute Path', click: () => command('file.copyPath') },
      { type: 'separator' },
      { label: 'Close Editor', accelerator: 'CmdOrCtrl+W', click: () => command('file.closeTab') },
      { label: 'Close Folder', click: () => command('file.closeWorkspace') },
      ...(!isMac ? ([{ type: 'separator' }, { role: 'quit' }] as MenuItemConstructorOptions[]) : []),
    ],
  });

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
      { type: 'separator' },
      { label: 'Find in File', accelerator: 'CmdOrCtrl+F', click: () => command('editor.find') },
      {
        label: 'Replace in File',
        accelerator: 'CmdOrCtrl+Alt+F',
        click: () => command('editor.replace'),
      },
      { label: 'Format Document', click: () => command('editor.formatDocument') },
      { label: 'Toggle Word Wrap', click: () => command('editor.toggleWordWrap') },
      { label: 'Toggle Minimap', click: () => command('editor.toggleMinimap') },
      {
        label: 'Command Palette…',
        accelerator: 'CmdOrCtrl+Shift+P',
        click: () => command('edit.commandPalette'),
      },
      { type: 'separator' },
      {
        label: 'Inline AI Edit',
        accelerator: 'CmdOrCtrl+K',
        click: () => command('ai.inlineEdit'),
      },
      {
        label: 'Explain Selection',
        accelerator: 'CmdOrCtrl+Shift+E',
        click: () => command('ai.explainSelection'),
      },
      { label: 'Generate Tests', click: () => command('ai.generateTests') },
      { label: 'Generate Documentation', click: () => command('ai.generateDocs') },
    ],
  });

  template.push({
    label: 'View',
    submenu: [
      { label: 'Command Palette…', accelerator: 'CmdOrCtrl+Shift+P', click: () => command('edit.commandPalette') },
      { label: 'Quick Open File…', accelerator: 'CmdOrCtrl+P', click: () => command('edit.quickOpen') },
      { type: 'separator' },
      { label: 'Explorer', accelerator: 'CmdOrCtrl+Shift+E', click: () => command('view.explorer') },
      { label: 'Search', accelerator: 'CmdOrCtrl+Shift+F', click: () => command('view.search') },
      { label: 'Source Control', accelerator: 'CmdOrCtrl+Shift+G', click: () => command('view.scm') },
      { label: 'Specs', accelerator: 'CmdOrCtrl+Shift+S', click: () => command('view.specs') },
      { label: 'Agents', accelerator: 'CmdOrCtrl+Shift+A', click: () => command('view.agents') },
      { label: 'Checkpoints & History', click: () => command('view.history') },
      { label: 'Models & Providers', click: () => command('view.models') },
      { type: 'separator' },
      { label: 'Toggle Side Bar', accelerator: 'CmdOrCtrl+B', click: () => command('view.toggleSidebar') },
      { label: 'Toggle AI Panel', accelerator: 'CmdOrCtrl+Alt+B', click: () => command('view.toggleAIPanel') },
      { label: 'Toggle Panel', accelerator: 'CmdOrCtrl+J', click: () => command('view.toggleBottomPanel') },
      { label: 'Terminal', accelerator: 'CmdOrCtrl+`', click: () => command('view.terminal') },
      { label: 'Problems', accelerator: 'CmdOrCtrl+Shift+M', click: () => command('view.problems') },
      { type: 'separator' },
      { label: 'Settings…', accelerator: isMac ? undefined : 'Ctrl+,', click: () => command('view.settings') },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(!app.isPackaged
        ? ([
            { type: 'separator' },
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
          ] as MenuItemConstructorOptions[])
        : []),
    ],
  });

  template.push({
    label: 'AI',
    submenu: [
      {
        label: 'Run Coding Agent…',
        accelerator: 'CmdOrCtrl+Shift+Enter',
        click: () => command('agent.run'),
      },
      { label: 'Focus Chat', accelerator: 'CmdOrCtrl+Alt+C', click: () => command('ai.focusChat') },
      { label: 'New Chat', accelerator: 'CmdOrCtrl+Alt+N', click: () => command('ai.newChat') },
      { type: 'separator' },
      { label: 'Index Project', click: () => command('workspace.index') },
      { label: 'Rebuild Index', click: () => command('workspace.reindex') },
      { type: 'separator' },
      { label: 'New Spec…', click: () => command('specs.new') },
    ],
  });

  template.push({
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? ([{ type: 'separator' }, { role: 'front' }] as MenuItemConstructorOptions[])
        : ([{ role: 'close' }] as MenuItemConstructorOptions[])),
    ],
  });

  template.push({
    role: 'help',
    submenu: [
      {
        label: 'Documentation',
        click: async () => {
          const file = path.join(app.getAppPath(), 'docs', 'ARCHITECTURE.md');
          const error = await shell.openPath(file);
          if (error)
            broadcast('app:toast', { kind: 'error', message: 'Documentation is not available in this build.' });
        },
      },
      {
        label: 'Open Logs Folder',
        click: async () => {
          await shell.openPath(path.join(app.getPath('userData'), 'logs'));
        },
      },
      {
        label: 'ForgeAI Website',
        click: () => shell.openExternal('https://forgeai.dev'),
      },
      ...(!isMac
        ? ([
            { type: 'separator' },
            { label: `About ForgeAI ${app.getVersion()}`, enabled: false },
          ] as MenuItemConstructorOptions[])
        : []),
    ],
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
