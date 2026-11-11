import fs, { type BigIntStats } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TestResources {
  readonly root: string;
  readonly home: string;
  readonly userData: string;
  readonly sessionData: string;
  readonly logs: string;
  readonly crashDumps: string;
  readonly registry: Readonly<{ hive: 'HKEY_CURRENT_USER'; subKey: string }>;
  readonly cleanup: () => void;
}

const ROOT_CHANGED = '测试资源根目录已改变，拒绝清理';

function bindCleanup(root: string): () => void {
  const initial = fs.lstatSync(root, { bigint: true });
  if (!initial.isDirectory() || initial.isSymbolicLink() || fs.realpathSync(root) !== root) {
    throw new Error(ROOT_CHANGED);
  }
  let cleaned = false;
  return function cleanup(): void {
    if (arguments.length !== 0) throw new TypeError('清理操作不接受路径覆盖');
    if (cleaned) return;
    let current: BigIntStats;
    try {
      current = fs.lstatSync(root, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error;
      cleaned = true;
      return;
    }
    if (!current.isDirectory() || current.isSymbolicLink()
        || current.dev !== initial.dev || current.ino !== initial.ino
        || fs.realpathSync(root) !== root) {
      throw new Error(ROOT_CHANGED);
    }
    fs.rmSync(root, { recursive: true });
    cleaned = true;
  };
}

export function createTestResources(): TestResources {
  if (arguments.length !== 0) throw new TypeError('测试资源不接受路径覆盖');
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'ccms-desktop-test-'));
  const cleanup = bindCleanup(root);
  try {
    if (process.platform !== 'win32') fs.chmodSync(root, 0o700);
    const paths = {
      home: join(root, 'home'),
      userData: join(root, 'userData'),
      sessionData: join(root, 'sessionData'),
      logs: join(root, 'logs'),
      crashDumps: join(root, 'crashDumps'),
    };
    for (const path of Object.values(paths)) {
      fs.mkdirSync(path, { mode: 0o700 });
      if (process.platform !== 'win32') fs.chmodSync(path, 0o700);
    }
    return Object.freeze({
      root,
      ...paths,
      registry: Object.freeze({
        hive: 'HKEY_CURRENT_USER' as const,
        subKey: 'Software\\cc-model-switch\\Tests\\' + randomUUID(),
      }),
      cleanup,
    });
  } catch (error) {
    try {
      cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], '测试资源创建失败，且清理失败');
    }
    throw error;
  }
}
