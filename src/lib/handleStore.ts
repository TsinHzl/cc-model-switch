/* FileSystemFileHandle 的 IndexedDB 持久化（原生 API，零依赖） */
import type { FileSystemFileHandleLike } from './fsaTypes';

const DB_NAME = 'cc-model-switch';
const STORE = 'file-handles';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    });
  } finally {
    db.close();
  }
}

export async function saveHandle(key: string, handle: FileSystemFileHandleLike): Promise<void> {
  await withStore('readwrite', (s) => s.put(handle, key));
}

export async function loadHandle(key: string): Promise<FileSystemFileHandleLike | undefined> {
  return withStore('readwrite', (s) => s.get(key) as IDBRequest<FileSystemFileHandleLike | undefined>);
}

export async function clearHandles(): Promise<void> {
  await withStore('readwrite', (s) => s.clear());
}
