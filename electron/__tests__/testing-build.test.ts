import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'electron-vite';
import { normalizePath } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import production from '../../electron.vite.config';
import isolated from '../../electron.test.vite.config';
import type { ClipboardBridge } from '../../src/lib/clipboardIpcContract';
import type { ConfigBridge } from '../../src/lib/configIpcContract';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fromRoot = (path: string) => normalizePath(resolve(root, path));
const targets = ['main', 'preload', 'renderer'] as const;

interface BuildRecord {
  readonly directory: string;
  readonly entries: string[];
  readonly modules: string[];
  readonly chunks: {
    readonly fileName: string;
    readonly code: string;
    readonly imports: string[];
    readonly dynamicImports: string[];
  }[];
}

function loadPreload(code: string) {
  const expose = vi.fn();
  const invoke = vi.fn(function (this: unknown, _channel: string, _body: unknown): Promise<unknown> {
    assert.equal(this, ipcRenderer);
    return Promise.resolve({ success: true });
  });
  const ipcRenderer = Object.freeze({ invoke });
  const requireModule = vi.fn((name: string) => {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld: expose }, ipcRenderer };
  });
  const exports = {};
  const sandbox = {
    TextEncoder,
    require: requireModule,
    process: Object.freeze({ platform: 'fixture-platform' }),
    module: { exports },
    exports,
  };
  runInNewContext(code, sandbox, { timeout: 5_000 });
  expect(requireModule.mock.calls).toEqual([['electron']]);
  expect(expose).toHaveBeenCalledTimes(1);
  const [name, desktop] = expose.mock.calls[0] as [
    string, { platform: string; config: ConfigBridge; clipboard: ClipboardBridge },
  ];
  expect(name).toBe('desktop');
  expect(Object.keys(desktop)).toEqual(['platform', 'config', 'clipboard']);
  expect(desktop.platform).toBe('fixture-platform');
  expect(Object.isFrozen(desktop)).toBe(true);
  expect(Object.keys(desktop.config)).toEqual(['state', 'apply', 'add', 'edit', 'remove']);
  expect(Object.isFrozen(desktop.config)).toBe(true);
  expect(Object.keys(desktop.clipboard)).toEqual(['writeText']);
  expect(Object.isFrozen(desktop.clipboard)).toBe(true);
  expect(invoke).not.toHaveBeenCalled();
  expect(runInNewContext('typeof Buffer', sandbox)).toBe('undefined');
  return { bridge: desktop.config, clipboard: desktop.clipboard, invoke, receiver: ipcRenderer };
}

async function verifyPreloadRequests(bridge: ConfigBridge, invoke: ReturnType<typeof loadPreload>['invoke']) {
  const expected = { model: 'fixture-model', base_url: 'https://example.invalid', key: 'fixture-key' };
  const entry = { ...expected, channel: '' };
  const requests = [
    ['state', 'config:state', {}],
    ['apply', 'config:apply', { expected }],
    ['add', 'config:add', { entry }],
    ['edit', 'config:edit', { index: 0, expected, entry }],
    ['remove', 'config:remove', { index: 0, expected }],
  ] as const;
  for (const [method, channel, body] of requests) {
    invoke.mockClear();
    const response = method === 'state'
      ? { success: true, data: { entries: [], groups: [], activeIndex: -1 } }
      : { success: true };
    invoke.mockResolvedValueOnce(response);
    const result = await Reflect.apply(bridge[method], undefined, [body]);
    expect(result).toEqual(response);
    expect(result).not.toBe(response);
    expect(invoke.mock.calls).toEqual([[channel, body]]);
    expect(invoke.mock.calls[0][1]).not.toBe(body);
    invoke.mockClear();
    for (const args of [[], [body, {}], [null], [{ ...body, home: '../outside' }]]) {
      expect(await Reflect.apply(bridge[method], undefined, args)).toEqual({
        success: false, code: 'INVALID_REQUEST', cleanupFailed: false,
      });
    }
    expect(invoke).not.toHaveBeenCalled();
  }
}

async function verifyPreloadFailures(bridge: ConfigBridge, invoke: ReturnType<typeof loadPreload>['invoke']) {
  const request = { expected: { model: 'fixture-model', base_url: '', key: '' } };
  const uncertain = { success: false, code: 'WRITE_UNCERTAIN', cleanupFailed: true };
  invoke.mockResolvedValueOnce(uncertain);
  expect(await bridge.apply(request)).toEqual(uncertain);
  expect(invoke.mock.calls).toEqual([['config:apply', request]]);
  for (const mode of ['sync', 'async', 'response']) {
    invoke.mockClear();
    invoke.mockImplementationOnce(() => {
      if (mode === 'sync') throw new Error('fixture-sensitive');
      if (mode === 'async') return Promise.reject(new Error('fixture-sensitive'));
      return Promise.resolve({
        success: false, code: 'IO_FAILED', cleanupFailed: false, message: 'fixture-sensitive',
      });
    });
    await expect(bridge.apply(request)).rejects.toThrow(
      '配置通信失败，操作结果未知；请重新读取核对，勿自动重试。',
    );
    expect(invoke.mock.calls).toEqual([['config:apply', request]]);
  }
}

async function verifyClipboardRequests({
  clipboard, invoke, receiver,
}: ReturnType<typeof loadPreload>) {
  invoke.mockClear();
  for (const args of [[], ['text', undefined], [null], [{}], ['a\0b'], ['\ud800']]) {
    expect(await Reflect.apply(clipboard.writeText, undefined, args))
      .toEqual({ success: false, code: 'INVALID_REQUEST' });
  }
  const limit = '😀'.repeat(262_144);
  expect(await clipboard.writeText(limit + 'a'))
    .toEqual({ success: false, code: 'BODY_TOO_LARGE' });
  expect(invoke).not.toHaveBeenCalled();
  for (const text of ['', ' \t中文 😀\r\n ', limit]) {
    invoke.mockClear();
    const response = { success: true };
    invoke.mockResolvedValueOnce(response);
    const result = await clipboard.writeText(text);
    expect(result).toEqual(response);
    expect(result).not.toBe(response);
    expect(invoke.mock.calls).toEqual([['clipboard:writeText', text]]);
    expect(invoke.mock.contexts).toEqual([receiver]);
  }
  for (const code of [
    'FORBIDDEN', 'INVALID_REQUEST', 'BODY_TOO_LARGE', 'RATE_LIMITED', 'CLIPBOARD_WRITE_FAILED',
  ]) {
    invoke.mockClear();
    const response = { success: false, code };
    invoke.mockResolvedValueOnce(response);
    const result = await clipboard.writeText('fixture-text');
    expect(result).toEqual(response);
    expect(result).not.toBe(response);
    expect(invoke.mock.calls).toEqual([['clipboard:writeText', 'fixture-text']]);
  }
}

const clipboardUnknown = '剪贴板通信失败，操作结果未知；请自行核对，勿自动重试。';

async function verifyClipboardFailures({
  clipboard, invoke, receiver,
}: ReturnType<typeof loadPreload>) {
  for (const response of [
    null, 'fixture-sensitive', {},
    { success: true, text: 'fixture-sensitive' },
    { success: false, code: 'UNKNOWN' },
    { success: false, code: 'CLIPBOARD_WRITE_FAILED', message: 'fixture-sensitive' },
    { success: false, code: 'CLIPBOARD_WRITE_FAILED', cleanupFailed: false },
  ]) {
    invoke.mockClear();
    invoke.mockResolvedValueOnce(response);
    await expect(clipboard.writeText('fixture-text')).rejects.toThrow(clipboardUnknown);
    expect(invoke.mock.calls).toEqual([['clipboard:writeText', 'fixture-text']]);
    expect(invoke.mock.contexts).toEqual([receiver]);
  }
  for (const mode of ['sync', 'async']) {
    invoke.mockClear();
    invoke.mockImplementationOnce(() => {
      if (mode === 'sync') throw new Error('fixture-sensitive');
      return Promise.reject(new Error('fixture-sensitive'));
    });
    await expect(clipboard.writeText('fixture-text')).rejects.toThrow(clipboardUnknown);
    expect(invoke.mock.calls).toEqual([['clipboard:writeText', 'fixture-text']]);
    expect(invoke.mock.contexts).toEqual([receiver]);
  }
}

async function verifyClipboardPending({
  clipboard, invoke, receiver,
}: ReturnType<typeof loadPreload>) {
  for (const mode of ['resolve', 'reject']) {
    invoke.mockClear();
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const pending = new Promise<unknown>((done, fail) => { resolve = done; reject = fail; });
    invoke.mockReturnValueOnce(pending);
    const settled = vi.fn();
    const result = clipboard.writeText('pending');
    void result.then(settled, settled);
    try {
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();
      expect(invoke.mock.calls).toEqual([['clipboard:writeText', 'pending']]);
      expect(invoke.mock.contexts).toEqual([receiver]);
    } finally {
      if (mode === 'resolve') resolve({ success: true });
      else reject(new Error('fixture-sensitive'));
      await Promise.allSettled([pending, result]);
    }
    if (mode === 'resolve') await expect(result).resolves.toEqual({ success: true });
    else await expect(result).rejects.toThrow(clipboardUnknown);
    expect(settled).toHaveBeenCalledOnce();
    expect(invoke.mock.calls).toEqual([['clipboard:writeText', 'pending']]);
  }
}

describe('桌面生产与测试构建边界', () => {
  it('导入测试配置不改变生产配置的入口和输出目录', () => {
    for (const target of targets) {
      expect(normalizePath(production[target]?.build?.outDir ?? ''))
        .toBe(fromRoot(`out/${target}`));
      expect(normalizePath(isolated[target]?.build?.outDir ?? ''))
        .toBe(fromRoot(`out-test/${target}`));
    }
    expect(production.main?.build?.lib).toMatchObject({
      entry: resolve(root, 'electron/main.ts'), formats: ['es'],
    });
    expect(isolated.main?.build?.lib).toMatchObject({
      entry: resolve(root, 'electron/testing/main.ts'), formats: ['es'],
    });
    expect(isolated.preload?.build).toMatchObject({
      externalizeDeps: false,
      lib: { entry: resolve(root, 'electron/preload.ts'), formats: ['cjs'] },
      rollupOptions: { output: { entryFileNames: 'index.cjs' } },
    });
  });

  it.each([
    ['electron.vite.config.ts', 'out', 'electron/main.ts'],
    ['electron.test.vite.config.ts', 'out-test', 'electron/testing/main.ts'],
  ])('实际构建 %s 的三个目标并检查模块图', async (configFile, output, entry) => {
    const records: BuildRecord[] = [];
    let directory = '';
    await build({
      configFile: fromRoot(configFile),
      envFile: false,
      logLevel: 'silent',
      build: { write: false, emptyOutDir: false },
      plugins: [{
        name: 'inspect-desktop-build-boundary',
        configResolved(config) {
          directory = normalizePath(config.build.outDir);
        },
        generateBundle(_options, bundle) {
          records.push({
            directory,
            entries: Object.values(bundle).flatMap(item =>
              item.type === 'chunk' && item.isEntry
                ? [normalizePath(item.facadeModuleId ?? '')]
                : [],
            ),
            modules: [...this.getModuleIds()].map(id => normalizePath(id)),
            chunks: Object.values(bundle).flatMap(item => item.type === 'chunk' ? [{
              fileName: item.fileName, code: item.code,
              imports: item.imports, dynamicImports: item.dynamicImports,
            }] : []),
          });
        },
      }],
    });
    expect(records.map(record => record.directory))
      .toEqual(targets.map(target => fromRoot(`${output}/${target}`)));
    expect(records[0].entries).toEqual([fromRoot(entry)]);
    expect(records[1].entries).toEqual([fromRoot('electron/preload.ts')]);
    expect(records[2].entries).toEqual([fromRoot('index.html')]);
    expect(records[0].modules).toContain(fromRoot('electron/bootstrap.ts'));
    expect(records[0].modules).toEqual(expect.arrayContaining([
      fromRoot('server/files.ts'), fromRoot('server/service.ts'),
      fromRoot('server/errors.ts'), fromRoot('electron/configIpc.ts'),
      fromRoot('electron/ipcSource.ts'),
      fromRoot('electron/clipboardIpc.ts'), fromRoot('src/lib/clipboardIpcContract.ts'),
    ]));
    for (const record of records) {
      expect(record.modules).not.toContain(fromRoot('server.mjs'));
      expect(record.modules).not.toContain(fromRoot('src/lib/serverDomain.ts'));
      expect(record.modules.some(id =>
        id.startsWith(fromRoot('dist-server') + '/')
          || (id.startsWith(fromRoot('server') + '/') && id.endsWith('.mjs')),
      )).toBe(false);
    }
    for (const record of [records[0], records[2]]) {
      expect(record.modules).not.toContain(fromRoot('electron/configBridge.ts'));
      expect(record.modules).not.toContain(fromRoot('electron/clipboardBridge.ts'));
    }
    expect(records[1].modules).toEqual(expect.arrayContaining([
      fromRoot('electron/configBridge.ts'), fromRoot('src/lib/configIpcContract.ts'),
      fromRoot('electron/clipboardBridge.ts'), fromRoot('src/lib/clipboardIpcContract.ts'),
    ]));
    expect(records[1].modules.some(id => id.includes('/node_modules/zod/'))).toBe(true);
    expect(records[1].modules.some(id =>
      id.startsWith('node:') || id.includes('browser-external'),
    )).toBe(false);
    expect(records[1].chunks).toHaveLength(1);
    expect(records[1].chunks[0]).toMatchObject({
      fileName: 'index.cjs', imports: ['electron'], dynamicImports: [],
    });
    for (const record of records.slice(1)) {
      expect(record.modules).not.toContain(fromRoot('electron/configIpc.ts'));
      expect(record.modules).not.toContain(fromRoot('electron/ipcSource.ts'));
      expect(record.modules).not.toContain(fromRoot('electron/clipboardIpc.ts'));
      expect(record.modules.some(id => id.startsWith(fromRoot('server') + '/'))).toBe(false);
      expect(record.modules).not.toContain(fromRoot('electron/bootstrap.ts'));
    }
    expect(records[2].modules).toEqual(expect.arrayContaining([
      fromRoot('src/lib/clipboardClient.ts'), fromRoot('src/lib/clipboardIpcContract.ts'),
    ]));
    for (const record of records) {
      expect(record.modules).not.toContain(fromRoot('electron/testing/ipcSource.ts'));
    }
    if (output === 'out') {
      const testingDirectory = fromRoot('electron/testing') + '/';
      for (const record of records) {
        expect(record.modules.some(id => id.includes(testingDirectory))).toBe(false);
      }
    } else {
      expect(records[0].modules).toEqual(expect.arrayContaining([
        fromRoot('electron/testing/main.ts'),
        fromRoot('electron/testing/resources.ts'),
      ]));
      expect(records[0].modules).not.toContain(fromRoot('electron/main.ts'));
    }
    const loaded = loadPreload(records[1].chunks[0].code);
    const { bridge, invoke } = loaded;
    await verifyPreloadRequests(bridge, invoke);
    await verifyPreloadFailures(bridge, invoke);
    await verifyClipboardRequests(loaded);
    await verifyClipboardFailures(loaded);
    await verifyClipboardPending(loaded);
  }, 30_000);
});
