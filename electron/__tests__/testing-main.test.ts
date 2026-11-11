import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { TestResources } from '../testing/resources';
type Bootstrap = typeof import('../bootstrap').bootstrap;
type Listener = Parameters<IpcMain['handle']>[1];

interface TestWindow {
  destroyed: boolean;
  callbacks: Map<string, () => void>;
  frame: {
    url: string;
    origin: string;
    detached: boolean;
    isDestroyed: () => boolean;
  };
  webContents: {
    mainFrame: TestWindow['frame'];
    isDestroyed: () => boolean;
  };
}

const state = vi.hoisted(() => ({
  packaged: false,
  ready: false,
  switches: new Set<string>(),
  failures: new Set<string>(),
  events: [] as string[],
  paths: new Map<string, string>(),
  allocated: [] as TestResources[],
  messages: [] as unknown[][],
  exit: vi.fn<(code: number) => void>(),
  quit: vi.fn(),
  userInfo: vi.fn(),
  realBootstrap: false,
  boots: [] as Array<ReturnType<Bootstrap>>,
  prepare: undefined as ((resources: TestResources) => void) | undefined,
  otherHome: '',
  handlers: new Map<string, Listener>(),
  callbacks: new Map<string, () => void>(),
  windows: [] as TestWindow[],
  requests: [] as Promise<unknown>[],
  writeText: vi.fn<(text: string) => Promise<void>>(),
}));

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  userInfo: state.userInfo,
}));

function record(step: string): void {
  state.events.push(step);
  if (state.failures.has(step)) throw new Error('fixture-sensitive');
}

vi.mock('electron', () => ({
  app: {
    get isPackaged() { return state.packaged; },
    isReady: () => state.ready,
    commandLine: { hasSwitch: (name: string) => state.switches.has(name) },
    setPath(name: string, path: string) {
      record(name);
      state.paths.set(name, path);
    },
    setAppLogsPath(path: string) {
      record('logs');
      state.paths.set('logs', path);
    },
    exit: state.exit,
    quit: state.quit,
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    getPath: () => state.otherHome,
    on: (name: string, callback: () => void) => state.callbacks.set(name, callback),
  },
  BrowserWindow: class {
    destroyed = false;
    callbacks = new Map<string, () => void>();
    frame = {
      url: '', origin: '', detached: false,
      isDestroyed: () => this.destroyed,
    };
    webContents = {
      mainFrame: this.frame,
      isDestroyed: () => this.destroyed,
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
    };
    constructor() { state.windows.push(this); }
    isDestroyed() { return this.destroyed; }
    once() {}
    on(name: string, callback: () => void) { this.callbacks.set(name, callback); }
    async loadURL(target: string) {
      record('window');
      const url = new URL(target);
      this.frame.url = url.href;
      this.frame.origin = `${url.protocol}//${url.host}`;
    }
  },
  ipcMain: {
    handle(channel: string, listener: Listener) {
      record(`handle:${channel}`);
      if (state.handlers.has(channel)) throw new Error('fixture-sensitive');
      state.handlers.set(channel, listener);
    },
    removeHandler(channel: string) {
      record(`remove:${channel}`);
      state.handlers.delete(channel);
    },
  },
  clipboard: { writeText: state.writeText },
  dialog: { showErrorBox: () => record('startup-error') },
  protocol: {
    registerSchemesAsPrivileged: () => record('scheme'),
    handle: () => record('protocol'),
  },
  session: {
    defaultSession: {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      on: vi.fn(),
    },
  },
}));

vi.mock('../bootstrap', async importOriginal => {
  const actual = await importOriginal<typeof import('../bootstrap')>();
  return {
    bootstrap(...args: Parameters<Bootstrap>) {
      record('bootstrap');
      if (!state.realBootstrap) return;
      const result = actual.bootstrap(...args);
      state.boots.push(result);
      return result;
    },
  };
});

vi.mock('../testing/resources', async importOriginal => {
  const actual = await importOriginal<typeof import('../testing/resources')>();
  return {
    ...actual,
    createTestResources(...args: unknown[]) {
      record('resources');
      const resources: TestResources = Reflect.apply(actual.createTestResources, undefined, args);
      state.allocated.push(resources);
      state.prepare?.(resources);
      return {
        ...resources,
        cleanup() {
          record('cleanup');
          resources.cleanup();
        },
      };
    },
  };
});

beforeEach(() => {
  vi.resetModules();
  state.packaged = false;
  state.ready = false;
  state.switches.clear();
  state.failures.clear();
  state.events.length = 0;
  state.paths.clear();
  state.messages.length = 0;
  state.exit.mockClear();
  state.quit.mockClear();
  state.userInfo.mockReset().mockImplementation(() => { throw new Error('fixture-sensitive'); });
  state.writeText.mockReset().mockResolvedValue(undefined);
  state.realBootstrap = false;
  state.prepare = undefined;
  state.otherHome = '';
  state.handlers.clear();
  state.callbacks.clear();
  state.windows.length = 0;
  vi.stubEnv('ELECTRON_LOG_FILE', '');
  vi.stubEnv('ELECTRON_RENDERER_URL', '');
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    state.messages.push(args);
  });
});

afterEach(async () => {
  await Promise.allSettled(state.boots.splice(0));
  await Promise.allSettled(state.requests.splice(0));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  const errors: unknown[] = [];
  for (const resources of state.allocated.splice(0).reverse()) {
    try {
      resources.cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, '测试资源清理失败');
  expect(state.messages.flat().join(' ')).not.toContain('fixture-sensitive');
});

async function launch(): Promise<void> {
  await expect(import('../testing/main')).resolves.toBeDefined();
}

describe('独立测试入口编排', () => {
  it('创建真实目录并设置所有隔离路径后才启动，启动后保留目录', async () => {
    await launch();
    expect(state.events).toEqual([
      'resources', 'home', 'userData', 'sessionData', 'crashDumps', 'logs', 'bootstrap',
    ]);
    expect(state.allocated).toHaveLength(1);
    const resources = state.allocated[0];
    for (const name of ['home', 'userData', 'sessionData', 'crashDumps', 'logs'] as const) {
      expect(state.paths.get(name)).toBe(resources[name]);
      expect(fs.statSync(resources[name]).isDirectory()).toBe(true);
    }
    expect(state.paths.size).toBe(5);
    expect(state.messages).toContainEqual(['隔离测试目录：', resources.root]);
    expect(state.exit).not.toHaveBeenCalled();
    expect(fs.existsSync(resources.root)).toBe(true);
  });

  it.each([
    'packaged', 'ready', 'user-data-dir', 'disk-cache-dir', 'log-file', 'ELECTRON_LOG_FILE',
  ])('拒绝不受支持的启动状态或路径覆盖：%s', async kind => {
    if (kind === 'packaged') state.packaged = true;
    else if (kind === 'ready') state.ready = true;
    else if (kind === 'ELECTRON_LOG_FILE') vi.stubEnv(kind, 'fixture-sensitive');
    else state.switches.add(kind);
    await launch();
    expect(state.allocated).toHaveLength(0);
    expect(state.events).toEqual([]);
    expect(state.paths.size).toBe(0);
    expect(state.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('资源创建失败时不设置路径或启动', async () => {
    state.failures.add('resources');
    await launch();
    expect(state.events).toEqual(['resources']);
    expect(state.allocated).toHaveLength(0);
    expect(state.paths.size).toBe(0);
    expect(state.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it.each(['home', 'userData', 'sessionData', 'crashDumps', 'logs'])(
    '设置 %s 失败时清理本次资源且不启动',
    async name => {
      state.failures.add(name);
      await launch();
      expect(state.allocated).toHaveLength(1);
      expect(state.events).not.toContain('bootstrap');
      expect(state.events.at(-1)).toBe('cleanup');
      expect(fs.existsSync(state.allocated[0].root)).toBe(false);
      expect(state.exit).toHaveBeenCalledExactlyOnceWith(1);
    },
  );

  it('清理失败时保留目录并单独报告，不暴露异常正文', async () => {
    state.failures.add('sessionData');
    state.failures.add('cleanup');
    await launch();
    expect(state.allocated).toHaveLength(1);
    expect(fs.existsSync(state.allocated[0].root)).toBe(true);
    expect(state.messages).toContainEqual(['隔离测试资源清理失败']);
    expect(state.messages).toContainEqual(['隔离测试入口初始化失败']);
    expect(state.events).not.toContain('bootstrap');
    expect(state.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('开始启动后同步异常不删除可能正在使用的目录', async () => {
    state.failures.add('bootstrap');
    await launch();
    expect(state.allocated).toHaveLength(1);
    expect(state.events.at(-1)).toBe('bootstrap');
    expect(state.events).not.toContain('cleanup');
    expect(fs.existsSync(state.allocated[0].root)).toBe(true);
    expect(state.exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});

const entry = { model: 'isolated-model', base_url: 'https://example.invalid', key: 'fixture-key', channel: '' };
const seed = (home: string, model: string) => {
  fs.mkdirSync(join(home, '.claude'));
  fs.writeFileSync(join(home, 'change-ai-config.json'), JSON.stringify([{ ...entry, model }]), { mode: 0o600 });
  fs.writeFileSync(join(home, '.claude/settings.json'), '{}\n', { mode: 0o600 });
  fs.writeFileSync(join(home, '.zshrc'), '# isolated\n', { mode: 0o600 });
};
const capture = (home: string) => ['change-ai-config.json', '.claude/settings.json', '.zshrc']
  .map(name => {
    const path = join(home, name);
    const stat = fs.statSync(path, { bigint: true });
    return { text: fs.readFileSync(path, 'utf8'), ino: stat.ino, mtimeNs: stat.mtimeNs, mode: stat.mode };
  });

const configChannels = ['config:state', 'config:apply', 'config:add', 'config:edit', 'config:remove'];
const channels = [...configChannels, 'clipboard:writeText'];
const failure = (code: string) => ({ success: false, code, cleanupFailed: false });
const clipboardFailure = (code: string) => ({ success: false, code });
const eventFor = (window: TestWindow) => ({
  sender: window.webContents, senderFrame: window.frame,
});
const currentWindow = () => {
  const window = state.windows.at(-1);
  assert.ok(window);
  return window;
};
const request = (channel: string, event: unknown, ...args: unknown[]): Promise<unknown> => {
  const listener = state.handlers.get(channel);
  assert.ok(listener, `未注册 ${channel}`);
  const result: Promise<unknown> = Promise.resolve(listener(event as IpcMainInvokeEvent, ...args));
  state.requests.push(result);
  return result;
};
const closeWindow = (window: TestWindow) => {
  window.destroyed = true;
  window.callbacks.get('closed')?.();
};
const startReal = async () => {
  state.realBootstrap = true;
  await launch();
  expect(state.boots).toHaveLength(1);
  return await state.boots[0];
};

function pendingWrite() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe.skipIf(process.getuid?.() === 0 || process.geteuid?.() === 0)(
  '隔离入口到真实业务 home',
  () => {
    it('没有配置文件也可初始化，启动阶段不访问业务文件', async () => {
      state.realBootstrap = true;
      const lstat = vi.spyOn(fsp, 'lstat');
      const open = vi.spyOn(fsp, 'open');
      const readFile = vi.spyOn(fsp, 'readFile');
      await launch();
      expect(state.boots).toHaveLength(1);
      assert.ok(await state.boots[0]);
      const { home } = state.allocated[0];
      expect(fs.readdirSync(home)).toEqual([]);
      for (const operation of [lstat, open, readFile]) {
        expect(operation.mock.calls.some(([path]) => String(path).startsWith(home))).toBe(false);
      }
      expect(state.userInfo).not.toHaveBeenCalled();
      expect(state.quit).not.toHaveBeenCalled();
      expect(state.events).toContain('window');
      expect([...state.handlers.keys()]).toEqual(channels);
      expect(state.events.indexOf('handle:clipboard:writeText'))
        .toBeLessThan(state.events.indexOf('window'));
      expect(state.writeText).not.toHaveBeenCalled();
      expect(await request('config:state', eventFor(currentWindow()), {}))
        .toEqual(failure('FILE_MISSING'));
    });

    it.skipIf(process.platform !== 'darwin')(
      '真实配置读写仅使用 resources.home，不回退账户、环境或 Electron home',
      async () => {
        const actual = await vi.importActual<typeof import('../testing/resources')>('../testing/resources');
        const other = actual.createTestResources();
        state.allocated.push(other);
        seed(other.home, 'other-model');
        const untouched = capture(other.home);
        state.otherHome = other.home;
        vi.stubEnv('HOME', other.home);
        state.prepare = resources => seed(resources.home, entry.model);
        state.realBootstrap = true;
        await launch();
        expect(state.boots).toHaveLength(1);
        const service = await state.boots[0];
        assert.ok(service);
        const resources = state.allocated[1];
        const before = capture(resources.home);
        const event = eventFor(currentWindow());
        expect(await request('config:state', event, {})).toMatchObject({
          success: true, data: { entries: [entry] },
        });
        const added = { ...entry, model: 'added-model' };
        expect(await request('config:add', event, { entry: added })).toEqual({ success: true });
        expect(await request('config:apply', event, {
          expected: { model: entry.model, base_url: entry.base_url, key: entry.key },
        })).toEqual({ success: true });
        const after = capture(resources.home);
        expect(JSON.parse(after[0].text)).toEqual([entry, added]);
        expect(after[2].text).toContain('export ANTHROPIC_MODEL=isolated-model\n');
        expect(after[1]).toEqual(before[1]);
        const edited = { ...added, model: 'edited-model' };
        expect(await request('config:edit', event, {
          index: 1,
          expected: { model: added.model, base_url: added.base_url, key: added.key },
          entry: edited,
        })).toEqual({ success: true });
        expect(JSON.parse(capture(resources.home)[0].text)).toEqual([entry, edited]);
        expect(await request('config:remove', event, {
          index: 1,
          expected: { model: edited.model, base_url: edited.base_url, key: edited.key },
        })).toEqual({ success: true });
        expect(JSON.parse(capture(resources.home)[0].text)).toEqual([entry]);
        expect(capture(resources.home)[1]).toEqual(before[1]);
        expect(capture(other.home)).toEqual(untouched);
        expect(state.userInfo).not.toHaveBeenCalled();
        expect(state.exit).not.toHaveBeenCalled();
        expect(state.quit).not.toHaveBeenCalled();
      },
    );

    it.each(channels)(
      '注册冲突 %s 仅回滚本次成功项，不覆盖原 handler',
      async channel => {
        const existing = vi.fn();
        state.handlers.set(channel, existing);
        expect(await startReal()).toBeUndefined();
        expect([...state.handlers.entries()]).toEqual([[channel, existing]]);
        expect(state.events.filter(step => step.startsWith('remove:')))
          .toEqual(channels.slice(0, channels.indexOf(channel)).map(name => `remove:${name}`));
        expect(state.windows).toHaveLength(0);
        expect(state.quit).toHaveBeenCalledOnce();
        expect(state.writeText).not.toHaveBeenCalled();
      },
    );

    it.each(['', 'http://127.0.0.1:5173/'])(
      '注册 listener 绑定实际加载目标：%s',
      async developmentUrl => {
        vi.stubEnv('ELECTRON_RENDERER_URL', developmentUrl);
        assert.ok(await startReal());
        const window = currentWindow();
        expect(window.frame.url).toBe(developmentUrl || 'cc-model-switch://app/index.html');
        expect(await request('config:state', eventFor(window), {}))
          .toEqual(failure('FILE_MISSING'));
        expect(await request('clipboard:writeText', eventFor(window), 'fixture-text'))
          .toEqual({ success: true });
        expect(state.writeText).toHaveBeenCalledExactlyOnceWith('fixture-text');
      },
    );

    it.each(['sender', 'subframe', 'origin', 'url', 'detached', 'destroyed'])(
      '注册 listener 拒绝非法来源：%s',
      async kind => {
        assert.ok(await startReal());
        const window = currentWindow();
        const event = eventFor(window);
        if (kind === 'sender') event.sender = { ...window.webContents };
        else if (kind === 'subframe') event.senderFrame = { ...window.frame };
        else if (kind === 'origin') window.frame.origin = 'https://example.invalid';
        else if (kind === 'url') window.frame.url += '?outside=1';
        else if (kind === 'detached') window.frame.detached = true;
        else window.destroyed = true;
        expect(await request('config:state', event, {})).toEqual(failure('FORBIDDEN'));
        expect(await request('clipboard:writeText', event, 'fixture-text'))
          .toEqual(clipboardFailure('FORBIDDEN'));
        expect(state.writeText).not.toHaveBeenCalled();
      },
    );

    it('注册 listener 保留全部参数，非法参数不访问配置', async () => {
      assert.ok(await startReal());
      const event = eventFor(currentWindow());
      for (const args of [[], [{}, {}], [{ home: '../outside' }]]) {
        expect(await request('config:state', event, ...args)).toEqual(failure('INVALID_REQUEST'));
      }
    });

    it('剪贴板接线保留参数数量与原始文本，不传入额外原生选项', async () => {
      assert.ok(await startReal());
      const event = eventFor(currentWindow());
      for (const args of [[], ['text', undefined], ['text', 'selection'], [{}], ['a\0b']]) {
        expect(await request('clipboard:writeText', event, ...args))
          .toEqual(clipboardFailure('INVALID_REQUEST'));
      }
      expect(await request('clipboard:writeText', event, 'a'.repeat(1_048_577)))
        .toEqual(clipboardFailure('BODY_TOO_LARGE'));
      expect(state.writeText).not.toHaveBeenCalled();
      const { clipboard } = await import('electron');
      for (const text of ['', ' \t中文 😀\r\n ']) {
        expect(await request('clipboard:writeText', event, text)).toEqual({ success: true });
      }
      expect(state.writeText.mock.calls).toEqual([[''], [' \t中文 😀\r\n ']]);
      expect(state.writeText.mock.contexts).toEqual([clipboard, clipboard]);
    });

    it.each(['sync', 'async'])('原生 writer %s 失败脱敏、不重试并释放名额', async mode => {
      assert.ok(await startReal());
      state.writeText.mockImplementationOnce(() => {
        if (mode === 'sync') throw new Error('fixture-sensitive');
        return Promise.reject(new Error('fixture-sensitive'));
      });
      const event = eventFor(currentWindow());
      expect(await request('clipboard:writeText', event, 'first'))
        .toEqual(clipboardFailure('CLIPBOARD_WRITE_FAILED'));
      expect(state.writeText.mock.calls).toEqual([['first']]);
      expect(await request('clipboard:writeText', event, 'next')).toEqual({ success: true });
      expect(state.writeText.mock.calls).toEqual([['first'], ['next']]);
    });

    it.each([
      ['window', 'resolve'], ['window', 'reject'],
      ['quit', 'resolve'], ['quit', 'reject'],
    ])('在途剪贴板遇到 %s 后等待原生 %s，不重置名额或声称取消', async (stage, mode) => {
      assert.ok(await startReal());
      const old = currentWindow();
      const listener = state.handlers.get('clipboard:writeText');
      assert.ok(listener);
      const gate = pendingWrite();
      state.writeText.mockReturnValueOnce(gate.promise);
      const settled = vi.fn();
      const first = request('clipboard:writeText', eventFor(old), 'first')
        .then(value => { settled(); return value; });
      try {
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();
        expect(await request('config:state', eventFor(old), {})).toEqual(failure('FILE_MISSING'));
        if (stage === 'window') {
          closeWindow(old);
          state.callbacks.get('activate')?.();
          const next = currentWindow();
          expect(next).not.toBe(old);
          old.callbacks.get('closed')?.();
          expect(await request('clipboard:writeText', eventFor(next), 'next'))
            .toEqual(clipboardFailure('RATE_LIMITED'));
          expect(state.events.filter(step => step.startsWith('handle:')))
            .toEqual(channels.map(channel => `handle:${channel}`));
          expect(state.events.some(step => step.startsWith('remove:'))).toBe(false);
        } else {
          state.callbacks.get('will-quit')?.();
          expect(state.handlers.size).toBe(0);
        }
        expect(await listener(eventFor(old) as IpcMainInvokeEvent, 'late'))
          .toEqual(clipboardFailure('FORBIDDEN'));
        expect(settled).not.toHaveBeenCalled();
        expect(state.writeText.mock.calls).toEqual([['first']]);
      } finally {
        if (mode === 'resolve') gate.resolve();
        else gate.reject(new Error('fixture-sensitive'));
        await Promise.allSettled([gate.promise, first]);
      }
      expect(await first).toEqual(mode === 'resolve'
        ? { success: true } : clipboardFailure('CLIPBOARD_WRITE_FAILED'));
      expect(state.writeText.mock.calls).toEqual([['first']]);
      if (stage === 'window') {
        expect(await request('clipboard:writeText', eventFor(currentWindow()), 'after'))
          .toEqual({ success: true });
        expect(state.writeText.mock.calls).toEqual([['first'], ['after']]);
      }
    });

    it('窗口重建复用注册与名额，旧窗口及迟到关闭回调不影响新窗口', async () => {
      state.prepare = resources => seed(resources.home, entry.model);
      assert.ok(await startReal());
      const old = currentWindow();
      const pending = request('config:state', eventFor(old), {});
      closeWindow(old);
      state.callbacks.get('activate')?.();
      const next = currentWindow();
      expect(next).not.toBe(old);
      old.callbacks.get('closed')?.();
      for (const channel of configChannels) {
        expect(await request(channel, eventFor(next), {})).toEqual(failure('RATE_LIMITED'));
      }
      expect(await request('clipboard:writeText', eventFor(next), 'fixture-text'))
        .toEqual({ success: true });
      expect(state.writeText).toHaveBeenCalledExactlyOnceWith('fixture-text');
      expect(await request('config:state', eventFor(old), {})).toEqual(failure('FORBIDDEN'));
      expect(await pending).toMatchObject({ success: true, data: { entries: [entry] } });
      expect(await request('config:state', eventFor(next), {}))
        .toMatchObject({ success: true, data: { entries: [entry] } });
      expect(state.events.filter(step => step.startsWith('handle:')))
        .toEqual(channels.map(channel => `handle:${channel}`));
      expect(state.events.some(step => step.startsWith('remove:'))).toBe(false);
    });

    it.each(['initial', 'activate'])(
      '%s 加载失败清理通道、停用来源，后续 activate 不重建',
      async stage => {
        if (stage === 'activate') {
          assert.ok(await startReal());
          closeWindow(currentWindow());
        }
        state.failures.add('window');
        if (stage === 'initial') expect(await startReal()).toBeUndefined();
        else {
          state.callbacks.get('activate')?.();
          await vi.waitFor(() => expect(state.quit).toHaveBeenCalledOnce());
        }
        expect(state.handlers.size).toBe(0);
        expect(state.events.filter(step => step.startsWith('remove:')))
          .toEqual(channels.map(channel => `remove:${channel}`));
        const count = state.windows.length;
        state.failures.clear();
        state.callbacks.get('activate')?.();
        state.callbacks.get('will-quit')?.();
        expect(state.windows).toHaveLength(count);
        expect(state.events.filter(step => step.startsWith('remove:'))).toHaveLength(channels.length);
        expect(state.quit).toHaveBeenCalledOnce();
      },
    );

    it('退出清理幂等，已捕获的 listener 也不能继续使用旧来源', async () => {
      assert.ok(await startReal());
      const listener = state.handlers.get('config:state');
      const clipboardListener = state.handlers.get('clipboard:writeText');
      assert.ok(listener);
      assert.ok(clipboardListener);
      const unrelated = vi.fn();
      state.handlers.set('unrelated:fixture', unrelated);
      const event = eventFor(currentWindow());
      state.callbacks.get('will-quit')?.();
      state.callbacks.get('will-quit')?.();
      expect([...state.handlers.entries()]).toEqual([['unrelated:fixture', unrelated]]);
      expect(state.events.filter(step => step.startsWith('remove:')))
        .toEqual(channels.map(channel => `remove:${channel}`));
      expect(await listener(event as IpcMainInvokeEvent, {})).toEqual(failure('FORBIDDEN'));
      expect(await clipboardListener(event as IpcMainInvokeEvent, 'fixture-text'))
        .toEqual(clipboardFailure('FORBIDDEN'));
      expect(state.writeText).not.toHaveBeenCalled();
      state.callbacks.get('activate')?.();
      expect(state.windows).toHaveLength(1);
    });
  },
);
