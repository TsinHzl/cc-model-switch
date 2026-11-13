/* chatStore 单元测试：用可控 storage 替身覆盖保存/恢复/删除/清空/配置/降级/剥离附件 data。 */
import { describe, expect, it, vi } from 'vitest';
import {
  clearSessions,
  deleteSession,
  listSessions,
  loadActiveId,
  loadChatConfig,
  loadSession,
  loadSessionModel,
  saveActiveId,
  saveChatConfig,
  saveSession,
} from '../chatStore';
import type { ChatMessage } from '../chatTypes';

/** 记录所有写入的可控 storage 替身；setItem 可配置抛错模拟配额 / 隐私模式。 */
function memoryStorage(failOnWrite = false) {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      if (failOnWrite) throw new Error('QuotaExceededError');
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
    snapshot() {
      return Object.fromEntries(map);
    },
  };
}

const asAttachment = (overrides: Partial<NonNullable<ChatMessage['attachments']>[number]> = {}) => ({
  id: 'a1', kind: 'image' as const, name: 'x.png', mediaType: 'image/png', size: 10,
  data: 'base64data', ...overrides,
});

function message(role: 'user' | 'assistant', content: string, attach = false): ChatMessage {
  return {
    id: role + content.length, role, content, status: 'done',
    ...(attach ? { attachments: [asAttachment()] } : {}),
    ...(role === 'assistant' ? { reasoning: 'think', usage: { input: 1, output: 2, cached: 0 } } : {}),
  };
}

describe('chatStore', () => {
  it('新建会话写入索引与消息，并可在重启后恢复', () => {
    const storage = memoryStorage();
    const input = {
      id: null,
      title: '标题',
      createdAt: 100,
      model: 'm1:https://gw',
      messages: [message('user', 'hello'), message('assistant', 'hi')],
    };
    const saved = saveSession(storage, input);
    expect(saved.degraded).toBe(false);
    expect(saved.id).toBeTruthy();
    expect(listSessions(storage).sessions).toEqual([{
      id: saved.id, title: '标题', updatedAt: expect.any(Number), messageCount: 2,
    }]);
    const restored = loadSession(storage, saved.id);
    expect(restored.map(m => m.content)).toEqual(['hello', 'hi']);
  });

  it('保存时剥离附件 data，仅保留展示占位', () => {
    const storage = memoryStorage();
    const saved = saveSession(storage, {
      id: null, title: 't', createdAt: 0, model: '',
      messages: [message('user', 'q', true), message('assistant', 'a')],
    });
    const restored = loadSession(storage, saved.id);
    expect(restored[0]!.attachments?.[0]).toEqual({
      id: 'a1', kind: 'image', name: 'x.png', mediaType: 'image/png', size: 10, data: '',
    });
    // 附件 data 不再出现在任何落盘文本中
    expect(JSON.stringify(storage.snapshot())).not.toContain('base64data');
  });

  it('覆盖既有会话保留同一 id 且替换消息', () => {
    const storage = memoryStorage();
    const a = saveSession(storage, { id: null, title: 'a', createdAt: 0, model: '', messages: [message('user', '1')] });
    const b = saveSession(storage, { id: a.id, title: 'b', createdAt: 0, model: '', messages: [message('user', '2')] });
    expect(b.id).toBe(a.id);
    expect(listSessions(storage).sessions).toHaveLength(1);
    expect(loadSession(storage, a.id).map(m => m.content)).toEqual(['2']);
  });

  it('删除会话更新索引并清理内容与活动指向', () => {
    const storage = memoryStorage();
    const a = saveSession(storage, { id: null, title: 'a', createdAt: 0, model: '', messages: [message('user', '1')] });
    const b = saveSession(storage, { id: null, title: 'b', createdAt: 0, model: '', messages: [message('user', '2')] });
    saveActiveId(storage, a.id);
    deleteSession(storage, a.id);
    expect(listSessions(storage).sessions.map(s => s.id)).toEqual([b.id]);
    expect(loadSession(storage, a.id)).toEqual([]);
    expect(loadActiveId(storage)).toBeNull();
  });

  it('清空全部会话移除索引、内容与活动指向', () => {
    const storage = memoryStorage();
    const a = saveSession(storage, { id: null, title: 'a', createdAt: 0, model: '', messages: [message('user', '1')] });
    const b = saveSession(storage, { id: null, title: 'b', createdAt: 0, model: '', messages: [message('user', '2')] });
    saveActiveId(storage, a.id);
    clearSessions(storage);
    expect(listSessions(storage).sessions).toEqual([]);
    expect(loadSession(storage, a.id)).toEqual([]);
    expect(loadSession(storage, b.id)).toEqual([]);
    expect(loadActiveId(storage)).toBeNull();
  });

  it('配置保存与恢复；损坏时回默认', () => {
    const storage = memoryStorage();
    expect(loadChatConfig(storage)).toEqual({ model: '', effort: 'off', webSearch: true });
    saveChatConfig(storage, { model: 'm', effort: 'high', webSearch: false });
    expect(loadChatConfig(storage)).toEqual({ model: 'm', effort: 'high', webSearch: false });
  });

  it('写入失败降级为内存并标记 degraded，不抛异常', () => {
    const storage = memoryStorage(true);
    const saved = saveSession(storage, {
      id: null, title: 't', createdAt: 0, model: '', messages: [message('user', 'q')],
    });
    expect(saved.degraded).toBe(true);
    expect(listSessions(storage).sessions).toEqual([]);
    expect(loadSession(storage, saved.id)).toEqual([]);
  });

  it('索引损坏时读取为空列表但不视为降级', () => {
    const storage = memoryStorage();
    storage.setItem('ccms.chat.v1.sessions', '{broken');
    expect(listSessions(storage)).toEqual({ degraded: false, sessions: [] });
  });

  it('会话模型随会话保存并可单独读取', () => {
    const storage = memoryStorage();
    const saved = saveSession(storage, {
      id: null, title: 't', createdAt: 0,
      model: 'deepseek-flash:https://gw',
      messages: [message('user', 'q')],
    });
    expect(loadSessionModel(storage, saved.id)).toBe('deepseek-flash:https://gw');
  });

  it('覆盖会话时更新其模型', () => {
    const storage = memoryStorage();
    const a = saveSession(storage, {
      id: null, title: 'a', createdAt: 0,
      model: 'deepseek-flash:https://gw',
      messages: [message('user', '1')],
    });
    saveSession(storage, {
      id: a.id, title: 'a', createdAt: 0,
      model: 'glm-5.3-flash:https://gw',
      messages: [message('user', '2')],
    });
    expect(loadSessionModel(storage, a.id)).toBe('glm-5.3-flash:https://gw');
  });

  it('旧版会话无模型字段时读取为 null（回退全局配置）', () => {
    const storage = memoryStorage();
    storage.setItem('ccms.chat.v1.session:legacy', JSON.stringify({
      id: 'legacy', title: 't', createdAt: 0, updatedAt: 0,
      messages: [message('user', 'q')],
    }));
    expect(loadSessionModel(storage, 'legacy')).toBeNull();
  });

  it('缺失 / 损坏的会话模型读取为 null', () => {
    const storage = memoryStorage();
    expect(loadSessionModel(storage, 'missing')).toBeNull();
    storage.setItem('ccms.chat.v1.session:bad', '{broken');
    expect(loadSessionModel(storage, 'bad')).toBeNull();
  });

  it('会话列表按最近更新降序，修正在存储中的写入顺序', () => {
    const storage = memoryStorage();
    // 模拟旧数据：索引按写入顺序（旧→新）保存。
    storage.setItem('ccms.chat.v1.sessions', JSON.stringify([
      { id: 'a', title: 'a', updatedAt: 100, messageCount: 1 },
      { id: 'b', title: 'b', updatedAt: 300, messageCount: 1 },
      { id: 'c', title: 'c', updatedAt: 200, messageCount: 1 },
    ]));
    expect(listSessions(storage).sessions.map(s => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('同一 updatedAt 的会话保持原有相对顺序', () => {
    const storage = memoryStorage();
    storage.setItem('ccms.chat.v1.sessions', JSON.stringify([
      { id: 'a', title: 'a', updatedAt: 100, messageCount: 1 },
      { id: 'b', title: 'b', updatedAt: 100, messageCount: 1 },
    ]));
    expect(listSessions(storage).sessions.map(s => s.id)).toEqual(['a', 'b']);
  });

  it('保存新会话后排在最前，覆盖既有会话更新其位置', () => {
    const storage = memoryStorage();
    // 同毫秒内两次保存的 updatedAt 相同，稳定排序会保留写入顺序；用假时钟拉开时间。
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const a = saveSession(storage, { id: null, title: 'a', createdAt: 0, model: '', messages: [message('user', '1')] });
      vi.setSystemTime(2_000);
      const b = saveSession(storage, { id: null, title: 'b', createdAt: 0, model: '', messages: [message('user', '2')] });
      expect(listSessions(storage).sessions.map(s => s.id)).toEqual([b.id, a.id]);
      // 重新保存 a 时 updatedAt 变大，应回到最前。
      vi.setSystemTime(3_000);
      saveSession(storage, { id: a.id, title: 'a', createdAt: 0, model: '', messages: [message('user', '3')] });
      expect(listSessions(storage).sessions[0]!.id).toBe(a.id);
      expect(listSessions(storage).sessions.map(s => s.id)).toEqual([a.id, b.id]);
    } finally {
      vi.useRealTimers();
    }
  });
});