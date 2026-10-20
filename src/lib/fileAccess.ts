/* 三目标文件（配置/设置/zshrc）的授权、权限检测与原子读写封装 */
import type { FileSystemFileHandleLike } from './fsaTypes';
import { saveHandle, loadHandle } from './handleStore';

export type FileKey = 'config' | 'settings' | 'zshrc';

export interface FileMeta {
  key: FileKey;
  /** 展示给用户的路径提示（FSA 选择器不回传绝对路径） */
  pathHint: string;
  fileName: string;
}

export const FILE_METAS: FileMeta[] = [
  { key: 'config', pathHint: '~/change-ai-config.json', fileName: 'change-ai-config.json' },
  { key: 'settings', pathHint: '~/.claude/settings.json', fileName: 'settings.json' },
  { key: 'zshrc', pathHint: '~/.zshrc', fileName: '.zshrc' },
];

export class PermissionDeniedError extends Error {
  constructor(public fileKey: FileKey) {
    super(`文件 ${fileKey} 授权被拒绝`);
    this.name = 'PermissionDeniedError';
  }
}

export class FileMismatchError extends Error {
  constructor(public fileKey: FileKey, public expected: string, public actual: string) {
    super(`选择的文件名不符：期望 ${expected}，实际 ${actual}`);
    this.name = 'FileMismatchError';
  }
}

async function pickFile(meta: FileMeta): Promise<FileSystemFileHandleLike> {
  const handles = await (
    window as unknown as {
      showOpenFilePicker(opts: {
        multiple?: boolean;
        types: { description?: string; accept: Record<string, string[]> }[];
      }): Promise<FileSystemFileHandleLike[]>;
    }
  ).showOpenFilePicker({
    multiple: false,
    types: [
      {
        description: meta.fileName,
        accept: meta.key === 'zshrc' ? { 'text/plain': ['.zshrc', '.zprofile', '.sh'] } : { 'application/json': ['.json'] },
      },
    ],
  });
  const handle = handles[0]!;
  if (handle.name !== meta.fileName) {
    throw new FileMismatchError(meta.key, meta.fileName, handle.name);
  }
  return handle;
}

/** 引导用户依次授权指定文件；授权后以 readwrite 请求写权限并持久化句柄 */
export async function authorizeFile(meta: FileMeta): Promise<FileSystemFileHandleLike> {
  const handle = await pickFile(meta);
  const perm = await handle.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') throw new PermissionDeniedError(meta.key);
  await saveHandle(meta.key, handle);
  return handle;
}

/** 恢复已持久化句柄；权限回落时抛 PermissionDeniedError 由 UI 引导一键重授权 */
export async function getAuthorizedHandle(
  key: FileKey,
): Promise<FileSystemFileHandleLike> {
  const handle = await loadHandle(key);
  if (!handle) throw new PermissionDeniedError(key);
  const perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') throw new PermissionDeniedError(key);
  return handle;
}

/** 一键重授权（保留原句柄，仅刷新权限；句柄丢失时重新走选择器） */
export async function reauthorize(key: FileKey): Promise<FileSystemFileHandleLike> {
  const meta = FILE_METAS.find((m) => m.key === key)!;
  const existing = await loadHandle(key);
  if (existing) {
    const perm = await existing.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') return existing;
    throw new PermissionDeniedError(key);
  }
  return authorizeFile(meta);
}

/** 是否已完成全部 3 个文件的首次授权（不含权限是否仍有效） */
export async function isFullyAuthorized(): Promise<boolean> {
  for (const meta of FILE_METAS) {
    if (!(await loadHandle(meta.key))) return false;
  }
  return true;
}

/** 读取文件全文（每次调用都从磁盘取最新内容） */
export async function readFileText(key: FileKey): Promise<string> {
  const handle = await getAuthorizedHandle(key);
  const file = await handle.getFile();
  return file.text();
}

/** 原子写入：写前先从磁盘重读最新内容交由 transform 增量修改，close() 才落盘 */
export async function writeFileAtomic(
  key: FileKey,
  transform: (latest: string) => string,
): Promise<string> {
  const handle = await getAuthorizedHandle(key);
  // 防 stale write：基于磁盘最新内容，而非页面内存副本
  const latest = await (await handle.getFile()).text();
  const next = transform(latest);
  const writable = await handle.createWritable({ keepExistingData: false });
  try {
    await writable.write(next);
    await writable.close();
  } catch (err) {
    try {
      await writable.abort(undefined);
    } catch {
      /* abort 失败不掩盖原始错误 */
    }
    throw err;
  }
  // 写后回读验证
  const written = await (await handle.getFile()).text();
  if (written !== next) {
    throw new Error(`写后回读校验失败（${key}），文件内容与预期不一致`);
  }
  return written;
}
