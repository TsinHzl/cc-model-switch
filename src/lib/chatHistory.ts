/* 会话历史纯函数：标题推导与 message 恢复归一化。 */
import type { ChatMessage } from './chatTypes';

const TITLE_MAX_CHARS = 40;

/** 会话标题取第一条用户消息开头；只发附件时用第一个附件名。 */
export function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  const first = firstUser?.content.trim()
    ? firstUser.content
    : (firstUser?.attachments?.[0]?.name ?? '');
  return Array.from(first.replace(/\s+/g, ' ').trim()).slice(0, TITLE_MAX_CHARS).join('');
}

/** 流式中途被中断而遗留的 streaming 态（重启后不会再有数据）改记为已中断。 */
export function normalizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return (raw as ChatMessage[]).map(m =>
    m.status === 'streaming'
      ? { ...m, status: 'stopped' as const,
        searches: m.searches?.map(s => s.status === 'searching' ? { ...s, status: 'stopped' as const } : s) }
      : m,
  );
}