import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { getRendererUrl, RENDERER_URL } from './renderer';

export type GetTrustedWindow = () => {
  window: BrowserWindow;
  targetUrl: string;
} | null;

export function isTrusted(
  event: IpcMainInvokeEvent, getTrustedWindow: GetTrustedWindow,
): boolean {
  try {
    const trusted = getTrustedWindow();
    const frame = event.senderFrame;
    if (!trusted || trusted.window.isDestroyed()
        || trusted.window.webContents.isDestroyed()
        || event.sender !== trusted.window.webContents
        || !frame || frame.isDestroyed() || frame.detached
        || frame !== event.sender.mainFrame) return false;
    const { targetUrl } = trusted;
    const expected = new URL(targetUrl === RENDERER_URL
      ? targetUrl : getRendererUrl(false, targetUrl));
    return frame.origin === `${expected.protocol}//${expected.host}`
      && new URL(frame.url).href === expected.href;
  } catch {
    return false;
  }
}
