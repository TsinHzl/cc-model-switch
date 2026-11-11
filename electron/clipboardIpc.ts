import type { IpcMainInvokeEvent } from 'electron';
import {
  clipboardIpcRequestSchema, type ClipboardIpcResponse,
} from '../src/lib/clipboardIpcContract';
import { isTrusted, type GetTrustedWindow } from './ipcSource';

interface ClipboardHandlerOptions {
  getTrustedWindow: GetTrustedWindow;
  writeText: (text: string) => Promise<void>;
}

export function createClipboardHandler({
  getTrustedWindow, writeText,
}: ClipboardHandlerOptions) {
  let busy = false;
  return async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<ClipboardIpcResponse> => {
    let acquired = false;
    try {
      if (!isTrusted(event, getTrustedWindow)) return { success: false, code: 'FORBIDDEN' };
      if (args.length !== 1 || typeof args[0] !== 'string') {
        return { success: false, code: 'INVALID_REQUEST' };
      }
      const request = clipboardIpcRequestSchema.safeParse(args);
      if (!request.success) {
        const oversized = request.error.issues.some(issue =>
          issue.code === 'custom' && issue.message === 'BODY_TOO_LARGE');
        return { success: false, code: oversized ? 'BODY_TOO_LARGE' : 'INVALID_REQUEST' };
      }
      if (busy) return { success: false, code: 'RATE_LIMITED' };
      busy = true;
      acquired = true;
      await writeText(request.data[0]);
      return { success: true };
    } catch {
      return { success: false, code: 'CLIPBOARD_WRITE_FAILED' };
    } finally {
      if (acquired) busy = false;
    }
  };
}
