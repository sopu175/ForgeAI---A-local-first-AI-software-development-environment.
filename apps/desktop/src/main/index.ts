import { app, dialog, nativeTheme, screen, BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createContext, openWorkspace, type AppContext } from './context';
import { registerIpc } from './ipc';
import { installMenu } from './menu';
import { broadcast } from './broadcast';
import { createMainWindow, focusMainWindow, installContentSecurityPolicy, installSecurity } from './window';

// Configure undici dispatcher globally to disable headers/body timeouts for local AI models
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const undici = require('undici');
  if (undici?.setGlobalDispatcher && undici?.Agent) {
    undici.setGlobalDispatcher(
      new undici.Agent({
        headersTimeout: 0,
        bodyTimeout: 0,
        connectTimeout: 60_000,
      }),
    );
  }
} catch {
  // fallback if undici is not modularized
}

app.setName('ForgeAI');
app.setPath('userData', path.join(app.getPath('appData'), 'ForgeAI'));

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv) {
    if (arg === `--${name}`) return '';
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

const smoke = process.argv.includes('--smoke');
const smokeOut = readArg('smoke-out') ?? path.join(process.cwd(), 'smoke.png');
const explicitWorkspace = readArg('workspace');
const openPaths: string[] = [];

if (!smoke && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    focusMainWindow();
    const candidate = argv.find((arg, index) => index > 0 && !arg.startsWith('-') && path.isAbsolute(arg));
    if (candidate) openPaths.push(candidate);
    const target = openPaths.pop();
    if (target) broadcast('app:open-workspace', { root: target });
  });

  app.on('open-file', (event, file) => {
    event.preventDefault();
    openPaths.push(file);
    broadcast('app:open-workspace', { root: file });
  });

  let context: AppContext | null = null;
  let disposeIpc: (() => void) | null = null;

  const boot = async () => {
    app.setAppUserModelId('dev.forgeai.desktop');
    installSecurity();
    installContentSecurityPolicy();

    context = createContext();
    disposeIpc = registerIpc(context);
    nativeTheme.themeSource = context.settings.get().theme;

    let restored = false;
    const candidate = explicitWorkspace || openPaths.pop();
    if (candidate) {
      try {
        await openWorkspace(context, candidate);
        restored = true;
      } catch (error) {
        console.error(`[forgeai] could not open ${candidate}:`, error);
      }
    }
    if (!restored) {
      const last = context.db.getSetting('workspace:last');
      if (last) {
        try {
          const stat = await fs.stat(last);
          if (stat.isDirectory()) {
            await openWorkspace(context, last);
            restored = true;
          }
        } catch {
          context.db.setSetting('workspace:last', '');
        }
      }
    }

    installMenu(context);
    const window = createMainWindow();
    if (!smoke) {
      // Boot the local runtime immediately after the window shows so the first
      // chat does not wait on a cold Ollama start or a missing default model.
      // A short delay keeps it off the critical path of the first paint.
      setTimeout(() => context?.runtime.autoSetup(), 300).unref?.();
    }
    if (screen.getPrimaryDisplay().workArea.width >= 1700) window.maximize();

    if (smoke) {
      await new Promise<void>((resolve) => {
        if (!window.webContents.isLoading()) resolve();
        else window.webContents.once('did-finish-load', () => resolve());
      });
      // A restored workspace can take longer than a blank launch to hydrate.
      // Wait for the real shell (not the loading screen) before capturing.
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const ready = await window.webContents
          .executeJavaScript('Boolean(document.querySelector(\'[data-app-ready="true"]\'))')
          .catch(() => false);
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
      const image = await window.webContents.capturePage();
      await fs.mkdir(path.dirname(smokeOut), { recursive: true });
      await fs.writeFile(smokeOut, image.toPNG());
      console.log(`[forgeai] smoke screenshot written to ${smokeOut} (restored=${restored})`);
      app.quit();
    }
  };

  app
    .whenReady()
    .then(boot)
    .catch((error) => {
      console.error('[forgeai] failed to start', error);
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      dialog.showErrorBox('ForgeAI could not start', message);
      app.quit();
    });

  app.on('activate', async () => {
    if (!context || smoke) return;
    if (BrowserWindow.getAllWindows().length > 0) {
      focusMainWindow();
      return;
    }
    createMainWindow();
  });

  app.on('window-all-closed', () => {
    // ForgeAI is a single-window app. Quitting here (including on macOS) makes
    // sure the managed `ollama serve` child never outlives the window the user
    // closed. Ollama started outside ForgeAI is never stopped.
    app.quit();
  });

  let shuttingDown = false;
  app.on('before-quit', () => {
    if (shuttingDown) return;
    shuttingDown = true;
    disposeIpc?.();
    context?.dispose();
    context = null;
  });

  app.on('render-process-gone', (_event, _contents, details) => {
    console.error('[forgeai] renderer process gone:', details.reason);
  });
}
