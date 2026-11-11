import fs from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConfigHandlers } from '../configIpc';
import { createSource } from '../testing/ipcSource';
import { createTestResources, type TestResources } from '../testing/resources';
import { createFileStore, type FileKey } from '../../server/files.js';
import { createService } from '../../server/service.js';
import { FileStoreError } from '../../server/errors.js';
import type { ConfigState } from '../../src/lib/configContract';
import type { ConfigIpcMethod } from '../../src/lib/configIpcContract';

type Service = ReturnType<typeof createService>;
type Handlers = ReturnType<typeof createConfigHandlers>;
const A = { model: 'model-a', base_url: 'https://example.invalid/a', key: 'fixture-key', channel: '' };
const B = { ...A, model: 'model-b', extra: { preserve: true } };
const identity = ({ model, base_url, key }: typeof A) => ({ model, base_url, key });
const serialize = (entries: unknown[]) => `${JSON.stringify(entries, null, 4)}\n`;
const STATE: ConfigState = {
  entries: [A],
  groups: [{ url: A.base_url, channels: [{ channel: '', items: [{ entry: A, index: 0 }] }] }],
  activeIndex: -1,
};
const requests = [
  ['state', {}],
  ['apply', { expected: identity(A) }],
  ['add', { entry: A }],
  ['edit', { index: 0, expected: identity(A), entry: A }],
  ['remove', { index: 0, expected: identity(A) }],
] as const;
const failed = (code: string, cleanupFailed = false) => ({ success: false, code, cleanupFailed });

const REQUEST_LIMIT = 64 * 1024;

function sizedRequest(
  method: Exclude<ConfigIpcMethod, 'state'>, unit = 'x', bytes = REQUEST_LIMIT,
) {
  const create = (key: string) => {
    const entry = { ...A, key };
    if (method === 'apply') return { expected: identity(entry) };
    if (method === 'add') return { entry };
    if (method === 'edit') {
      return { index: Number.MAX_SAFE_INTEGER, expected: identity(A), entry };
    }
    return { index: Number.MAX_SAFE_INTEGER, expected: identity(entry) };
  };
  const available = bytes - Buffer.byteLength(JSON.stringify(create('')), 'utf8');
  const unitBytes = Buffer.byteLength(JSON.stringify(unit), 'utf8') - 2;
  return create(unit.repeat(Math.floor(available / unitBytes)) + 'x'.repeat(available % unitBytes));
}

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function observe(service: Service) {
  return {
    state: vi.fn(service.state),
    apply: vi.fn(service.apply),
    change: vi.fn(service.change),
  };
}

function expectUnused(service: ReturnType<typeof observe>) {
  expect(service.state).not.toHaveBeenCalled();
  expect(service.apply).not.toHaveBeenCalled();
  expect(service.change).not.toHaveBeenCalled();
}

describe('配置 handler 边界', () => {
  let source: ReturnType<typeof createSource>;
  let current: ReturnType<typeof createSource>['trusted'] | null;
  let service: ReturnType<typeof observe>;
  let handlers: Handlers;

  beforeEach(() => {
    source = createSource();
    current = source.trusted;
    service = {
      state: vi.fn<Service['state']>().mockResolvedValue(STATE),
      apply: vi.fn<Service['apply']>().mockResolvedValue(undefined),
      change: vi.fn<Service['change']>().mockResolvedValue(undefined),
    };
    handlers = createConfigHandlers({ service, getTrustedWindow: () => current });
  });

  it('只提供冻结的五个处理函数，创建时不调用业务', () => {
    expect(Object.keys(handlers)).toEqual(['state', 'apply', 'add', 'edit', 'remove']);
    expect(Object.isFrozen(handlers)).toBe(true);
    expectUnused(service);
  });

  it.each(requests)('拒绝 %s 缺少、额外参数和额外正文属性', async (method, body) => {
    for (const args of [[], [body, {}], [{ ...body, home: '../outside' }], [null]]) {
      expect(await handlers[method](source.event, ...args)).toEqual(failed('INVALID_REQUEST'));
    }
    expectUnused(service);
  });

  it.each([
    ['其他窗口', (s) => { s.message.sender = { ...s.contents }; }],
    ['同源子 frame', (s) => { s.message.senderFrame = { ...s.frame }; }],
    ['已替换主 frame', (s) => { s.contents.mainFrame = { ...s.frame }; }],
    ['空 frame', (s) => { s.message.senderFrame = null; }],
    ['detached frame', (s) => { s.frame.detached = true; }],
    ['已销毁 frame', (s) => { s.frame.isDestroyed = () => true; }],
    ['已销毁窗口', (s) => { s.window.isDestroyed = () => true; }],
    ['已销毁 webContents', (s) => { s.contents.isDestroyed = () => true; }],
    ['不透明 origin', (s) => { s.frame.origin = 'null'; }],
    ['URL 正确但 origin 错误', (s) => { s.frame.origin = 'https://example.invalid'; }],
  ] satisfies Array<[string, (source: ReturnType<typeof createSource>) => void]>)(
    '拒绝 %s 的全部操作', async (_name, alter) => {
      alter(source);
      for (const [method, body] of requests) {
        expect(await handlers[method](source.event, body)).toEqual(failed('FORBIDDEN'));
      }
      expectUnused(service);
    },
  );

  it.each([
    'cc-model-switch://other/index.html',
    'other-scheme://app/index.html',
    'cc-model-switch://app:123/index.html',
    'cc-model-switch://fixture@app/index.html',
    'cc-model-switch://app/other.html',
    'cc-model-switch://app/index.html?extra=1',
    'cc-model-switch://app/index.html#extra',
    'about:blank', 'blob:cc-model-switch://app/fixture', 'not-a-url',
  ])('拒绝不匹配的页面地址 %#', async url => {
    source.frame.url = url;
    expect(await handlers.state(source.event, {})).toEqual(failed('FORBIDDEN'));
    expectUnused(service);
  });

  it('拒绝无窗口、关闭后的旧窗口和窗口属性读取失败', async () => {
    current = null;
    expect(await handlers.state(source.event, {})).toEqual(failed('FORBIDDEN'));
    const replacement = createSource();
    current = replacement.trusted;
    expect(await handlers.state(source.event, {})).toEqual(failed('FORBIDDEN'));
    expectUnused(service);
    expect(await handlers.state(replacement.event, {})).toEqual({ success: true, data: STATE });
    service.state.mockClear();
    Object.defineProperty(replacement.message, 'senderFrame', {
      get() { throw new Error('fixture-sensitive'); },
    });
    expect(await handlers.state(replacement.event, {})).toEqual(failed('FORBIDDEN'));
    expectUnused(service);
  });

  it.each(['http://127.0.0.1:5173', 'http://127.0.0.1:5173/'])(
    '接受已核准的开发根地址 %s，拒绝端口和可信目标覆盖', async target => {
      source = createSource(target);
      current = source.trusted;
      expect(await handlers.state(source.event, {})).toEqual({ success: true, data: STATE });
      service.state.mockClear();
      source.frame.url = 'http://127.0.0.1:5174/';
      expect(await handlers.state(source.event, {})).toEqual(failed('FORBIDDEN'));
      source = createSource('https://example.invalid/');
      current = source.trusted;
      expect(await handlers.state(source.event, {})).toEqual(failed('FORBIDDEN'));
      expectUnused(service);
    },
  );

  it('返回解析后的状态，剥除各级未知字段', async () => {
    const extra = { privateField: 'fixture-sensitive' };
    service.state.mockResolvedValue({
      ...STATE, ...extra, entries: [{ ...A, ...extra }],
      groups: [{
        url: A.base_url, ...extra,
        channels: [{
          channel: '', ...extra, items: [{ entry: { ...A, ...extra }, index: 0, ...extra }],
        }],
      }],
    });
    expect(await handlers.state(source.event, {})).toEqual({ success: true, data: STATE });
  });

  it('将无效状态映射为固定错误，不透传解析异常', async () => {
    service.state.mockResolvedValue({ ...STATE, activeIndex: 99 });
    expect(await handlers.state(source.event, {})).toEqual(failed('IO_FAILED'));
    expect(service.state).toHaveBeenCalledTimes(1);
    service.state.mockResolvedValue(STATE);
    expect(await handlers.state(source.event, {})).toEqual({ success: true, data: STATE });
  });

  it.each(['apply', 'add', 'edit', 'remove'] as const)(
    '%s 接受恰好 64 KiB 的请求，拒绝多一字节', async method => {
      const body = sizedRequest(method);
      const oversized = sizedRequest(method, 'x', REQUEST_LIMIT + 1);
      expect(Buffer.byteLength(JSON.stringify(body), 'utf8')).toBe(REQUEST_LIMIT);
      expect(Buffer.byteLength(JSON.stringify(oversized), 'utf8')).toBe(REQUEST_LIMIT + 1);
      expect(await handlers[method](source.event, oversized)).toEqual(failed('BODY_TOO_LARGE'));
      expectUnused(service);
      expect(await handlers[method](source.event, body)).toEqual({ success: true });
    },
  );

  it.each(['中', '😀', '"', '\\', '\0', '\ud800'])(
    '按 JSON 转义和 UTF-8 计量历史 expected 字符串 %#', async unit => {
      const body = sizedRequest('apply', unit);
      const oversized = sizedRequest('apply', unit, REQUEST_LIMIT + 1);
      expect(Buffer.byteLength(JSON.stringify(body), 'utf8')).toBe(REQUEST_LIMIT);
      expect(Buffer.byteLength(JSON.stringify(oversized), 'utf8')).toBe(REQUEST_LIMIT + 1);
      expect(await handlers.apply(source.event, oversized)).toEqual(failed('BODY_TOO_LARGE'));
      expectUnused(service);
      expect(await handlers.apply(source.event, body)).toEqual({ success: true });
    },
  );

  it('拒绝访问器、toJSON、Proxy 和非法对象，不执行回调或遍历未知值', async () => {
    const touched = vi.fn(() => { throw new Error('fixture-sensitive'); });
    const expected = identity(A);
    const accessor = Object.defineProperty({ ...expected }, 'key', { get: touched });
    const rootAccessor = Object.defineProperty({}, 'expected', { get: touched, enumerable: true });
    const traps = {
      get: touched, getPrototypeOf: touched, ownKeys: touched, getOwnPropertyDescriptor: touched,
    };
    const revoked = Proxy.revocable({ expected }, {});
    revoked.revoke();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const inputs = [
      rootAccessor, { expected: accessor }, { expected, toJSON: touched },
      new Proxy({ expected }, traps), { expected: new Proxy(expected, traps) }, revoked.proxy,
      { expected, extra: circular }, { expected: new Map() }, { expected: new Uint8Array(1) },
      { expected: [] }, { expected: { ...expected, key: { toJSON: touched } } },
    ];
    for (const body of inputs) {
      expect(await handlers.apply(source.event, body)).toEqual(failed('INVALID_REQUEST'));
    }
    expect(touched).not.toHaveBeenCalled();
    expectUnused(service);
  });

  it('接受无原型的数据记录，并保持原始字段值', async () => {
    const expected = Object.assign(Object.create(null), identity(A));
    const body = Object.assign(Object.create(null), { expected });
    expect(await handlers.apply(source.event, body)).toEqual({ success: true });
    expect(service.apply).toHaveBeenCalledWith({ expected: identity(A) });
  });

  it('读取占用名额时拒绝全部新操作，不排队且不检查正文', async () => {
    const gate = pending<ConfigState>();
    service.state.mockReturnValueOnce(gate.promise);
    const first = handlers.state(source.event, {});
    const touched = vi.fn(() => { throw new Error('fixture-sensitive'); });
    const body = Object.defineProperty({}, 'expected', { get: touched, enumerable: true });
    try {
      expect(await handlers.apply(createSource().event, body)).toEqual(failed('FORBIDDEN'));
      expect(await handlers.apply(source.event, body)).toEqual(failed('RATE_LIMITED'));
      expect(await handlers.apply(source.event, body, {})).toEqual(failed('INVALID_REQUEST'));
      for (const [method, request] of requests) {
        expect(await handlers[method](source.event, request)).toEqual(failed('RATE_LIMITED'));
      }
      expect(touched).not.toHaveBeenCalled();
      expect(service.state).toHaveBeenCalledTimes(1);
      expect(service.apply).not.toHaveBeenCalled();
      expect(service.change).not.toHaveBeenCalled();
    } finally {
      gate.resolve(STATE);
      await first;
    }
    expect(await handlers.state(source.event, {})).toEqual({ success: true, data: STATE });
    expect(service.apply).not.toHaveBeenCalled();
    expect(service.change).not.toHaveBeenCalled();
  });

  it.each(requests.slice(1))('%s 写操作占用名额时拒绝读取', async (method, body) => {
    const gate = pending<void>();
    if (method === 'apply') service.apply.mockReturnValueOnce(gate.promise);
    else service.change.mockReturnValueOnce(gate.promise);
    const first = handlers[method](source.event, body);
    try {
      expect(await handlers.state(source.event, {})).toEqual(failed('RATE_LIMITED'));
      expect(service.state).not.toHaveBeenCalled();
    } finally {
      gate.resolve(undefined);
      await first;
    }
    expect(await first).toEqual({ success: true });
    expect(await handlers.state(source.event, {})).toEqual({ success: true, data: STATE });
  });

  it('不同工厂的名额相互独立', async () => {
    const gate = pending<ConfigState>();
    service.state.mockReturnValueOnce(gate.promise);
    const first = handlers.state(source.event, {});
    const other = createConfigHandlers({ service, getTrustedWindow: () => current });
    try {
      expect(await other.state(source.event, {})).toEqual({ success: true, data: STATE });
      expect(await handlers.state(source.event, {})).toEqual(failed('RATE_LIMITED'));
    } finally {
      gate.resolve(STATE);
      await first;
    }
  });

  it('结构、业务校验和大小拒绝后均释放名额', async () => {
    const cases = [
      [{}, 'INVALID_REQUEST'],
      [{ entry: { ...A, model: '\n' } }, 'INVALID_REQUEST'],
      [sizedRequest('add', 'x', REQUEST_LIMIT * 8), 'BODY_TOO_LARGE'],
    ] as const;
    for (const [body, code] of cases) {
      expect(await handlers.add(source.event, body)).toEqual(failed(code));
      expect(await handlers.state(source.event, {})).toEqual({ success: true, data: STATE });
    }
    expect(service.change).not.toHaveBeenCalled();
  });

  it('同步业务异常后释放名额，不重放', async () => {
    service.apply.mockImplementationOnce(() => { throw new FileStoreError('WRITE_UNCERTAIN'); });
    expect(await handlers.apply(source.event, { expected: identity(A) }))
      .toEqual(failed('WRITE_UNCERTAIN'));
    expect(service.apply).toHaveBeenCalledTimes(1);
    expect(await handlers.state(source.event, {})).toEqual({ success: true, data: STATE });
  });

  it('名额覆盖响应验证阶段，返回后才释放', async () => {
    const attempts: Array<ReturnType<Handlers['state']>> = [];
    service.state.mockResolvedValueOnce({
      ...STATE,
      get entries() {
        attempts.push(handlers.state(source.event, {}));
        return STATE.entries;
      },
    });
    expect(await handlers.state(source.event, {})).toEqual({ success: true, data: STATE });
    expect(attempts.length).toBeGreaterThan(0);
    for (const attempt of attempts) expect(await attempt).toEqual(failed('RATE_LIMITED'));
    expect(service.state).toHaveBeenCalledTimes(1);
    expect(await handlers.state(source.event, {})).toEqual({ success: true, data: STATE });
  });

  it.each([
    [new FileStoreError('CONFLICT'), 'CONFLICT', false],
    [new FileStoreError('WRITE_UNCERTAIN', true), 'WRITE_UNCERTAIN', true],
    [new FileStoreError('IO_FAILED', true), 'IO_FAILED', true],
    [Object.assign(new FileStoreError('IO_FAILED', true), { code: 'SESSION_EXPIRED' }), 'IO_FAILED', true],
    [new Error('fixture-sensitive'), 'IO_FAILED', false],
    [{ code: 'WRITE_UNCERTAIN', cleanupFailed: true, message: 'fixture-sensitive' }, 'IO_FAILED', false],
    [null, 'IO_FAILED', false],
    [Object.assign(new FileStoreError('IO_FAILED'), { code: 'fixture-sensitive' }), 'IO_FAILED', false],
    [Object.assign(new FileStoreError('IO_FAILED'), { cleanupFailed: 'true' }), 'IO_FAILED', false],
    [new Proxy({}, { getPrototypeOf() { throw new Error('fixture-sensitive'); } }), 'IO_FAILED', false],
  ] as const)('只转发可信的有限错误字段 %#，不重放或刷新', async (error, code, cleanup) => {
    service.apply.mockRejectedValue(error);
    expect(await handlers.apply(source.event, { expected: identity(A) })).toEqual(failed(code, cleanup));
    expect(service.apply).toHaveBeenCalledTimes(1);
    expect(service.state).not.toHaveBeenCalled();
    expect(service.change).not.toHaveBeenCalled();
    expect(await handlers.state(source.event, {})).toEqual({ success: true, data: STATE });
  });
});

const unsupported = process.platform !== 'darwin'
  || process.getuid?.() === 0 || process.geteuid?.() === 0;

describe.skipIf(unsupported)('配置 handler 真实文件集成', () => {
  let resources: TestResources | undefined;
  let paths: Record<FileKey, string>;
  let source: ReturnType<typeof createSource>;
  let service: ReturnType<typeof observe>;
  let handlers: Handlers;

  const capture = (keys: readonly FileKey[]) => Promise.all(keys.map(async key => {
    const text = await fs.readFile(paths[key], 'utf8');
    const stat = await fs.stat(paths[key], { bigint: true });
    return { key, text, ino: stat.ino, mtimeNs: stat.mtimeNs, mode: stat.mode };
  }));

  beforeEach(async () => {
    resources = createTestResources();
    const { home } = resources;
    paths = {
      config: join(home, 'change-ai-config.json'),
      settings: join(home, '.claude', 'settings.json'),
      zshrc: join(home, '.zshrc'),
    };
    await fs.mkdir(join(home, '.claude'));
    await Promise.all([
      fs.writeFile(paths.config, serialize([{ ...A, extra: 'discard-on-edit' }, B]), { mode: 0o600 }),
      fs.writeFile(paths.settings, '{}\n', { mode: 0o600 }),
      fs.writeFile(paths.zshrc, '# ipc-fixture\n', { mode: 0o600 }),
    ]);
    service = observe(createService(await createFileStore({ home })));
    source = createSource();
    handlers = createConfigHandlers({ service, getTrustedWindow: () => source.trusted });
  });

  afterEach(() => {
    resources?.cleanup();
    resources = undefined;
  });

  it('读取真实状态，应用仅改变 zshrc 且不自动刷新', async () => {
    const untouched = await capture(['config', 'settings']);
    const state = await handlers.state(source.event, {});
    expect(state).toMatchObject({ success: true, data: { activeIndex: -1, entries: [A, {
      ...A, model: B.model,
    }] } });
    expect(await handlers.apply(source.event, { expected: identity(A) })).toEqual({ success: true });
    expect(service.state).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(paths.zshrc, 'utf8')).toContain('export ANTHROPIC_MODEL=model-a\n');
    expect(await capture(['config', 'settings'])).toEqual(untouched);
    expect(await handlers.state(source.event, {})).toMatchObject({
      success: true, data: { activeIndex: 0 },
    });
  });

  it('正确分发新增、编辑、删除，拆出索引并保留其他条目未知字段', async () => {
    const untouched = await capture(['settings', 'zshrc']);
    const added = { ...A, model: 'added' };
    const replacement = { ...A, model: 'replacement' };
    expect(await handlers.add(source.event, { entry: added })).toEqual({ success: true });
    expect(await fs.readFile(paths.config, 'utf8'))
      .toBe(serialize([{ ...A, extra: 'discard-on-edit' }, B, added]));
    expect(await handlers.edit(source.event, {
      index: 0, expected: identity(A), entry: replacement,
    })).toEqual({ success: true });
    expect(await fs.readFile(paths.config, 'utf8')).toBe(serialize([replacement, B, added]));
    expect(await handlers.remove(source.event, {
      index: 2, expected: identity(added),
    })).toEqual({ success: true });
    expect(await fs.readFile(paths.config, 'utf8')).toBe(serialize([replacement, B]));
    expect(await capture(['settings', 'zshrc'])).toEqual(untouched);
    expect(service.state).not.toHaveBeenCalled();
  });

  it('返回真实原下标冲突，文件保持不变', async () => {
    const before = await capture(['config', 'settings', 'zshrc']);
    expect(await handlers.remove(source.event, {
      index: 1, expected: identity(A),
    })).toEqual(failed('CONFLICT'));
    expect(await capture(['config', 'settings', 'zshrc'])).toEqual(before);
  });

  it('拒绝来源和正文错误时不调用真实业务，也不改文件', async () => {
    const before = await capture(['config', 'settings', 'zshrc']);
    source.message.senderFrame = { ...source.frame };
    for (const [method, body] of requests) {
      expect(await handlers[method](source.event, body)).toEqual(failed('FORBIDDEN'));
    }
    source.message.senderFrame = source.frame;
    for (const [method, body] of requests) {
      expect(await handlers[method](source.event, { ...body, home: '../outside' }))
        .toEqual(failed('INVALID_REQUEST'));
    }
    expectUnused(service);
    expect(await capture(['config', 'settings', 'zshrc'])).toEqual(before);
  });

  it.each([
    ['apply', null],
    ['apply', []],
    ['apply', { expected: A }],
    ['apply', { expected: { ...identity(A), key: 1 } }],
    ['add', { entry: { ...A, path: '/unused' } }],
    ['add', { entry: { ...A, channel: null } }],
    ['add', { entry: { ...A, model: 'bad\nvalue' } }],
    ['add', { entry: { ...A, key: '\uD800' } }],
    ['add', { entry: { ...A, model: ' ' } }],
    ['edit', { index: 0, expected: identity(A) }],
    ['remove', { index: 0, expected: identity(A), entry: B }],
  ] as const)('非法 %s 输入 %# 不进入业务或改变文件', async (method, body) => {
    const before = await capture(['config', 'settings', 'zshrc']);
    expect(await handlers[method](source.event, body)).toEqual(failed('INVALID_REQUEST'));
    expectUnused(service);
    expect(await capture(['config', 'settings', 'zshrc'])).toEqual(before);
  });

  it.each(['edit', 'remove'] as const)('%s 拒绝非法数字下标且不调用业务', async method => {
    const before = await capture(['config', 'settings', 'zshrc']);
    for (const index of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0']) {
      const body = {
        index, expected: identity(A), ...(method === 'edit' ? { entry: A } : {}),
      };
      expect(await handlers[method](source.event, body)).toEqual(failed('INVALID_REQUEST'));
      expect(await capture(['config', 'settings', 'zshrc'])).toEqual(before);
    }
    expectUnused(service);
  });

  it.each([
    `{"private":"${A.key}"`, 'null', '{}', '[null]', '[{"model":1}]',
  ])('损坏磁盘配置 %# 在读取及全部写路径返回脱敏错误且不改文件', async text => {
    await fs.writeFile(paths.config, text);
    const before = await capture(['config', 'settings', 'zshrc']);
    for (const [method, body] of requests) {
      expect(await handlers[method](source.event, body)).toEqual(failed('INVALID_CONFIG'));
      expect(await capture(['config', 'settings', 'zshrc'])).toEqual(before);
    }
    expect(service.state).toHaveBeenCalledTimes(1);
    expect(service.apply).toHaveBeenCalledTimes(1);
    expect(service.change).toHaveBeenCalledTimes(3);
  });

  it('将真实无效配置与缺失文件转换为安全错误', async () => {
    await fs.writeFile(paths.config, 'fixture-sensitive-invalid-json');
    expect(await handlers.state(source.event, {})).toEqual(failed('INVALID_CONFIG'));
    await fs.writeFile(paths.config, serialize([A, B]));
    await fs.unlink(paths.zshrc);
    expect(await handlers.state(source.event, {})).toEqual(failed('FILE_MISSING'));
  });

  it('写入成功后独立刷新失败，不改写成功结果或重放', async () => {
    const written = await handlers.apply(source.event, { expected: identity(A) });
    expect(written).toEqual({ success: true });
    const applied = await capture(['zshrc', 'settings']);
    await fs.unlink(paths.config);
    expect(await handlers.state(source.event, {})).toEqual(failed('FILE_MISSING'));
    expect(written).toEqual({ success: true });
    expect(service.apply).toHaveBeenCalledTimes(1);
    expect(service.state).toHaveBeenCalledTimes(1);
    expect(await capture(['zshrc', 'settings'])).toEqual(applied);
  });

  it('超限请求不调用真实业务、不改文件，拒绝后仍可读取', async () => {
    const before = await capture(['config', 'settings', 'zshrc']);
    expect(await handlers.add(source.event, sizedRequest('add', 'x', REQUEST_LIMIT + 1)))
      .toEqual(failed('BODY_TOO_LARGE'));
    expectUnused(service);
    expect(await capture(['config', 'settings', 'zshrc'])).toEqual(before);
    expect(await handlers.state(source.event, {})).toMatchObject({ success: true });
  });

  it('合法状态响应可超过请求上限，读取不改文件', async () => {
    const entry = { ...A, key: 'x'.repeat(REQUEST_LIMIT) };
    await fs.writeFile(paths.config, serialize([entry]));
    const before = await capture(['config', 'settings', 'zshrc']);
    const response = await handlers.state(source.event, {});
    expect(response).toMatchObject({ success: true, data: { entries: [entry] } });
    expect(Buffer.byteLength(JSON.stringify(response), 'utf8')).toBeGreaterThan(REQUEST_LIMIT);
    expect(await capture(['config', 'settings', 'zshrc'])).toEqual(before);
  });
});
