/* 清空全部历史前的确认弹窗。 */
import { useRef } from 'react';
import { useModalClose } from '../useModalClose';

export function ConfirmClearAll({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // 退场动画结束后才通知父级清空，避免弹窗瞬间消失看不到动画。
  const confirmedRef = useRef(false);
  const { closing, requestClose, onAnimationEnd } = useModalClose(() => {
    if (confirmedRef.current) onConfirm();
    else onCancel();
  });
  const close = (confirm: boolean) => {
    if (closing) return;
    confirmedRef.current = confirm;
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
        <h2>清空全部历史</h2>
        <p>将删除本地保存的全部 {count} 个会话，此操作不可撤销。</p>
        <p className="hint">只清除本机浏览器存储中的对话记录，不影响模型配置与终端环境。</p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => close(false)} disabled={closing}>
            取消
          </button>
          <button type="button" className="btn btn-danger" onClick={() => close(true)} disabled={closing}>
            确认清空
          </button>
        </div>
      </div>
    </div>
  );
}
