/* writeFileAtomic 重试路径单测：mock 授权句柄注入 InvalidStateError */
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
}) {
  let readCount = 0;
  let writeCount = 0;
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
          disk = written[written.length - 1] ?? disk; // 模拟落盘：磁盘内容变为最后写入值
        }),
        abort: vi.fn(async () => {}),
      };
    }),
    queryPermission: vi.fn(async () => 'granted' as PermissionState),
    requestPermission: vi.fn(async () => 'granted' as PermissionState),
  };
  return { handle, written };
}

const { writeFileAtomic } = await import('../fileAccess');
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
    const err = (await writeFileAtomic('config', (s) => s).catch((e) => e)) as Error;
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

  it('close 已落盘后回读抛 InvalidStateError → 不重试（防 transform 二次应用）', async () => {
    // failRead 序列：第 0 次（写前读）成功，第 1 次（写后回读）抛 InvalidStateError
    const { handle, written } = makeHandle({ reads: ['old'], failRead: (n) => n === 1 });
    vi.mocked(loadHandle).mockResolvedValue(handle as never);
    const err = (await writeFileAtomic('config', (latest) => `next(${latest})`).catch((e) => e)) as Error;
    // 写入只发生一次，transform 未被二次应用；已落盘错误包装为「可能已成功」文案（不裸抛、不引导重试）
    expect(written).toEqual(['next(old)']);
    expect(handle.createWritable).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('可能已成功');
    expect(err.message).not.toContain('正被其他程序');
  });

  it('重试写入已落盘后回读抛 InvalidStateError → 提示「可能已成功」而非引导重试', async () => {
    // 第 0 次 createWritable 抛错触发重试；第 2 次 getFile（重试的写后回读）抛 InvalidStateError
    const { handle, written } = makeHandle({ reads: ['old'], failCreateWritable: (n) => n === 0, failRead: (n) => n === 2 });
    vi.mocked(loadHandle).mockResolvedValue(handle as never);
    const err = (await writeFileAtomic('config', (latest) => `next(${latest})`).catch((e) => e)) as Error;
    expect(err.message).toContain('可能已成功');
    expect(err.message).not.toContain('正被其他程序');
    expect(written).toEqual(['next(old)']);
    expect(handle.createWritable).toHaveBeenCalledTimes(2);
  });
});
