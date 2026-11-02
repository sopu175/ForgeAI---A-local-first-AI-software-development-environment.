import { BrowserWindow } from 'electron';
import type { Broadcast } from './services/workspace';

export const broadcast: Broadcast = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(channel, payload);
  }
};
