import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { insertZshrcBlock, type ConfigEntry } from '../applyConfig';
import { loadConfigState, useConfigState } from '../configStore';
import type { FileKey } from '../fileAccess';
import { loadHandle } from '../handleStore';

vi.mock('../handleStore', () => ({
  loadHandle: vi.fn(),
  saveHandle: vi.fn(),
}));

const entry: ConfigEntry = {
  model: 'test-model',
  base_url: 'https://example.invalid',
  key: 'test-key',
  channel: 'test',
};
const previous = { ...entry, model: 'previous-model' };
const settingsText = `${JSON.stringify({
  env: {
    ANTHROPIC_MODEL: previous.model,
    ANTHROPIC_BASE_URL: previous.base_url,
    ANTHROPIC_AUTH_TOKEN: previous.key,
    KEEP: 'unchanged',
  },
}, null, 4)}\n`;

// 仅替换浏览器文件句柄，保留真实读取、原子写入和配置转换链路。
function makeFile(name: string, initial: string) {
  let disk = initial;
  const handle = {
    kind: 'file' as const,
    name,
    queryPermission: vi.fn(async () => 'granted' as const),
    requestPermission: vi.fn(async () => 'granted' as const),
    getFile: vi.fn(async () => new File([disk], name)),
    createWritable: vi.fn(async () => {
      let pending = disk;
      return {
        write: vi.fn(async (data: BufferSource | Blob | string) => {
          if (typeof data !== 'string') throw new Error('测试仅支持文本写入');
          pending = data;
        }),
        close: vi.fn(async () => { disk = pending; }),
        abort: vi.fn(async () => {}),
      };
    }),
  };
  return { handle, text: () => disk };
}

// 用真实 React 渲染取得回调；不模拟浏览器挂载或断言 UI 生命周期。
function getApplyModel() {
  const captured: ReturnType<typeof useConfigState>[] = [];
  function Probe() {
    captured.push(useConfigState());
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return captured[0]!.applyModel;
}

let files: Record<FileKey, ReturnType<typeof makeFile>>;

beforeEach(() => {
  vi.clearAllMocks();
  files = {
    config: makeFile('change-ai-config.json', JSON.stringify([previous, entry])),
    settings: makeFile('settings.json', settingsText),
    zshrc: makeFile('.zshrc', insertZshrcBlock('# shell config\n', previous)),
  };
  vi.mocked(loadHandle).mockImplementation(async (key) => {
    if (key === 'config' || key === 'settings' || key === 'zshrc') {
      return files[key].handle;
    }
    return undefined;
  });
});

describe('模型切换仅写 zshrc', () => {
  it.each([settingsText, '{ "env": { "KEEP": "unchanged" } }\n', '{broken'])(
    '保留 settings 原始文本，不创建其写入流（用例 %#）',
    async (text) => {
      files.settings = makeFile('settings.json', text);
      const configBefore = files.config.text();

      await getApplyModel()(entry);

      expect(files.zshrc.text()).toBe(insertZshrcBlock('# shell config\n', entry));
      expect(files.zshrc.handle.createWritable).toHaveBeenCalledTimes(1);
      expect(files.settings.text()).toBe(text);
      expect(files.settings.handle.createWritable).not.toHaveBeenCalled();
      expect(files.config.text()).toBe(configBefore);
      expect(files.config.handle.createWritable).not.toHaveBeenCalled();
    },
  );

  it('写入失败时透传错误，不尝试修改 settings', async () => {
    const error = new DOMException('Blocked by browser policy', 'SecurityError');
    files.zshrc.handle.createWritable.mockRejectedValueOnce(error);

    await expect(getApplyModel()(entry)).rejects.toBe(error);

    expect(files.zshrc.handle.createWritable).toHaveBeenCalledTimes(1);
    expect(files.settings.handle.createWritable).not.toHaveBeenCalled();
    expect(files.settings.text()).toBe(settingsText);
  });

  it('条目三元组已变更时拒绝写入', async () => {
    files.config = makeFile('change-ai-config.json', JSON.stringify([{ ...entry, key: 'changed' }]));

    await expect(getApplyModel()(entry)).rejects.toThrow('配置项已不存在或已被外部修改');

    for (const file of Object.values(files)) {
      expect(file.handle.createWritable).not.toHaveBeenCalled();
    }
  });

  it('保留 settings 优先的当前模型识别', async () => {
    await getApplyModel()(entry);

    expect((await loadConfigState()).activeIndex).toBe(0);
    expect(files.zshrc.text()).toBe(insertZshrcBlock('# shell config\n', entry));
    expect(files.settings.text()).toBe(settingsText);
  });
});
