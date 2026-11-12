/* 清空全部历史前的确认弹窗。 */
export function ConfirmClearAll({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-mask" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>清空全部历史</h2>
        <p>将删除本地保存的全部 {count} 个会话，此操作不可撤销。</p>
        <p className="hint">只清除本机浏览器存储中的对话记录，不影响模型配置与终端环境。</p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            确认清空
          </button>
        </div>
      </div>
    </div>
  );
}
