import { z } from 'zod';
import type { ConfigEntry } from './applyConfig';

const entrySchema = z.object({
  model: z.string(),
  base_url: z.string(),
  key: z.string(),
  channel: z.string(),
});
const stateSchema = z.object({
  entries: z.array(entrySchema),
  groups: z.array(z.object({
    url: z.string(),
    channels: z.array(z.object({
      channel: z.string(),
      items: z.array(z.object({
        entry: entrySchema,
        index: z.number().int().nonnegative().safe(),
      })),
    })),
  })),
  activeIndex: z.number().int().min(-1).safe(),
}).refine(state =>
  state.activeIndex < state.entries.length
  && state.groups.every(group => group.channels.every(channel =>
    channel.items.every(item => item.index < state.entries.length))));
const stateResponse = z.object({ success: z.literal(true), data: stateSchema });
const bootstrapResponse = z.object({
  success: z.literal(true),
  data: z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }),
});
const errorResponse = z.object({
  success: z.literal(false),
  code: z.string().min(1),
  error: z.string().min(1),
});

export type ApiConfigState = z.infer<typeof stateSchema>;

export class ApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

function invalidResponse() {
  return new ApiError('INVALID_RESPONSE', '本机服务响应无效，请刷新网页确认状态。');
}

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw invalidResponse();
  return result.data;
}

async function readJSON(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw invalidResponse();
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      mode: 'same-origin',
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
    });
  } catch {
    const writing = init.method !== undefined && init.method !== 'GET';
    throw new ApiError(writing ? 'WRITE_UNCERTAIN' : 'NETWORK_ERROR', writing
      ? '请求结果无法确认，请刷新状态后检查；不要直接重复写入。'
      : '无法连接本机服务，请确认服务已启动。');
  }
  if (!response.ok) {
    const error = validate(errorResponse, await readJSON(response));
    throw new ApiError(error.code, error.error);
  }
  return response;
}

let session: Promise<string> | undefined;

function getToken(): Promise<string> {
  session ??= request('/api/bootstrap', {
    headers: { 'x-ccms-bootstrap': '1' },
  }).then(async response =>
    validate(bootstrapResponse, await readJSON(response)).data.token,
  ).catch(error => {
    session = undefined;
    throw error;
  });
  return session;
}

export async function getConfigState(): Promise<ApiConfigState> {
  const response = await request('/api/state', {
    headers: { 'x-ccms-token': await getToken() },
  });
  return validate(stateResponse, await readJSON(response)).data;
}

async function write(path: string, method: string, body: unknown): Promise<void> {
  const response = await request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-ccms-token': await getToken(),
    },
    body: JSON.stringify(body),
  });
  if (response.status !== 204) throw invalidResponse();
}

const identity = ({ model, base_url, key }: ConfigEntry) => ({ model, base_url, key });
const entryData = (entry: ConfigEntry) => ({ ...identity(entry), channel: entry.channel });

export const applyModelConfig = (entry: ConfigEntry) =>
  write('/api/apply', 'POST', { expected: identity(entry) });

export const addEntry = (entry: ConfigEntry) =>
  write('/api/entries', 'POST', { entry: entryData(entry) });

export const updateEntry = (index: number, expected: ConfigEntry, entry: ConfigEntry) =>
  write(`/api/entries/${index}`, 'PATCH', { expected: identity(expected), entry: entryData(entry) });

export const deleteEntry = (index: number, expected: ConfigEntry) =>
  write(`/api/entries/${index}`, 'DELETE', { expected: identity(expected) });
