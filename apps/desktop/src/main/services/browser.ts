import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { shell } from 'electron';
import type { BrowserOption } from '@forgeai/shared';

interface BrowserCandidate {
  id: string;
  name: string;
  /** macOS application bundle names, tried in order. */
  macApps: string[];
  /** Windows executables relative to the usual install roots. */
  winExes: string[];
  /** Linux executables looked up on PATH. */
  linuxBins: string[];
}

/**
 * Ordered by how common each browser is. Only browsers that are actually
 * installed are offered in the UI, so the list stays short on a clean machine.
 */
const CANDIDATES: BrowserCandidate[] = [
  {
    id: 'chrome',
    name: 'Google Chrome',
    macApps: ['Google Chrome.app'],
    winExes: ['Google/Chrome/Application/chrome.exe'],
    linuxBins: ['google-chrome', 'google-chrome-stable'],
  },
  {
    id: 'chrome-canary',
    name: 'Chrome Canary',
    macApps: ['Google Chrome Canary.app'],
    winExes: ['Google/Chrome SxS/Application/chrome.exe'],
    linuxBins: ['google-chrome-canary'],
  },
  {
    id: 'chromium',
    name: 'Chromium',
    macApps: ['Chromium.app'],
    winExes: ['Chromium/Application/chrome.exe'],
    linuxBins: ['chromium', 'chromium-browser'],
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    macApps: ['Microsoft Edge.app'],
    winExes: ['Microsoft/Edge/Application/msedge.exe'],
    linuxBins: ['microsoft-edge', 'microsoft-edge-stable'],
  },
  {
    id: 'firefox',
    name: 'Firefox',
    macApps: ['Firefox.app'],
    winExes: ['Mozilla Firefox/firefox.exe'],
    linuxBins: ['firefox', 'firefox-esr'],
  },
  {
    id: 'brave',
    name: 'Brave',
    macApps: ['Brave Browser.app'],
    winExes: ['BraveSoftware/Brave-Browser/Application/brave.exe'],
    linuxBins: ['brave', 'brave-browser'],
  },
  {
    id: 'arc',
    name: 'Arc',
    macApps: ['Arc.app'],
    winExes: [],
    linuxBins: [],
  },
  {
    id: 'vivaldi',
    name: 'Vivaldi',
    macApps: ['Vivaldi.app'],
    winExes: ['Vivaldi/Application/vivaldi.exe'],
    linuxBins: ['vivaldi', 'vivaldi-stable'],
  },
  {
    id: 'opera',
    name: 'Opera',
    macApps: ['Opera.app'],
    winExes: ['Program Files/Opera/launcher.exe', 'Opera/launcher.exe'],
    linuxBins: ['opera'],
  },
  {
    id: 'safari',
    name: 'Safari',
    macApps: ['Safari.app'],
    winExes: [],
    linuxBins: [],
  },
];

export const DEFAULT_BROWSER_OPTION: BrowserOption = { id: 'default', name: 'System default browser', available: true };

async function exists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

function macAppBundle(appName: string): string[] {
  return [path.join('/Applications', appName), path.join(os.homedir(), 'Applications', appName)];
}

function winRoots(): string[] {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const programFilesX86 =
    process.env['ProgramFiles (x86)'] ?? process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  return [programFiles, programFilesX86, localAppData];
}

/** Absolute path to the launcher for a browser, or null when it is not installed. */
async function resolveLauncher(candidate: BrowserCandidate): Promise<string | null> {
  if (process.platform === 'darwin') {
    for (const appName of candidate.macApps) {
      for (const bundle of macAppBundle(appName)) {
        if (await exists(bundle)) return bundle;
      }
    }
    return null;
  }
  if (process.platform === 'win32') {
    for (const exe of candidate.winExes) {
      for (const root of winRoots()) {
        const full = path.join(root, exe);
        if (await exists(full)) return full;
      }
    }
    return null;
  }
  // Linux and other POSIX systems: look for the executable on PATH.
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const bin of candidate.linuxBins) {
    for (const dir of pathDirs) {
      const full = path.join(dir, bin);
      if (await exists(full)) return full;
    }
  }
  return null;
}

/** Browsers offered in the "Open in Browser" menu, availability already checked. */
export async function detectBrowsers(): Promise<BrowserOption[]> {
  const options = await Promise.all(
    CANDIDATES.map(async (candidate) => ({
      id: candidate.id,
      name: candidate.name,
      available: (await resolveLauncher(candidate)) !== null,
    })),
  );
  return [DEFAULT_BROWSER_OPTION, ...options];
}

function run(launcher: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(launcher, args, { detached: true, stdio: 'ignore' });
    child.unref();
    let settled = false;
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    // The browser stays alive after `open` returns, so treat a clean exit (or a
    // quick detach) as success instead of waiting for the process to end.
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0 || code === null) resolve();
      else reject(new Error(`${launcher} exited with code ${code}`));
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve();
    }, 1500).unref?.();
  });
}

/**
 * Opens a file in a browser. `browserId` is 'default' (OS handler) or one of the
 * ids from {@link detectBrowsers}. Throws with a user-facing message when the
 * requested browser is not installed so the UI can offer the default instead.
 */
export async function openInBrowser(absolutePath: string, browserId: string): Promise<string> {
  if (browserId === DEFAULT_BROWSER_OPTION.id || browserId.length === 0) {
    const error = await shell.openPath(absolutePath);
    if (error) throw new Error(error);
    return DEFAULT_BROWSER_OPTION.name;
  }
  const candidate = CANDIDATES.find((entry) => entry.id === browserId);
  if (!candidate) throw new Error(`Unknown browser "${browserId}".`);
  const launcher = await resolveLauncher(candidate);
  if (!launcher) {
    throw new Error(`${candidate.name} is not installed. Choose another browser in Settings → Browser & Preview.`);
  }
  const url = pathToFileURL(absolutePath).href;
  if (process.platform === 'darwin') {
    // `open -a <bundle>` keeps LaunchServices responsible for activation and
    // works for both /Applications and ~/Applications installs.
    await run('open', ['-a', launcher, url]);
  } else {
    await run(launcher, [url]);
  }
  return candidate.name;
}
