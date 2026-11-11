/* Markdown 组件受限渲染测试：raw HTML 转义、非 http(s) 链接降级、图片不产出 <img>。 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../chat/Markdown';

function render(text: string): string {
  return renderToStaticMarkup(createElement(Markdown, { text }));
}

describe('Markdown 受限渲染', () => {
  it('原始 HTML 被转义为纯文本，不产出可执行节点', () => {
    const html = render('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<script>/i);
    expect(html).not.toContain('<h2>');
  });

  it('http(s) 链接可点击，其他协议降级为纯文本', () => {
    const ok = render('[a](https://example.com)');
    expect(ok).toContain('href="https://example.com"');
    const bad = render('[a](javascript:alert(1))');
    expect(bad).not.toContain('href="');
    expect(bad).toContain('>a</span>');
  });

  it('图片语法不渲染 <img>，不产生远端请求', () => {
    const html = render('![alt](https://example.com/x.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('alt');
  });

  it('GFM 表格与代码块正常渲染', () => {
    const html = render('| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1\n```');
    expect(html).toContain('<table>');
    expect(html).toContain('<code');
  });
});