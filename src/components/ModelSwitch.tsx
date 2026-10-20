/* 模型切换界面：分组列表 / 激活高亮 / 写入位置选择 / 确认弹窗 / 执行反馈 */
import { useMemo, useState } from 'react';
import { useConfigState, type WriteTarget } from '../lib/configStore';
import { authorizeFile, FILE_METAS, reauthorize } from '../lib/fileAccess';
import type { ConfigEntry } from '../lib/applyConfig';
import type { GroupedConfig } from '../lib/configModel';

/** key 脱敏：保留前 6 后 4；短 key（≤12 位）按长度缩进保留量，不再整串明文 */
export function maskKey(key: string): string {
  if (key.length <= 4) return '•'.repeat(key.length);
  const head = key.slice(0, Math.min(6, Math.max(3, key.length - 2)));
  const tail = key.slice(-Math.min(4, Math.max(2, key.length - 3)));
  return `${head}${'•'.repeat(Math.min(12, Math.max(4, key.length - head.length - tail.length)))}${tail}`;
}

export default function ModelSwitch({ onOpenEditor }: { onOpenEditor: () => void }) {
  const { status, reload, applyModel } = useConfigState();
  const [showKeys, setShowKeys] = useState(false);
  const [pending, setPending] = useState<ConfigEntry | null>(null);
  const [target, setTarget] = useState<WriteTarget>('zshrc');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const showToast = (kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 4000);
  };

  const confirmApply = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await applyModel(pending, target);
      setPending(null);
      showToast('ok', `已切换到 ${pending.model}（${target === 'zshrc' ? 'zshrc 标记块' : 'settings.json env'}）`);
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>模型切换</h1>
          <p className="page-sub">与 ~/change-ai-config.sh 行为一致：写入 zshrc 标记块或 settings.json env，互斥清理</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setShowKeys((v) => !v)}>
            {showKeys ? '🙈 隐藏 key' : '👁 显示 key'}
          </button>
          <button className="btn" onClick={() => void reload()}>
            ⟳ 刷新
          </button>
          <button className="btn" onClick={onOpenEditor}>
            ✎ 配置管理
          </button>
        </div>
      </header>

      {status.kind === 'loading' && <p className="hint">读取中…</p>}
      {status.kind === 'error' && <ErrorPane message={status.message} needAuth={status.needAuth} onRetry={reload} />}
      {status.kind === 'json-error' && <JsonErrorPane raw={status.raw} />}
      {status.kind === 'ready' && (
        <GroupList
          groups={status.state.groups}
          activeIndex={status.state.activeIndex}
          showKeys={showKeys}
          onPick={setPending}
        />
      )}

      {pending && (
        <ConfirmDialog
          entry={pending}
          target={target}
          onTarget={setTarget}
          busy={busy}
          showKeys={showKeys}
          onCancel={() => setPending(null)}
          onConfirm={() => void confirmApply()}
        />
      )}
      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}

function GroupList({
  groups,
  activeIndex,
  showKeys,
  onPick,
}: {
  groups: GroupedConfig[];
  activeIndex: number;
  showKeys: boolean;
  onPick: (entry: ConfigEntry) => void;
}) {
  return (
    <div className="groups">
      {groups.map((g) => (
        <section className="group-card" key={g.url}>
          <h2 className="group-url">{g.url}</h2>
          {g.channels.map((c) => (
            <div className="channel" key={c.channel}>
              <h3 className="channel-name">{c.channel}</h3>
              <ul className="model-list">
                {c.items.map(({ entry, index }) => {
                  // index 是原数组下标（分组结构携带），激活判定与 key 均基于它
                  const active = index === activeIndex;
                  return (
                    <li key={index}>
                      <button
                        className={`model-item${active ? ' active' : ''}`}
                        onClick={() => onPick(entry)}
                      >
                        <span className="model-name">
                          {active && <span className="active-dot" title="当前激活">●</span>}
                          {entry.model}
                        </span>
                        <code className="model-key">{showKeys ? entry.key : maskKey(entry.key)}</code>
                        {active ? <span className="badge">当前</span> : <span className="badge badge-ghost">切换</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function ConfirmDialog({
  entry,
  target,
  onTarget,
  busy,
  showKeys,
  onCancel,
  onConfirm,
}: {
  entry: ConfigEntry;
  target: WriteTarget;
  onTarget: (t: WriteTarget) => void;
  busy: boolean;
  showKeys: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-mask" role="dialog" aria-modal>
      <div className="modal">
        <h2>确认切换</h2>
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
          <dt>渠道</dt>
          <dd>{entry.channel || '默认渠道'}</dd>
        </dl>
        <fieldset className="target-picker">
          <legend>写入位置</legend>
          <label className="radio">
            <input type="radio" name="target" checked={target === 'zshrc'} onChange={() => onTarget('zshrc')} />
            <span>
              <strong>~/.zshrc 标记块</strong>
              <small>块置顶插入，并清理 settings.json env 键</small>
            </span>
          </label>
          <label className="radio">
            <input type="radio" name="target" checked={target === 'settings'} onChange={() => onTarget('settings')} />
            <span>
              <strong>~/.claude/settings.json env</strong>
              <small>jq 兼容格式写入 7 键，并删除 zshrc 标记块</small>
            </span>
          </label>
        </fieldset>
        <p className="hint">切换后已打开的终端不会即时生效，新开的 shell / Claude 会话生效。</p>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={busy}>
            {busy ? '写入中…' : '确认切换'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ErrorPane({
  message,
  needAuth,
  onRetry,
}: {
  message: string;
  needAuth: boolean | undefined;
  onRetry: () => void;
}) {
  const [authorizing, setAuthorizing] = useState(false);
  const [authStep, setAuthStep] = useState('');
  const [authError, setAuthError] = useState('');

  /** 逐文件授权：每个文件一轮点击（picker 消耗 transient activation，一次点击无法连开 3 个选择器）；异常捕获并提示进度，不静默失败 */
  const doAuthorize = async () => {
    setAuthorizing(true);
    setAuthError('');
    let done = 0;
    for (const meta of FILE_METAS) {
      try {
        setAuthStep(`${done + 1}/${FILE_METAS.length}：请在选择器中打开 ${meta.pathHint}（隐藏文件用 Cmd+Shift+.）`);
        await reauthorize(meta.key).catch(() => authorizeFile(meta));
        done += 1;
      } catch {
        setAuthError(`已授权 ${done}/${FILE_METAS.length}，${meta.pathHint} 未完成——再次点击按钮继续`);
        break;
      }
    }
    setAuthorizing(false);
    setAuthStep('');
    if (done === FILE_METAS.length) onRetry();
  };

  return (
    <div className="pane pane-error">
      <h2>无法读取文件</h2>
      <p>{message}</p>
      {needAuth !== false && (
        <>
          <p className="hint">首次使用需依次授权 3 个文件（每个文件一次点击）；macOS 选择器中按 Cmd+Shift+. 可显示 .zshrc 等隐藏文件。</p>
          {authError && (
            <p className="field-error" role="alert">
              {authError}
            </p>
          )}
          <div className="pane-actions">
            <button className="btn btn-primary" onClick={() => void doAuthorize()} disabled={authorizing}>
              {authorizing ? `授权中… ${authStep}` : '重新授权 / 授权文件'}
            </button>
            <button className="btn" onClick={onRetry}>重试</button>
          </div>
        </>
      )}
    </div>
  );
}

function JsonErrorPane({ raw }: { raw: string }) {
  const lines = useMemo(() => raw.split('\n').length, [raw]);
  return (
    <div className="pane pane-error">
      <h2>change-ai-config.json 解析失败</h2>
      <p>JSON 已损坏（{lines} 行），请手工修复该文件后点刷新。</p>
      <pre className="raw-view">{raw.slice(0, 2000)}</pre>
    </div>
  );
}
