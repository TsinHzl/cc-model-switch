/* 受限 Markdown 渲染：react-markdown + remark-gfm；不启用 raw HTML、链接仅 http(s)、图片降级为文本。 */
import { useMemo, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** 仅放行 http(s) 链接；其余协议返回空串，react-markdown 会渲染为纯文本。 */
function safeUrl(value: string | undefined): string {
  if (value === undefined) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : '';
  } catch {
    return '';
  }
}

type AnchorProps = ComponentPropsWithoutRef<'a'>;

/** 链接只能在 http(s)/#外链时点击；否则降级为纯文本。 */
function Link(props: AnchorProps) {
  const href = safeUrl(props.href);
  if (!href) return <span>{props.children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {props.children}
    </a>
  );
}

/** 图片降级为带链接/标题的文本占位，不发起远端请求。 */
function Image({
  alt,
  src,
  title,
}: ComponentPropsWithoutRef<'img'>) {
  const url = safeUrl(src ?? undefined);
  const label = alt || title || '图片';
  return <span className="chat-img-placeholder">{url ? `${label}〔${url}〕` : label}</span>;
}

export function Markdown({ text }: { text: string }) {
  const components = useMemo(() => ({ a: Link, img: Image }), []);
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={safeUrl}>
        {text}
      </ReactMarkdown>
    </div>
  );
}