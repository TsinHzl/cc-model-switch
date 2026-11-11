import type { z } from 'zod';
import type { ConfigEntry } from './applyConfig';
import type { ConfigState } from './configContract';
import {
  configIpcResponseSchemas, type ConfigBridge, type ConfigIpcErrorCode, type ConfigIpcResponse,
} from './configIpcContract';

const messages = Object.freeze({
  ROOT_FORBIDDEN: '禁止以 root 身份运行。',
  INVALID_HOME: '本机用户目录参数无效。',
  UNKNOWN_KEY: '不支持该配置文件。',
  READ_ONLY: '该配置文件只允许读取。',
  UNSUPPORTED_PLATFORM: '当前平台不支持此配置操作。',
  UNSAFE_PATH: '文件或父目录类型不受支持，不能使用符号链接。',
  UNSUPPORTED_FILE: '文件链接数、权限或所有权不支持安全替换。',
  METADATA_UNSUPPORTED: '文件包含无法可靠保留的特殊元数据。',
  METADATA_CHECK_FAILED: '无法确认文件元数据，已拒绝写入。',
  FILE_MISSING: '必需的配置文件不存在。',
  TOO_LARGE: '配置文件超过大小限制。',
  INVALID_UTF8: '配置文件必须使用无损 UTF-8 文本。',
  CONFLICT: '配置文件已被其他操作修改，请重新读取。',
  INVALID_CONFIG: '配置列表格式或写入值无效。',
  INVALID_REQUEST: '请求格式或字段无效。',
  FORBIDDEN: '请求来源未获授权。',
  BODY_TOO_LARGE: '请求正文超过大小限制。',
  RATE_LIMITED: '当前有配置操作正在进行，请稍后重试。',
  TRANSFORM_FAILED: '配置变更计算失败。',
  IO_FAILED: '本地文件操作失败。',
  WRITE_UNCERTAIN: '配置可能已写入，请重新读取核对；不要直接重复写入。',
} satisfies Record<ConfigIpcErrorCode, string>);

type Failure = Extract<ConfigIpcResponse<'state'>, { success: false }>;

export type ApiConfigState = ConfigState;

export class ApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T extends { success: true }>(
  action: (bridge: ConfigBridge) => Promise<unknown>,
  schema: z.ZodType<T | Failure>,
): Promise<T> {
  const bridge = typeof window === 'undefined' ? undefined : window.desktop?.config;
  if (!bridge) {
    throw new ApiError('DESKTOP_UNAVAILABLE', '桌面配置桥接不可用，请使用桌面应用打开。');
  }
  let response: T | Failure;
  try {
    response = schema.parse(await action(bridge));
  } catch {
    throw new ApiError('IPC_ERROR', '配置通信失败，操作结果未知；请重新读取核对，勿自动重试。');
  }
  if (!response.success) {
    throw new ApiError(response.code, messages[response.code]
      + (response.cleanupFailed ? ' 文件资源清理失败，需人工检查。' : ''));
  }
  return response;
}

export async function getConfigState(): Promise<ApiConfigState> {
  return (await request(bridge => bridge.state({}), configIpcResponseSchemas.state)).data;
}

async function write(action: (bridge: ConfigBridge) => Promise<unknown>): Promise<void> {
  await request(action, configIpcResponseSchemas.apply);
}

const identity = ({ model, base_url, key }: ConfigEntry) => ({ model, base_url, key });
const entryData = (entry: ConfigEntry) => ({ ...identity(entry), channel: entry.channel });

export const applyModelConfig = (entry: ConfigEntry) =>
  write(bridge => bridge.apply({ expected: identity(entry) }));

export const addEntry = (entry: ConfigEntry) =>
  write(bridge => bridge.add({ entry: entryData(entry) }));

export const updateEntry = (index: number, expected: ConfigEntry, entry: ConfigEntry) =>
  write(bridge => bridge.edit({ index, expected: identity(expected), entry: entryData(entry) }));

export const deleteEntry = (index: number, expected: ConfigEntry) =>
  write(bridge => bridge.remove({ index, expected: identity(expected) }));
