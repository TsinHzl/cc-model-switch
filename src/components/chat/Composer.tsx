/* 对话输入区：附件选择与预览、思考力度 / 联网搜索 / 模型选择、发送与停止。 */
import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { effortOptionsFor, normalizeEffort } from '../../lib/thinking';
import type { ChatEffort } from '../../lib/chatIpcContract';
import type { ChatMessage } from '../../lib/chatTypes';
import type { ConfigEntry } from '../../lib/applyConfig';
import { AttachmentError, MAX_ATTACHMENTS, MAX_TEXT_BYTES, processFile, formatFileSize } from '../../lib/attachments';
import { AttachmentView } from './AttachmentView';

export interface AttachmentInput {
  id: string;
  kind: 'image' | 'text';
  name: string;
  mediaType: string;
  size: number;
  data: string;
}

export function Composer({
  entries,
  model,
  effort,
  webSearch,
  isGenerating,
  onModelChange,
  onEffortChange,
  onWebSearchChange,
  onSend,
  onStop,
}: {
  entries: readonly ConfigEntry[];
  model: string;
  effort: ChatEffort;
  webSearch: boolean;
  isGenerating: boolean;
  onModelChange: (model: string) => void;
  onEffortChange: (effort: ChatEffort) => void;
  onWebSearchChange: (enabled: boolean) => void;
  onSend: (text: string, attachments: AttachmentInput[]) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<AttachmentInput[]>([]);
  const [processing, setProcessing] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effortOptions = effortOptionsFor(model);
  const displayEffort = normalizeEffort(model, effort);
  const canSend = (text.trim() !== '' || attachments.length > 0)
    && processing === 0 && model !== '' && !isGenerating;
  const attachFull = attachments.length + processing >= MAX_ATTACHMENTS;

  const setEffort = (value: ChatEffort) => onEffortChange(normalizeEffort(model, value));

  const submit = () => {
    if (!canSend) return;
    setError(null);
    onSend(text, attachments);
    setText('');
    setAttachments([]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit();
  };

  const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    const room = Math.max(0, MAX_ATTACHMENTS - attachments.length - processing);
    if (picked.length > room) setError(`最多附加 ${MAX_ATTACHMENTS} 个文件。`);
    const files = picked.slice(0, room);
    if (files.length === 0) return;
    setProcessing(n => n + files.length);
    const results = await Promise.all(files.map(async file => {
      try {
        return await processFile(file);
      } catch (err) {
        if (err instanceof AttachmentError) {
          setError(err.code === 'tooLarge'
            ? `${file.name} 超过文本上限 ${formatFileSize(MAX_TEXT_BYTES)}。`
            : err.code === 'unsupported' ? `${file.name} 类型不受支持。` : `无法读取 ${file.name}。`);
        }
        return null;
      }
    }));
    setAttachments(prev => [...prev, ...results.filter((a): a is AttachmentInput => a !== null)]);
    setProcessing(n => n - files.length);
  };

  return (
    <div className="composer">
      {(attachments.length > 0 || processing > 0) && (
        <div className="attachments-row">
          {attachments.map(a => (
            <AttachmentView
              key={a.id}
              attachment={a as NonNullable<ChatMessage['attachments']>[number]}
              onRemove={() => setAttachments(prev => prev.filter(x => x.id !== a.id))}
            />
          ))}
          {Array.from({ length: processing }, (_, i) => (
            <span key={`p-${i}`} className="attachment-chip attachment-pending">处理中…</span>
          ))}
        </div>
      )}
      {error && <p className="composer-error">{error}</p>}
      <textarea
        className="composer-input"
        value={text}
        rows={2}
        onChange={e => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="输入消息，Enter 发送，Shift+Enter 换行"
        autoComplete="off"
        spellCheck={false}
      />
      <div className="composer-bar">
        <button
          type="button"
          className="composer-pill"
          disabled={isGenerating || attachFull}
          title="添加附件（图片或文本）"
          onClick={() => fileInputRef.current?.click()}
        >
          附件
        </button>
        <input ref={fileInputRef} type="file" multiple hidden onChange={onFiles} />
        <label className="composer-pill">
          思考
          <select
            value={displayEffort}
            onChange={e => setEffort(e.target.value as ChatEffort)}
            disabled={isGenerating}
          >
            {effortOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <button
          type="button"
          className={`composer-pill${webSearch ? ' is-on' : ''}`}
          aria-pressed={webSearch}
          disabled={isGenerating}
          onClick={() => onWebSearchChange(!webSearch)}
        >
          联网搜索
        </button>
        <div className="composer-spacer" />
        <label className="composer-pill composer-model">
          模型
          <select
            value={model}
            onChange={e => onModelChange(e.target.value)}
            disabled={isGenerating || entries.length === 0}
          >
            {entries.length === 0 && <option value="">无可用模型</option>}
            {entries.map(e => (
              <option key={`${e.model}:${e.base_url}`} value={`${e.model}:${e.base_url}`}>
                {e.model}
              </option>
            ))}
          </select>
        </label>
        {isGenerating ? (
          <button type="button" className="composer-send is-stop" onClick={onStop} title="停止生成">
            停止
          </button>
        ) : (
          <button type="button" className="composer-send" disabled={!canSend} title="发送" onClick={submit}>
            发送
          </button>
        )}
      </div>
    </div>
  );
}