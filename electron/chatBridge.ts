import {
  chatCancelRequestSchema, chatCancelResponseSchema, chatChannels, chatChunkSchema,
  chatStartRequestSchema, chatStartResponseSchema,
  type ChatBridge, type ChatCancelResponse, type ChatChunk, type ChatStartResponse,
} from '../src/lib/chatIpcContract';

type Invoke = (channel: string, body: unknown) => Promise<unknown>;
type Subscribe = (channel: string, listener: (payload: unknown) => void) => () => void;

/** 与既有配置/剪贴板桥接一致：非法请求不上送，通信异常明确报结果未知。 */
export function createChatBridge(invoke: Invoke, subscribe: Subscribe): ChatBridge {
  return Object.freeze({
    start: async (...args: unknown[]): Promise<ChatStartResponse> => {
      if (args.length !== 1 || !chatStartRequestSchema.safeParse(args[0]).success) {
        return { success: false, code: 'INVALID_REQUEST' };
      }
      try {
        return chatStartResponseSchema.parse(await invoke(chatChannels.start, args[0]));
      } catch {
        throw new Error('对话通信失败，操作结果未知；请重新发送，勿自动重试。');
      }
    },
    cancel: async (...args: unknown[]): Promise<ChatCancelResponse> => {
      if (args.length !== 1 || !chatCancelRequestSchema.safeParse(args[0]).success) {
        return { success: false, code: 'INVALID_REQUEST' };
      }
      try {
        const response = chatCancelResponseSchema.safeParse(
          await invoke(chatChannels.cancel, args[0]),
        );
        return response.success ? response.data : { success: false, code: 'IO_FAILED' };
      } catch {
        return { success: false, code: 'IO_FAILED' };
      }
    },
    onChunk: (listener: (chunk: ChatChunk) => void): (() => void) => {
      if (typeof listener !== 'function') return () => {};
      return subscribe(chatChannels.chunk, payload => {
        const parsed = chatChunkSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      });
    },
  });
}
