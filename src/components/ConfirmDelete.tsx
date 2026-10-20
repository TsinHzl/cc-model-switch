/* 删除确认弹窗 */
import { useState } from 'react';
import type { ConfigEntry } from '../lib/applyConfig';
import { maskKey } from '../lib/maskKey';

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
  return (
    <div className="modal-mask" role="dialog" aria-modal="true">
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
          <button className="btn" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              setBusy(true);
              void onConfirm().finally(() => setBusy(false));
            }}
            disabled={busy}
          >
            {busy ? '删除中…' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  );
}
