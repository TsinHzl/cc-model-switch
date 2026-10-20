/* 模型切换 + 配置管理单页：分组列表 / 激活高亮 / 内联增删改 / 写入位置选择 / 确认弹窗 / 执行反馈 */
import { useCallback, useMemo, useState } from 'react';
import { useConfigState, type WriteTarget } from '../lib/configStore';
import { authorizeFile, FILE_METAS, reauthorize, writeFileAtomic } from '../lib/fileAccess';
import type { ConfigEntry } from '../lib/applyConfig';
import type { GroupedConfig } from '../lib/configModel';
import { maskKey } from '../lib/maskKey';
import { EntryForm, type EditMode, type AddPreset } from './EntryForm';
import { ConfirmDelete } from './ConfirmDelete';

/** 写回磁盘：保持 4 空格缩进 + 末尾换行（与现有手工编辑格式一致） */
function serializeConfigs(entries: ConfigEntry[]): string {
  return `${JSON.stringify(entries, null, 4)}\n`;
}

/** 三元组相等（与激活判定同口径） */
function sameEntry(a: ConfigEntry, b: ConfigEntry): boolean {
  return a.model === b.model && a.base_url === b.base_url && a.key === b.key;
}

export default function ModelSwitch() {
  const { status, reload, applyModel } = useConfigState();
  const [showKeys, setShowKeys] = useState(false);
  const [pending, setPending] = useState<ConfigEntry | null>(null);
  const [target, setTarget] = useState<WriteTarget>('zshrc');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [editing, setEditing] = useState<EditMode>(null);
  const [deleting, setDeleting] = useState<{ entry: ConfigEntry; index: number } | null>(null);

  const showToast = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

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

  /** 复制条目 API Key 到剪贴板，成功/失败均 toast 反馈 */
  const copyKey = async (entry: ConfigEntry) => {
    try {
      await navigator.clipboard.writeText(entry.key);
      showToast('ok', `已复制 ${entry.model} 的 API Key`);
    } catch (err) {
      showToast('err', `复制失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** 基于磁盘最新内容做增量修改（防外部并发编辑被覆盖）；带写前三元组一致性校验（防 index 漂移） */
  const mutateDisk = useCallback(
    async (
      mutator: (latest: ConfigEntry[]) => ConfigEntry[],
      expect: { index: number; entry: ConfigEntry } | null,
      successText: string,
    ) => {
      try {
        await writeFileAtomic('config', (latest) => {
          const parsed = JSON.parse(latest) as ConfigEntry[];
          if (expect) {
            const current = parsed[expect.index];
            if (!current || !sameEntry(current, expect.entry)) {
              throw new Error('文件已被外部修改，所选条目位置变化——已中止写入，请刷新后重试');
            }
          }
          return serializeConfigs(mutator(parsed));
        });
        await reload();
        showToast('ok', successText);
      } catch (err) {
        showToast('err', err instanceof Error ? err.message : String(err));
      }
    },
    [reload, showToast],
  );

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
          <button className="btn btn-primary" onClick={() => setEditing({ kind: 'add' })}>
            ＋ 新增配置
          </button>
        </div>
      </header>

      {status.kind === 'loading' && <p className="hint">读取中…</p>}
      {status.kind === 'error' && <ErrorPane message={status.message} needAuth={status.needAuth} onRetry={reload} />}
      {status.kind === 'json-error' && <JsonErrorPane raw={status.raw} />}
      {status.kind === 'ready' && (
        <>
          <p className="hint">
            共 {status.state.entries.length} 条 · {status.state.groups.length} 个 URL 分组
          </p>
          <GroupList
            groups={status.state.groups}
            activeIndex={status.state.activeIndex}
            showKeys={showKeys}
            onPick={setPending}
            onEdit={(index, entry) => setEditing({ kind: 'edit', item: { entry, index } })}
            onDelete={(index, entry) => setDeleting({ index, entry })}
            onAdd={(preset) => setEditing({ kind: 'add', preset })}
            onCopyKey={(entry) => void copyKey(entry)}
          />
        </>
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

      {editing && (
        <EntryForm
          mode={editing}
          showKeys={showKeys}
          onCancel={() => setEditing(null)}
          onSubmit={async (entry) => {
            const mode = editing;
            setEditing(null);
            if (mode.kind === 'add') {
              await mutateDisk((list) => [...list, entry], null, `已新增 ${entry.model}`);
            } else {
              await mutateDisk(
                (list) => list.map((e, i) => (i === mode.item.index ? entry : e)),
                { index: mode.item.index, entry: mode.item.entry },
                `已保存 ${entry.model}`,
              );
            }
          }}
        />
      )}

      {deleting && (
        <ConfirmDelete
          entry={deleting.entry}
          showKeys={showKeys}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            const item = deleting;
            setDeleting(null);
            await mutateDisk(
              (list) => list.filter((_, i) => i !== item.index),
              { index: item.index, entry: item.entry },
              `已删除 ${item.entry.model}`,
            );
          }}
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
  onEdit,
  onDelete,
  onAdd,
  onCopyKey,
}: {
  groups: GroupedConfig[];
  activeIndex: number;
  showKeys: boolean;
  onPick: (entry: ConfigEntry) => void;
  onEdit: (index: number, entry: ConfigEntry) => void;
  onDelete: (index: number, entry: ConfigEntry) => void;
  onAdd: (preset: AddPreset) => void;
  onCopyKey: (entry: ConfigEntry) => void;
}) {
  return (
    <div className="groups">
      {groups.map((g) => (
        <section className="group-card" key={g.url}>
          <div className="group-url-row">
            <h2 className="group-url">{g.url}</h2>
            <button className="btn btn-sm" title="在该 URL 下新增配置" onClick={() => onAdd({ baseUrl: g.url })}>
              ＋ 新增
            </button>
          </div>
          {g.channels.map((c) => (
            <div className="channel" key={c.channel}>
              <div className="channel-row">
                <h3 className="channel-name">{c.channel}</h3>
                <button
                  className="btn btn-sm"
                  title="在该渠道下新增配置（Base URL、渠道与 key 锁定）"
                  onClick={() =>
                    onAdd({
                      baseUrl: g.url,
                      channel: c.channel === '默认渠道' ? '' : c.channel,
                      key: c.items[0]?.entry.key || undefined,
                    })
                  }
                >
                  ＋ 新增
                </button>
              </div>
              <ul className="model-list">
                {c.items.map(({ entry, index }) => {
                  const active = index === activeIndex;
                  return (
                    <li key={index}>
                      <div
                        className={`model-item${active ? ' active' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => onPick(entry)}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onPick(entry);
                          }
                        }}
                      >
                        <span className="model-name">
                          {active && (
                            <span className="active-dot" title="当前激活">
                              ●
                            </span>
                          )}
                          {entry.model}
                        </span>
                        <code className="model-key">{showKeys ? entry.key : maskKey(entry.key)}</code>
                        {active ? <span className="badge">当前</span> : <span className="badge badge-ghost">切换</span>}
                        <span className="item-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="btn btn-sm"
                            title="复制该条目的 API Key"
                            onClick={(e) => {
                              e.stopPropagation();
                              onCopyKey(entry);
                            }}
                          >
                            复制
                          </button>
                          <button
                            className="btn btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEdit(index, entry);
                            }}
                          >
                            编辑
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(index, entry);
                            }}
                          >
                            删除
                          </button>
                        </span>
                      </div>
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
    <div className="modal-mask" role="dialog" aria-modal="true">
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
            <button className="btn" onClick={onRetry}>
              重试
            </button>
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
