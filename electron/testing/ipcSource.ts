import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { RENDERER_URL } from '../renderer';

export function createSource(targetUrl = RENDERER_URL) {
  const url = new URL(targetUrl);
  const frame = {
    url: url.href, origin: `${url.protocol}//${url.host}`,
    detached: false, isDestroyed: () => false,
  };
  const contents = { mainFrame: frame, isDestroyed: () => false };
  const window = { webContents: contents, isDestroyed: () => false };
  const message = { sender: contents, senderFrame: frame as typeof frame | null };
  return {
    frame, contents, window, message,
    event: message as unknown as IpcMainInvokeEvent,
    trusted: { window: window as unknown as BrowserWindow, targetUrl },
  };
}
