/* 弹窗动画接入的静态渲染断言：node 环境无 DOM，只校验结构与关闭初态。
   交互时序由 modalClose.test.ts 的计时器测试覆盖。 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConfirmDelete } from '../ConfirmDelete';
import { EntryForm } from '../EntryForm';
import { ConfirmClearAll } from '../chat/ConfirmClearAll';

const entry = { model: 'm', base_url: 'https://example.invalid', key: 'sk-secret', channel: 'c' };

const noop = () => {};

describe('弹窗动画接入', () => {
  it('删除确认弹窗保留 dialog 语义且初始不带 is-closing', () => {
    const html = renderToStaticMarkup(createElement(ConfirmDelete, {
      entry, showKeys: false, onCancel: noop, onConfirm: async () => {},
    }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).not.toContain('is-closing');
    expect(html).toContain('删除配置');
    expect(html).toContain('确认删除');
  });

  it('表单弹窗保留字段与按钮文案，初始不带 is-closing', () => {
    const html = renderToStaticMarkup(createElement(EntryForm, {
      mode: { kind: 'edit', item: { entry, index: 0 } },
      showKeys: false, onCancel: noop, onSubmit: async () => {},
    }));
    expect(html).toContain('role="dialog"');
    expect(html).not.toContain('is-closing');
    expect(html).toContain('编辑：m');
    expect(html).toContain('保存');
    expect(html).toContain('取消');
  });

  it('清空历史弹窗保留数量提示与按钮文案，初始不带 is-closing', () => {
    const html = renderToStaticMarkup(createElement(ConfirmClearAll, {
      count: 3, onCancel: noop, onConfirm: noop,
    }));
    expect(html).toContain('role="dialog"');
    expect(html).not.toContain('is-closing');
    expect(html).toContain('3 个会话');
    expect(html).toContain('确认清空');
  });
});
