/* writeFileAtomic / readFileText 重试路径单测：mock 授权句柄注入 InvalidStateError */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// writeFileAtomic 依赖链：getAuthorizedHandle → loadHandle（IndexedDB），此处 mock 掉存储层
vi.mock('../handleStore', () => ({
  loadHandle: vi.fn(),
  saveHandle: vi.fn(),
}));

const invalidState = (): DOMException =>
  new DOMException('state cached in an interface object had changed', 'InvalidStateError');

/** 构造 mock 句柄：reads[0] 为初始磁盘内容（后续由 close 落盘模拟驱动），failXxx 按调用序注入 InvalidStateError */
function makeHandle(opts: {
  reads: string[];
  failCreateWritable?: (n: number) => boolean;
  failRead?: (n: number) => boolean;
  /** close 在完成落盘后仍抛 InvalidStateError（模拟 swap-file rename 已完成但 close reject） */
  failClose?: (n: number) => boolean;
}) {
  let readCount = 0;
  let writeCount = 0;
  let closeCount = 0;
  let disk = opts.reads[0] ?? '';
  const written: string[] = [];
  const handle = {
    kind: 'file' as const,
    name: 'change-ai-config.json',
    getFile: vi.fn(async () => {
      const n = readCount++;
      if (opts.failRead?.(n)) throw invalidState();
      return new File([disk], 'change-ai-config.json');
    }),
    createWritable: vi.fn(async () => {
      const n = writeCount++;
      if (opts.failCreateWritable?.(n)) throw invalidState();
      return {
        write: vi.fn(async (data: string) => {
          written.push(data);
        }),
        close: vi.fn(async () => {
          const n = closeCount++;
          disk = written[written.length - 1] ?? disk; // 模拟落盘：磁盘内容变为最后写入值
          if (opts.failClose?.(n)) throw invalidState();
        }),
        abort: vi.fn(async () => {}),
      };
    }),
    queryPermission: vi.fn(async () => 'granted' as PermissionState),
    requestPermission: vi.fn(async () => 'granted' as PermissionState),
  };
  return { handle, written };
}

const { writeFileAtomic, readFileText } = await import('../fileAccess');
const { loadHandle } = await import('../handleStore');

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('writeFileAtomic InvalidStateError 重试', () => {
  it('首次 createWritable 抛 InvalidStateError → 重试成功返回写入内容', async () => {
    const { handle, written } = makeHandle({ reads: ['old'], failCreateWritable: (n) => n === 0 });
    vi.mocked(loadHandle).mockResolvedValue(handle as never);
    const out = await writeFileAtomic('config', (latest) => `next(${latest})`);
    expect(out).toBe('next(old)');
    expect(written).toEqual(['next(old)']);
    expect(handle.createWritable).toHaveBeenCalledTimes(2);
  });

  it('重试再抛 InvalidStateError → 中文包装错误且带 cause', async () => {
    const { handle } = makeHandle({ reads: ['old'], failCreateWritable: () => true });
    vi.mocked(loadHandle).mockResolvedValue(handle as never);
    // 非幂等 transform：磁盘恒为 old，收敛检测不通过（恒等 transform 会因磁盘已在目标状态而直接成功）
    const err = (await writeFileAtomic('config', (s) => `next(${s})`).catch((e) => e)) as Error;
    expect(err.message).toContain('文件正被其他程序或另一标签页修改');
    expect((err as Error & { cause?: unknown }).cause).toBeInstanceOf(DOMException);
    expect(handle.createWritable).toHaveBeenCalledTimes(2);
  });

  it('重试阶段非 InvalidStateError 失败 → 原样抛出该错误，不套「正被修改」文案', async () => {
    const { handle } = makeHandle({ reads: ['old'] });
    let calls = 0;
    handle.createWritable.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw invalidState();
      throw new Error('disk full');
    });
    vi.mocked(loadHandle).mockResolvedValue(handle as never);
    const err = (await writeFileAtomic('config', (s) => s).catch((e) => e)) as Error;
    expect(err.message).toBe('disk full');
    expect(handle.createWritable).toHaveBeenCalledTimes(2);
  });

  it('非 InvalidStateError → 不重试直接抛原错误', async () => {
    const { handle } = makeHandle({ reads: ['old'] });
    handle.createWritable.mockRejectedValueOnce(new Error('disk full'));
    vi.mocked(loadHandle).mockResolvedValue(handle as never);
    const err = (await writeFileAtomic('config', (s) => s).catch((e) => e)) as Error;
    expect(err.message).toBe('disk full');
    expect(handle.createWritable).toHaveBeenCalledTimes(1);
  });

  it('close 已落盘后回读抛 InvalidStateError → 延迟重读成功，正常返回（不再误报「可能已成功」）', async () => {
    // failRead 序列：第 0 次（写前读）成功，第 1 次（写后回读）抛 InvalidStateError，第 2 次（延迟重读）成功
    const { handle, written } = makeHandle({ reads: ['old'], failRead: (n) => n === 1 });
    vi.mocked(loadHandle).mockResolvedValue(handle as never);
    const out = await writeFileAtomic('config', (latest) => `next(${latest})`);
    expect(out).toBe('next(old)');
    expect(written).toEqual(['next(old)']);
    expect(handle.createWritable).toHaveBeenCalledTimes(1);
    expect(handle.getFile).toHaveBeenCalledTimes(3);
  });

  it('close 落盘后抛 InvalidStateError + 重试再抛 + 磁盘已收敛 → 以磁盘内容判定成功返回', async () => {
    // 首次 close：落盘成功但抛错（swap-file rename 已完成）→ 重试 createWritable 再抛 → 收敛检测
    // disk 此时已是 'target|old'，幂等 transform 再应用无变化，判定已处于目标状态
    const idempotent = (s: string) => (s.startsWith('target') ? s : `target|${s}`);
    const { handle, written } = makeHandle({
      reads: ['old'],
      failClose: (n) => n === 0,
      failCreateWritable: (n) => n === 1, // 仅拦截重试（首次需走到 close 落盘）
    });
    vi.mocked(loadHandle).mockResolvedValue(handle as never);
    const out = await writeFileAtomic('config', idempotent);
    expect(out).toBe('target|old');
    expect(written).toEqual(['target|old']); // 实际写入只发生一次，transform 未被二次应用
  });

  it('收敛检测读取本身受扰 → 仍按失败报「正被其他程序修改」', async () => {
    // 首次 createWritable 抛 → 重试的写前读即抛 → 收敛检测的重读（含延迟重试）也全抛 → 不误判成功
    const { handle } = makeHandle({
      reads: ['old'],
      failCreateWritable: (n) => n === 0,
      failRead: (n) => n >= 1,
    });
    vi.mocked(loadHandle).mockResolvedValue(handle as never);
    const err = (await writeFileAtomic('config', (s) => s).catch((e) => e)) as Error;
    expect(err.message).toContain('正被其他程序或另一标签页修改');
    expect((err as Error & { cause?: unknown }).cause).toBeInstanceOf(DOMException);
  });
});

describe('readFileText InvalidStateError 重试', () => {
  it('首次 getFile 抛 InvalidStateError → 延迟重读成功返回内容', async () => {
    // failRead 第 0 次抛错，第 1 次（重试）成功
    const { handle } = makeHandle({ reads: ['disk-content'], failRead: (n) => n === 0 });
    vi.mocked(loadHandle).mockResolvedValue(handle as never);
    const out = await readFileText('config');
    expect(out).toBe('disk-content');
    expect(handle.getFile).toHaveBeenCalledTimes(2);
  });

  it('两次 getFile 都抛 InvalidStateError → 中文包装错误且带 cause', async () => {
    const { handle } = makeHandle({ reads: ['x'], failRead: () => true });
    vi.mocked(loadHandle).mockResolvedValue(handle as never);
    const err = (await readFileText('config').catch((e) => e)) as Error;
    expect(err.message).toContain('读取 config 失败');
    expect((err as Error & { cause?: unknown }).cause).toBeInstanceOf(DOMException);
    expect(handle.getFile).toHaveBeenCalledTimes(2);
  });
});
