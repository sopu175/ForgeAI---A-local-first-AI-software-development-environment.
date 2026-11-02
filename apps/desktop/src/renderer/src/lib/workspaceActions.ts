import type { BrowserOption } from '@forgeai/shared';
import { useAppStore } from '../state/app';
import { errorMessage } from './format';
import { requestTerminalCommand } from './terminalBus';

const HTML_EXT = /\.(html|htm|xhtml)$/i;

let cachedBrowsers: BrowserOption[] | null = null;
let pendingBrowsers: Promise<BrowserOption[]> | null = null;

export function isHtmlFile(path: string): boolean {
  return HTML_EXT.test(path);
}

/** Browsers offered by "Open in Browser", cached for the lifetime of the window. */
export async function installedBrowsers(): Promise<BrowserOption[]> {
  if (cachedBrowsers) return cachedBrowsers;
  pendingBrowsers ??= window.forge.workspace
    .browsers()
    .then((list) => {
      cachedBrowsers = list;
      return list;
    })
    .catch((error) => {
      useAppStore.getState().toast('error', errorMessage(error));
      cachedBrowsers = [];
      return cachedBrowsers;
    });
  return pendingBrowsers;
}

export function forgetBrowserCache(): void {
  cachedBrowsers = null;
  pendingBrowsers = null;
}

/** Opens a workspace-relative file in a browser. Omit the id to use the configured default. */
export async function openInBrowser(relativePath: string, browserId?: string): Promise<void> {
  const state = useAppStore.getState();
  try {
    const result = await window.forge.workspace.openInBrowser(relativePath, browserId);
    const file = relativePath.split('/').pop() ?? relativePath;
    state.toast('success', `Opened ${file} in ${result.browser}`);
  } catch (error) {
    state.toast('error', errorMessage(error));
  }
}

/** Absolute path of a workspace-relative file, or the relative path with no workspace open. */
export function absolutePath(relativePath: string): string {
  const root = useAppStore.getState().project?.root ?? '';
  if (!root) return relativePath;
  return `${root.replace(/\/+$/, '')}/${relativePath.replace(/^\/+/, '')}`;
}

export async function copyToClipboard(text: string, label: string): Promise<void> {
  const state = useAppStore.getState();
  try {
    await navigator.clipboard.writeText(text);
    state.toast('info', `Copied ${label}`);
  } catch {
    state.toast('error', 'Clipboard is unavailable.');
  }
}

export async function revealInFileManager(relativePath: string): Promise<void> {
  const state = useAppStore.getState();
  try {
    await window.forge.workspace.reveal(relativePath);
  } catch (error) {
    state.toast('error', errorMessage(error));
  }
}

/** POSIX single-quoted argument, safe for paths with spaces and quotes. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Runs a command in the integrated terminal (panel opens if hidden). */
export function runInTerminal(command: string): void {
  useAppStore.getState().showBottom('terminal');
  requestTerminalCommand(command);
}

/** Opens the terminal at a workspace folder (pass '' for the project root). */
export function openFolderInTerminal(folderPath: string): void {
  const root = useAppStore.getState().project?.root ?? '';
  const target = folderPath ? absolutePath(folderPath) : root || folderPath;
  runInTerminal(`cd ${shellQuote(target)}`);
}
