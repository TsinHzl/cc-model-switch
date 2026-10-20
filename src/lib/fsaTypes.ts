/* File System Access API 类型声明（TS 内置 lib.dom 未完整覆盖） */

export interface PermissionHandle {
  queryPermission(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

export interface WritableFileStream {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

export interface FileSystemWritableFileStreamLike {
  createWritable(options?: { keepExistingData?: boolean }): Promise<WritableFileStream>;
}

export interface FileSystemFileHandleLike extends PermissionHandle, FileSystemWritableFileStreamLike {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}

interface ShowOpenFilePickerWindow {
  showOpenFilePicker?(options?: {
    multiple?: boolean;
    types?: { description?: string; accept: Record<string, string[]> }[];
    excludeAcceptAllOption?: boolean;
  }): Promise<FileSystemFileHandleLike[]>;
}

/** secure context + API 存在性双重能力检测 */
export function detectEnvironment(): {
  ok: boolean;
  reason?: 'insecure' | 'unsupported';
} {
  if (typeof window === 'undefined') return { ok: false, reason: 'unsupported' };
  if (!(window as unknown as { isSecureContext?: boolean }).isSecureContext) {
    return { ok: false, reason: 'insecure' };
  }
  if (typeof (window as unknown as ShowOpenFilePickerWindow).showOpenFilePicker !== 'function') {
    return { ok: false, reason: 'unsupported' };
  }
  return { ok: true };
}
