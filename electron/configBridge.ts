import type { z } from 'zod';
import {
  configIpcChannels, configIpcRequestSchemas, configIpcResponseSchemas,
  type ConfigBridge, type ConfigIpcChannel,
} from '../src/lib/configIpcContract';

type Invoke = (channel: ConfigIpcChannel, body: unknown) => Promise<unknown>;

function createMethod<Q extends z.ZodType, R extends z.ZodType>(
  invoke: Invoke, channel: ConfigIpcChannel, requestSchema: Q, responseSchema: R,
) {
  return async (...args: unknown[]): Promise<z.output<R>> => {
    let body: z.output<Q>;
    try {
      if (args.length !== 1) throw new Error();
      body = requestSchema.parse(args[0]);
    } catch {
      return responseSchema.parse({
        success: false, code: 'INVALID_REQUEST', cleanupFailed: false,
      });
    }
    try {
      return responseSchema.parse(await invoke(channel, body));
    } catch {
      throw new Error('配置通信失败，操作结果未知；请重新读取核对，勿自动重试。');
    }
  };
}

export function createConfigBridge(invoke: Invoke): ConfigBridge {
  const bind = <Q extends z.ZodType, R extends z.ZodType>(
    channel: ConfigIpcChannel, request: Q, response: R,
  ) => createMethod(invoke, channel, request, response);
  return Object.freeze({
    state: bind(configIpcChannels.state, configIpcRequestSchemas.state, configIpcResponseSchemas.state),
    apply: bind(configIpcChannels.apply, configIpcRequestSchemas.apply, configIpcResponseSchemas.apply),
    add: bind(configIpcChannels.add, configIpcRequestSchemas.add, configIpcResponseSchemas.add),
    edit: bind(configIpcChannels.edit, configIpcRequestSchemas.edit, configIpcResponseSchemas.edit),
    remove: bind(configIpcChannels.remove, configIpcRequestSchemas.remove, configIpcResponseSchemas.remove),
  });
}
