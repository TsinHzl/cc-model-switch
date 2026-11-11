import { describe, expect, it } from 'vitest';

// 仅验证宿主 Node；不代表 Electron、目录包或其他平台验收。
describe.skipIf(process.platform !== 'darwin')('Koffi macOS 原生加载', () => {
  it('调用系统 getpid 并返回当前进程 PID', async () => {
    const { default: koffi } = await import('koffi');
    const library = koffi.load('/usr/lib/libSystem.B.dylib');
    try {
      const getpid = library.func('int getpid(void)');
      expect(getpid()).toBe(process.pid);
    } finally {
      library.unload();
    }
  });
});
