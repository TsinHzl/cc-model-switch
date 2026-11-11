import {
  clipboardIpcResponseSchema, type ClipboardIpcErrorCode, type ClipboardIpcResponse,
} from './clipboardIpcContract';

const messages = Object.freeze({
  FORBIDDEN: '剪贴板请求来源未获授权。',
  INVALID_REQUEST: '复制文本格式无效，无法提交剪贴板请求。',
  BODY_TOO_LARGE: '复制文本超过剪贴板大小限制，未截断文本。',
  RATE_LIMITED: '当前有剪贴板操作正在进行，请等待其完成。',
  CLIPBOARD_WRITE_FAILED: '剪贴板写入失败，内容可能已更改；请自行核对，不要直接重复复制。',
} satisfies Record<ClipboardIpcErrorCode, string>);
const unavailable = '桌面剪贴板桥接不可用，请使用桌面应用打开。';
const unknownResult = '剪贴板通信失败，操作结果未知；请自行核对，勿自动重试。';
const fallback = '复制结果无法确认，请自行核对，不要直接重复复制。';
const safeMessages = new Set<string>([...Object.values(messages), unavailable, unknownResult]);

export async function writeClipboardText(text: string): Promise<void> {
  const bridge = typeof window === 'undefined' ? undefined : window.desktop?.clipboard;
  if (!bridge || typeof bridge.writeText !== 'function') throw new Error(unavailable);
  let response: ClipboardIpcResponse;
  try {
    response = clipboardIpcResponseSchema.parse(await bridge.writeText(text));
  } catch {
    throw new Error(unknownResult);
  }
  if (!response.success) throw new Error(messages[response.code]);
}

export function clipboardErrorMessage(error: unknown): string {
  try {
    if (error instanceof Error) {
      const message = error.message;
      if (safeMessages.has(message)) return message;
    }
  } catch {
    return fallback;
  }
  return fallback;
}
