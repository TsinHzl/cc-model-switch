import { types } from 'node:util';
import type { IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import {
  configIpcErrorCodeSchema, configIpcRequestSchemas, configIpcResponseSchemas,
  type ConfigIpcMethod, type ConfigIpcResponse,
} from '../src/lib/configIpcContract';
import { FileStoreError } from '../server/errors.js';
import type { createService } from '../server/service';
import { isTrusted, type GetTrustedWindow } from './ipcSource';

interface HandlerOptions {
  service: ReturnType<typeof createService>;
  getTrustedWindow: GetTrustedWindow;
}

type ConfigHandlers = {
  readonly [M in ConfigIpcMethod]: (
    event: IpcMainInvokeEvent, ...args: unknown[]
  ) => Promise<ConfigIpcResponse<M>>;
};

// 沿用 HTTP 请求上限；计量紧凑 JSON，不代表 Electron 传输或克隆开销。
const MAX_REQUEST_BYTES = 64 * 1024;

function consume(budget: { remaining: number }, bytes: number): void {
  budget.remaining -= bytes;
  if (budget.remaining < 0) throw new FileStoreError('BODY_TOO_LARGE');
}

function readRequest(
  value: unknown, fields: readonly string[], budget: { remaining: number },
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || types.isProxy(value)) {
    throw new FileStoreError('INVALID_REQUEST');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) {
    throw new FileStoreError('INVALID_REQUEST');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length
      || keys.some(key => typeof key !== 'string' || !fields.includes(key))) {
    throw new FileStoreError('INVALID_REQUEST');
  }
  consume(budget, 2 + Math.max(0, keys.length - 1));
  return Object.fromEntries(fields.map(key => {
    consume(budget, Buffer.byteLength(JSON.stringify(key), 'utf8') + 1);
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property)) throw new FileStoreError('INVALID_REQUEST');
    const input: unknown = property.value;
    const nested = key === 'expected'
      ? Object.keys(configIpcRequestSchemas.apply.shape.expected.shape)
      : key === 'entry' ? Object.keys(configIpcRequestSchemas.add.shape.entry.shape) : null;
    if (nested) return [key, readRequest(input, nested, budget)];
    if (key === 'index'
      ? typeof input !== 'number' || !Number.isFinite(input)
      : typeof input !== 'string') {
      throw new FileStoreError('INVALID_REQUEST');
    }
    if (typeof input === 'string' && input.length > budget.remaining) {
      throw new FileStoreError('BODY_TOO_LARGE');
    }
    consume(budget, Buffer.byteLength(JSON.stringify(input), 'utf8'));
    return [key, input];
  }));
}

function failure(error: unknown) {
  const fallback = { success: false as const, code: 'IO_FAILED' as const, cleanupFailed: false };
  try {
    if (!(error instanceof FileStoreError)) return fallback;
    const code = configIpcErrorCodeSchema.safeParse(error.code);
    return {
      ...fallback,
      code: code.success ? code.data : 'IO_FAILED' as const,
      cleanupFailed: error.cleanupFailed === true,
    };
  } catch {
    return fallback;
  }
}

function createHandler<Q extends z.ZodObject, R extends z.ZodType>(
  getTrustedWindow: HandlerOptions['getTrustedWindow'],
  requestSchema: Q, responseSchema: R,
  action: (body: z.output<Q>) => Promise<z.input<R>>,
  admission: { busy: boolean },
) {
  return async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<z.output<R>> => {
    let acquired = false;
    try {
      if (!isTrusted(event, getTrustedWindow)) throw new FileStoreError('FORBIDDEN');
      if (args.length !== 1) throw new FileStoreError('INVALID_REQUEST');
      if (admission.busy) throw new FileStoreError('RATE_LIMITED');
      admission.busy = true;
      acquired = true;
      const body = readRequest(args[0], Object.keys(requestSchema.shape), {
        remaining: MAX_REQUEST_BYTES,
      });
      const request = requestSchema.safeParse(body);
      if (!request.success) throw new FileStoreError('INVALID_REQUEST');
      return responseSchema.parse(await action(request.data));
    } catch (error) {
      return responseSchema.parse(failure(error));
    } finally {
      if (acquired) admission.busy = false;
    }
  };
}

export function createConfigHandlers({
  service, getTrustedWindow,
}: HandlerOptions): ConfigHandlers {
  const admission = { busy: false };
  const bind = <Q extends z.ZodObject, R extends z.ZodType>(
    request: Q, response: R, action: (body: z.output<Q>) => Promise<z.input<R>>,
  ) => createHandler(getTrustedWindow, request, response, action, admission);
  return Object.freeze({
    state: bind(configIpcRequestSchemas.state, configIpcResponseSchemas.state, async () => ({
      success: true as const, data: await service.state(),
    })),
    apply: bind(configIpcRequestSchemas.apply, configIpcResponseSchemas.apply, async body => {
      await service.apply(body);
      return { success: true as const };
    }),
    add: bind(configIpcRequestSchemas.add, configIpcResponseSchemas.add, async ({ entry }) => {
      await service.change('POST', undefined, { entry });
      return { success: true as const };
    }),
    edit: bind(configIpcRequestSchemas.edit, configIpcResponseSchemas.edit, async body => {
      const { index, expected, entry } = body;
      await service.change('PATCH', index, { expected, entry });
      return { success: true as const };
    }),
    remove: bind(configIpcRequestSchemas.remove, configIpcResponseSchemas.remove, async body => {
      const { index, expected } = body;
      await service.change('DELETE', index, { expected });
      return { success: true as const };
    }),
  });
}
