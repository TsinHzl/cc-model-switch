import { z } from 'zod';

export const CLIPBOARD_TEXT_MAX_BYTES = 1024 * 1024;
export const clipboardIpcChannel = 'clipboard:writeText';

// 预算只计算原始文本的 UTF-8 字节，不包含 IPC 序列化开销。
const text = z.string()
  .refine(value => value.length <= CLIPBOARD_TEXT_MAX_BYTES, {
    error: 'BODY_TOO_LARGE', abort: true,
  })
  .refine(value => !/[\x00\ud800-\udfff]/u.test(value), {
    error: 'INVALID_REQUEST', abort: true,
  })
  .refine(value => new TextEncoder().encode(value).byteLength <= CLIPBOARD_TEXT_MAX_BYTES, {
    error: 'BODY_TOO_LARGE',
  });

// 元组校验调用参数数量；不接受选项、剪贴板类型或格式参数。
export const clipboardIpcRequestSchema = z.tuple([text]);

export const clipboardIpcErrorCodeSchema = z.enum([
  'FORBIDDEN',
  'INVALID_REQUEST',
  'BODY_TOO_LARGE',
  'RATE_LIMITED',
  'CLIPBOARD_WRITE_FAILED',
]);

export const clipboardIpcResponseSchema = z.discriminatedUnion('success', [
  z.strictObject({ success: z.literal(true) }),
  z.strictObject({
    success: z.literal(false),
    code: clipboardIpcErrorCodeSchema,
  }),
]);

export type ClipboardIpcResponse = z.infer<typeof clipboardIpcResponseSchema>;
export type ClipboardIpcErrorCode = z.infer<typeof clipboardIpcErrorCodeSchema>;
export type ClipboardBridge = {
  readonly writeText: (text: string) => Promise<ClipboardIpcResponse>;
};
