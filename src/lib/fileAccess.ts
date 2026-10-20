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

/**
 * 原子写入：写前先从磁盘重读最新内容交由 transform 增量修改，close() 才落盘。
 * transform 必须为纯函数且幂等——写入冲突（InvalidStateError）重试时会被调用多次。
 */
export async function writeFileAtomic(
  key: FileKey,
  transform: (latest: string) => string,
): Promise<string> {
  const handle = await getAuthorizedHandle(key);
  let persisted = false;

  const attempt = async (): Promise<string> => {
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
    persisted = true;
    // 写后回读验证
    const written = await (await handle.getFile()).text();
    if (written !== next) {
      throw new Error(`写后回读校验失败（${key}），文件内容与预期不一致`);
    }
    return written;
  };

  try {
    return await attempt();
  } catch (err) {
    // InvalidStateError：getFile 后文件被外部修改（另一标签页/编辑器/同步盘），句柄快照过期
    // 重试会重新 getFile 刷新快照并基于最新内容重算 transform，安全幂等
    // persisted 后仍抛 InvalidStateError 说明写入已落盘、仅回读校验受扰——不可重试（transform 会二次应用），也不可引导用户重试
    if (err instanceof DOMException && err.name === 'InvalidStateError' && persisted) {
      throw new Error(`写入（${key}）可能已成功，但写后校验受干扰，请重新读取文件确认最新内容`);
    }
    if (!persisted && err instanceof DOMException && err.name === 'InvalidStateError') {
      try {
        return await attempt();
      } catch (retryErr) {
        // 仅重试仍因快照冲突失败时才归因为「正被其他程序修改」；其余错误原样抛出，避免误导排障
        if (retryErr instanceof DOMException && retryErr.name === 'InvalidStateError' && !persisted) {
          const wrapped = new Error(
            `写入失败（${key}）：文件正被其他程序或另一标签页修改，请关闭重复打开的本页面后重试`,
          );
          (wrapped as Error & { cause?: unknown }).cause = retryErr; // 保留原始错误链（target ES2020 无 Error cause 构造签名）
          throw wrapped;
        }
        if (retryErr instanceof DOMException && retryErr.name === 'InvalidStateError' && persisted) {
          // 重试写入已落盘、仅回读受扰：同上，不引导重试
          throw new Error(`写入（${key}）可能已成功，但写后校验受干扰，请重新读取文件确认最新内容`);
        }
        throw retryErr;
      }
    }
    throw err;
  }
}
