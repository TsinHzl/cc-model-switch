import {
  clipboardIpcChannel, clipboardIpcRequestSchema, clipboardIpcResponseSchema,
  type ClipboardBridge, type ClipboardIpcResponse,
} from '../src/lib/clipboardIpcContract';

type Invoke = (channel: typeof clipboardIpcChannel, text: string) => Promise<unknown>;

export function createClipboardBridge(invoke: Invoke): ClipboardBridge {
  return Object.freeze({
    writeText: async (...args: unknown[]): Promise<ClipboardIpcResponse> => {
      try {
        if (args.length !== 1 || typeof args[0] !== 'string') {
          return { success: false, code: 'INVALID_REQUEST' };
        }
        const request = clipboardIpcRequestSchema.safeParse(args);
        if (!request.success) {
          const oversized = request.error.issues.some(issue =>
            issue.code === 'custom' && issue.message === 'BODY_TOO_LARGE');
          return { success: false, code: oversized ? 'BODY_TOO_LARGE' : 'INVALID_REQUEST' };
        }
        return clipboardIpcResponseSchema.parse(await invoke(clipboardIpcChannel, request.data[0]));
      } catch {
        throw new Error('剪贴板通信失败，操作结果未知；请自行核对，勿自动重试。');
      }
    },
  });
}
