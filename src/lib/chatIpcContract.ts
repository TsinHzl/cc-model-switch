import { z } from 'zod';

/** 对话通道的单次请求上限；配置通道的 64 KiB 预算不适用附件与历史消息。 */
export const CHAT_MAX_REQUEST_BYTES = 8 * 1024 * 1024;

export const chatChannels = Object.freeze({
  start: 'chat:start',
  cancel: 'chat:cancel',
  chunk: 'chat:chunk',
} as const);

// 控制字符与孤立代理项会让 UTF-8 编码与 SSE 分帧失真，统一拒绝。
const text = z.string().refine(value =>
  !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(value)
    && !/[\ud800-\udfff]/u.test(value));
const token = text.refine(value => value.trim().length > 0);

const httpUrl = z.string().refine(value => {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}, { error: 'INVALID_REQUEST', abort: true });

const imageMediaType = z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const contentBlockSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), text }),
  z.strictObject({
    type: z.literal('image'),
    source: z.strictObject({
      type: z.literal('base64'),
      media_type: imageMediaType,
      data: z.string().min(1).refine(value => /^[A-Za-z0-9+/=\s]*$/.test(value)),
    }),
  }),
]);

const messageSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: z.union([
    token,
    z.array(contentBlockSchema).min(1),
  ]),
});

const effortSchema = z.enum(['off', 'low', 'medium', 'high', 'xhigh', 'max']);

const startShape = {
  model: token,
  base_url: httpUrl,
  messages: z.array(messageSchema).min(1),
  effort: effortSchema,
  webSearch: z.boolean(),
};

/** 严格对象 + 紧凑 JSON 等价字节预算；不包含 IPC 克隆前开销。 */
const encoder = new TextEncoder();
export const chatStartRequestSchema = z.strictObject(startShape).refine(
  value => encoder.encode(JSON.stringify(value)).byteLength <= CHAT_MAX_REQUEST_BYTES,
  { error: 'BODY_TOO_LARGE', path: [] },
);

export const chatCancelRequestSchema = z.strictObject({ id: token });

export const chatErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'BODY_TOO_LARGE',
  'FORBIDDEN',
  'RATE_LIMITED',
  'UNKNOWN_ENTRY',
  'UNSUPPORTED_URL',
  'UPSTREAM_ERROR',
  'NETWORK_ERROR',
  'TLS_ERROR',
  'REDIRECT_BLOCKED',
  'ABORTED',
  'IO_FAILED',
]);

export const chatStartResponseSchema = z.discriminatedUnion('success', [
  z.strictObject({ success: z.literal(true), id: token }),
  z.strictObject({ success: z.literal(false), code: chatErrorCodeSchema }),
]);

export const chatCancelResponseSchema = z.discriminatedUnion('success', [
  z.strictObject({ success: z.literal(true) }),
  z.strictObject({ success: z.literal(false), code: chatErrorCodeSchema }),
]);

const searchResultSchema = z.strictObject({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});

export const chatChunkSchema = z.discriminatedUnion('kind', [
  z.strictObject({ id: token, kind: z.literal('thinking'), delta: z.string() }),
  z.strictObject({ id: token, kind: z.literal('text'), delta: z.string() }),
  z.strictObject({
    id: token, kind: z.literal('usage'),
    input: z.number().int().nonnegative().optional(),
    output: z.number().int().nonnegative().optional(),
    cached: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    id: token, kind: z.literal('search_call'), searchId: token, query: z.string(),
  }),
  z.strictObject({
    id: token, kind: z.literal('search_result'), searchId: token,
    results: z.array(searchResultSchema), failed: z.boolean(),
  }),
  z.strictObject({ id: token, kind: z.literal('done') }),
  z.strictObject({
    id: token, kind: z.literal('error'), code: chatErrorCodeSchema, message: z.string(),
  }),
]);

export type ChatEffort = z.infer<typeof effortSchema>;
export type ChatContentBlock = z.infer<typeof contentBlockSchema>;
export type ChatMessageInput = z.infer<typeof messageSchema>;
export type ChatStartRequest = z.infer<typeof chatStartRequestSchema>;
export type ChatCancelRequest = z.infer<typeof chatCancelRequestSchema>;
export type ChatErrorCode = z.infer<typeof chatErrorCodeSchema>;
export type ChatCancelResponse = z.infer<typeof chatCancelResponseSchema>;
export type ChatChunk = z.infer<typeof chatChunkSchema>;
export type ChatStartResponse = z.infer<typeof chatStartResponseSchema>;

export type ChatBridge = {
  readonly start: (request: ChatStartRequest) => Promise<ChatStartResponse>;
  readonly cancel: (request: ChatCancelRequest) => Promise<ChatCancelResponse>;
  /** 注册流式事件回调；返回退订函数。 */
  readonly onChunk: (listener: (chunk: ChatChunk) => void) => () => void;
};
