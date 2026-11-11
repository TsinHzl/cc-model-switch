/* Composer / MessageList / SessionsSidebar 静态渲染测试。 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Composer } from '../chat/Composer';
import { MessageItem } from '../chat/MessageList';
import { SessionsSidebar } from '../chat/SessionsSidebar';
import type { ChatMessage } from '../../lib/chatTypes';

const entry = { model: 'm', base_url: 'https://example.invalid', key: 'k', channel: '' };

const noop = () => {};

describe('Composer', () => {
  function render(opts: Partial<Parameters<typeof Composer>[0]> = {}) {
    return renderToStaticMarkup(createElement(Composer, {
      entries: [entry],
      model: 'm:https://example.invalid',
      effort: 'off',
      webSearch: false,
      isGenerating: false,
      onModelChange: noop,
      onEffortChange: noop,
      onWebSearchChange: noop,
      onSend: noop,
      onStop: noop,
      ...opts,
    }));
  }

  it('无模型时禁用发送并提示', () => {
    const html = render({ entries: [], model: '' });
    expect(html).toContain('无可用模型');
    expect(html).toContain('disabled');
  });

  it('生成中展示停止按钮', () => {
    const html = render({ isGenerating: true });
    expect(html).toContain('停止');
    expect(html).not.toContain('class="composer-send"');
  });
});

describe('MessageItem', () => {
  const assistant: ChatMessage = { id: 'x', role: 'assistant', content: 'hi', status: 'done' };

  it('错误消息展示错误文案', () => {
    const html = renderToStaticMarkup(createElement(MessageItem, {
      message: { ...assistant, status: 'error', error: '模型网关失败' },
      canRegenerate: false,
      onRegenerate: noop,
    }));
    expect(html).toContain('模型网关失败');
  });

  it('正常完成展示复制与用量', () => {
    const html = renderToStaticMarkup(createElement(MessageItem, {
      message: { ...assistant, usage: { input: 10, output: 20 } },
      canRegenerate: true,
      onRegenerate: noop,
    }));
    expect(html).toContain('复制');
    expect(html).toContain('重生成');
  });
});

describe('SessionsSidebar', () => {
  it('空历史提示', () => {
    const html = renderToStaticMarkup(createElement(SessionsSidebar, {
      sessions: [], activeId: null, locked: false,
      onNew: noop, onSelect: noop, onDelete: noop, onClearAll: noop,
    }));
    expect(html).toContain('暂无历史对话');
  });

  it('列出会话并区分活动项', () => {
    const html = renderToStaticMarkup(createElement(SessionsSidebar, {
      sessions: [{ id: 'a', title: '标题', updatedAt: 0, messageCount: 2 }],
      activeId: 'a', locked: false,
      onNew: noop, onSelect: noop, onDelete: noop, onClearAll: noop,
    }));
    expect(html).toContain('标题');
    expect(html).toContain('2 条');
    expect(html).toContain('is-active');
  });
});