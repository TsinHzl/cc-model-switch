const MESSAGES = Object.freeze({
  ROOT_FORBIDDEN: '禁止以 root 身份运行。',
  INVALID_HOME: '本机用户目录参数无效。',
  UNKNOWN_KEY: '不支持该配置文件。',
  READ_ONLY: '该配置文件只允许读取。',
  UNSUPPORTED_PLATFORM: '文件写入仅支持 macOS。',
  UNSAFE_PATH: '文件或父目录类型不受支持，不能使用符号链接。',
  UNSUPPORTED_FILE: '文件链接数、权限或所有权不支持安全替换。',
  METADATA_UNSUPPORTED: '文件包含无法可靠保留的特殊元数据。',
  METADATA_CHECK_FAILED: '无法确认文件元数据，已拒绝写入。',
  FILE_MISSING: '必需的配置文件不存在。',
  TOO_LARGE: '配置文件超过 4 MiB 大小限制。',
  INVALID_UTF8: '配置文件必须使用无损 UTF-8 文本。',
  CONFLICT: '配置文件已被其他操作修改，请重新读取。',
  INVALID_CONFIG: '配置列表格式或写入值无效。',
  INVALID_REQUEST: '请求格式或字段无效。',
  FORBIDDEN: '请求来源未获授权。',
  SESSION_EXPIRED: '本机服务会话已失效，请刷新网页后重试。',
  NOT_FOUND: '资源不存在。',
  UNSUPPORTED_MEDIA: '仅接受 application/json 请求。',
  BODY_TOO_LARGE: '请求正文超过大小限制。',
  REQUEST_TIMEOUT: '请求正文读取超时。',
  RATE_LIMITED: '请求过于频繁，请稍后重试。',
  TRANSFORM_FAILED: '配置变更计算失败。',
  IO_FAILED: '本地文件操作失败。',
  WRITE_UNCERTAIN: '配置可能已写入，请刷新确认；不要自动重试。',
});

export class FileStoreError extends Error {
  constructor(code, cleanupFailed = false) {
    const known = Object.hasOwn(MESSAGES, code) ? code : 'IO_FAILED';
    super(MESSAGES[known] + (cleanupFailed ? ' 文件资源清理失败，需人工检查。' : ''));
    this.name = 'FileStoreError';
    this.code = known;
    this.cleanupFailed = cleanupFailed;
  }
}

export function safeFileError(error) {
  if (error instanceof FileStoreError) return error;
  return new FileStoreError(error?.code === 'ENOENT' ? 'FILE_MISSING' : 'IO_FAILED');
}

export async function safeIO(action) {
  try {
    return await action();
  } catch (error) {
    throw safeFileError(error);
  }
}
