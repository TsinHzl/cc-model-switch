/* 附件预览块：带缩略图 / 文件名 / 大小的可移除标签。 */
import type { Attachment } from '../../lib/chatTypes';
import { formatFileSize, imageDataUrl } from '../../lib/attachments';

export function AttachmentView({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  const isText = attachment.kind === 'text';
  return (
    <div className="attachment-chip">
      {isText ? (
        <span className="attachment-type">TXT</span>
      ) : (
        <img className="attachment-thumb" src={imageDataUrl(attachment)} alt={attachment.name} />
      )}
      <span className="attachment-meta">
        <span className="attachment-name" title={attachment.name}>{attachment.name}</span>
        <span className="attachment-size">{formatFileSize(attachment.size)}</span>
      </span>
      <button type="button" className="attachment-remove" title="移除附件" aria-label={`移除 ${attachment.name}`} onClick={onRemove}>
        ×
      </button>
    </div>
  );
}