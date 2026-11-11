import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build, normalizePath } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { createConfigBridge } from '../configBridge';
import {
  configIpcChannels, type ConfigBridge, type ConfigIpcMethod,
} from '../../src/lib/configIpcContract';

const expected = { model: ' model ', base_url: 'not-a-url', key: 'fixture-key' };
const entry = { ...expected, channel: '' };
const state = {
  entries: [entry],
  groups: [{
    url: entry.base_url,
    channels: [{ channel: '', items: [{ entry, index: 0 }] }],
  }],
  activeIndex: 0,
};
const requests = [
  ['state', 'config:state', {}],
  ['apply', 'config:apply', { expected }],
  ['add', 'config:add', { entry }],
  ['edit', 'config:edit', { index: 0, expected, entry }],
  ['remove', 'config:remove', { index: 0, expected }],
] as const;
const invalid = { success: false, code: 'INVALID_REQUEST', cleanupFailed: false };
const call = (bridge: ConfigBridge, method: ConfigIpcMethod, ...args: unknown[]) =>
  Reflect.apply(bridge[method], undefined, args) as Promise<unknown>;

describe('固定配置桥接', () => {
  it('仅提供冻结的五个方法，创建时不调用传输', () => {
    const invoke = vi.fn();
    const bridge = createConfigBridge(invoke);
    expect(Object.keys(bridge)).toEqual(['state', 'apply', 'add', 'edit', 'remove']);
    expect(Object.isFrozen(bridge)).toBe(true);
    expect(Object.isFrozen(configIpcChannels)).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(requests)('%s 仅调用对应固定通道一次并保留字段原值', async (method, channel, body) => {
    const response = method === 'state' ? { success: true, data: state } : { success: true };
    const invoke = vi.fn().mockResolvedValue(response);
    expect(await call(createConfigBridge(invoke), method, body)).toEqual(response);
    expect(invoke.mock.calls).toEqual([[channel, body]]);
    expect(invoke.mock.calls[0][1]).not.toBe(body);
  });

  it.each(requests)('%s 拒绝非法正文、缺少或额外参数且不发送', async (method, _channel, body) => {
    const invoke = vi.fn();
    const bridge = createConfigBridge(invoke);
    for (const args of [[], [body, {}], [null], [undefined], [{ ...body, home: '../outside' }]]) {
      expect(await call(bridge, method, ...args)).toEqual(invalid);
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it('拒绝嵌套额外字段、非法写入和索引，但保留历史 expected', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: true });
    const bridge = createConfigBridge(invoke);
    expect(await call(bridge, 'apply', { expected: { ...expected, path: '../outside' } }))
      .toEqual(invalid);
    expect(await call(bridge, 'add', { entry: { ...entry, model: '\0' } })).toEqual(invalid);
    expect(await call(bridge, 'edit', { index: -1, expected, entry })).toEqual(invalid);
    expect(await call(bridge, 'remove', { index: '0', expected })).toEqual(invalid);
    expect(invoke).not.toHaveBeenCalled();
    const legacy = { model: '', base_url: '\0legacy', key: '\ud800' };
    expect(await bridge.apply({ expected: legacy })).toEqual({ success: true });
    expect(invoke.mock.calls).toEqual([['config:apply', { expected: legacy }]]);
  });

  it('本地解析异常不泄露正文，也不发送请求', async () => {
    const invoke = vi.fn();
    const body = Object.defineProperty({}, 'expected', {
      enumerable: true,
      get() { throw new Error('fixture-sensitive'); },
    });
    expect(await call(createConfigBridge(invoke), 'apply', body)).toEqual(invalid);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(requests)('%s 保留可信业务错误和不确定写入，不重试或刷新', async (method, channel, body) => {
    for (const code of ['CONFLICT', 'WRITE_UNCERTAIN', 'RATE_LIMITED', 'BODY_TOO_LARGE']) {
      const response = { success: false, code, cleanupFailed: true };
      const invoke = vi.fn().mockResolvedValue(response);
      expect(await call(createConfigBridge(invoke), method, body)).toEqual(response);
      expect(invoke.mock.calls).toEqual([[channel, body]]);
    }
  });

  it('返回解析后的状态，剥除嵌套未知字段', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      data: { ...state, secret: 'fixture-sensitive', entries: [{ ...entry, secret: 'fixture-sensitive' }] },
    });
    expect(await createConfigBridge(invoke).state({})).toEqual({ success: true, data: state });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each(requests)('%s 将损坏响应转换为结果未知的固定异常', async (method, channel, body) => {
    const responses = [
      undefined, null, 'fixture-sensitive',
      { success: true, data: { ...state, activeIndex: 99 } },
      { success: false, code: 'fixture-sensitive', cleanupFailed: false },
      { success: false, code: 'IO_FAILED', cleanupFailed: 'false' },
      { success: false, code: 'IO_FAILED', cleanupFailed: false, message: 'fixture-sensitive' },
    ];
    for (const response of responses) {
      const invoke = vi.fn().mockResolvedValue(response);
      const error = await call(createConfigBridge(invoke), method, body).catch(value => value);
      assert.ok(error instanceof Error);
      expect(error.message).toContain('结果未知');
      expect(error.message).not.toContain('fixture-sensitive');
      expect(Object.keys(error)).toEqual([]);
      expect(invoke.mock.calls).toEqual([[channel, body]]);
    }
  });

  it.each(requests)('%s 对同步及异步传输异常不泄密、不重放', async (method, channel, body) => {
    const secret = new Error('fixture-sensitive');
    const forged = { success: false, code: 'WRITE_UNCERTAIN', cleanupFailed: true };
    for (const invoke of [
      vi.fn(() => { throw secret; }),
      vi.fn().mockRejectedValue(secret),
      vi.fn().mockRejectedValue(forged),
      vi.fn().mockRejectedValue(null),
    ]) {
      const error = await call(createConfigBridge(invoke), method, body).catch(value => value);
      assert.ok(error instanceof Error);
      expect(error.message).toContain('结果未知');
      expect(error.message).not.toContain('fixture-sensitive');
      expect(Object.keys(error)).toEqual([]);
      expect(invoke.mock.calls).toEqual([[channel, body]]);
    }
  });

  it('请求失败不会阻止后续显式读取，也不自动读取', async () => {
    const invoke = vi.fn().mockRejectedValueOnce(new Error('fixture-sensitive'))
      .mockResolvedValueOnce({ success: true, data: state });
    const bridge = createConfigBridge(invoke);
    await expect(bridge.apply({ expected })).rejects.toThrow(/结果未知/);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(await bridge.state({})).toEqual({ success: true, data: state });
    expect(invoke.mock.calls).toEqual([
      ['config:apply', { expected }], ['config:state', {}],
    ]);
  });
});

describe('桥接独立打包边界', () => {
  it('真实打包后在无 Node 全局变量环境执行校验，不依赖主进程模块', async () => {
    let code = '';
    const modules: string[] = [];
    await build({
      configFile: false,
      envFile: false,
      logLevel: 'silent',
      build: {
        write: false, minify: false, emptyOutDir: false,
        lib: {
          entry: fileURLToPath(new URL('../configBridge.ts', import.meta.url)),
          name: 'ConfigBridgeTest', formats: ['iife'],
        },
      },
      plugins: [{
        name: 'inspect-config-bridge',
        generateBundle(_options, bundle) {
          modules.push(...[...this.getModuleIds()].map(normalizePath));
          const chunks = Object.values(bundle).filter(item => item.type === 'chunk');
          expect(chunks).toHaveLength(1);
          expect(chunks[0].imports).toEqual([]);
          expect(chunks[0].dynamicImports).toEqual([]);
          code = chunks[0].code;
        },
      }],
    });
    expect(modules.some(id => id.endsWith('/src/lib/configIpcContract.ts'))).toBe(true);
    expect(modules.some(id => id.includes('/node_modules/zod/'))).toBe(true);
    expect(modules.some(id =>
      id.startsWith('node:') || id.includes('/server/') || id.includes('browser-external')
        || id.endsWith('/electron/configIpc.ts') || id === 'electron',
    )).toBe(false);
    const sandbox = {};
    const factory = runInNewContext(
      `${code}\nConfigBridgeTest.createConfigBridge`,
      sandbox,
    ) as typeof createConfigBridge;
    expect(runInNewContext('[typeof Buffer, typeof process, typeof require].join(",")', sandbox))
      .toBe('undefined,undefined,undefined');
    const invoke = vi.fn().mockResolvedValueOnce({ success: true, data: state })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, code: 'fixture-sensitive' });
    const bridge = factory(invoke);
    expect(await bridge.state({})).toEqual({ success: true, data: state });
    expect(await bridge.apply({ expected })).toEqual({ success: true });
    await expect(bridge.remove({ index: 0, expected })).rejects.toThrow(/结果未知/);
    expect(invoke.mock.calls).toEqual([
      ['config:state', {}], ['config:apply', { expected }], ['config:remove', { index: 0, expected }],
    ]);
  }, 30_000);
});
