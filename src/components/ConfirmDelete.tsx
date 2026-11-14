/* 删除确认弹窗 */
import { useRef, useState } from 'react';
import type { ConfigEntry } from '../lib/applyConfig';
import { maskKey } from '../lib/maskKey';
import { useModalClose } from './useModalClose';

export function ConfirmDelete({
  entry,
  showKeys,
  onCancel,
  onConfirm,
}: {
  entry: ConfigEntry;
  showKeys: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  // 只有退场动画结束后才把动作交给父级，避免弹窗瞬间消失看不到动画。
  const actionRef = useRef<'cancel' | 'confirm' | null>(null);
  const { closing, requestClose, onAnimationEnd } = useModalClose(() => {
    if (actionRef.current === 'confirm') void onConfirm().finally(() => setBusy(false));
    else onCancel();
  });
  const close = (action: 'cancel' | 'confirm') => {
    if (closing) return;
    actionRef.current = action;
    requestClose();
  };
  return (
    <div
      className={`modal-mask${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      onAnimationEnd={onAnimationEnd}
    >
      <div className="modal">
        <h2>删除配置</h2>
        <dl className="confirm-grid">
          <dt>模型</dt>
          <dd>
            <strong>{entry.model}</strong>
          </dd>
          <dt>Base URL</dt>
          <dd>
            <code>{entry.base_url}</code>
          </dd>
          <dt>Key</dt>
          <dd>
            <code>{showKeys ? entry.key : maskKey(entry.key)}</code>
          </dd>
        </dl>
        <p className="hint">仅从 change-ai-config.json 删除该条目，不影响当前已激活的终端环境。</p>
        <div className="modal-actions">
          <button className="btn" onClick={() => close('cancel')} disabled={busy || closing}>
            取消
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              setBusy(true);
              close('confirm');
            }}
            disabled={busy || closing}
          >
            {busy ? '删除中…' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  );
}
