/* 模型切换 + 配置管理单页：分组列表 / 激活高亮 / 内联增删改 / 确认弹窗 / 执行反馈 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConfigState } from '../lib/configStore';
import { ApiError, addEntry, updateEntry, deleteEntry } from '../lib/apiClient';
import { clipboardErrorMessage, writeClipboardText } from '../lib/clipboardClient';
import type { ConfigEntry } from '../lib/applyConfig';
import { copyEnvToClipboard } from '../lib/envClipboard';
import type { GroupedConfig } from '../lib/configModel';
import { maskKey } from '../lib/maskKey';
import { latencyText, measureLatency } from '../lib/measureLatency';
import { EntryForm, type EditMode, type AddPreset } from './EntryForm';
import { ConfirmDelete } from './ConfirmDelete';
import { useModalClose } from './useModalClose';
import pkg from '../../package.json';

export default function ModelSwitch() {
  const { status, reload, applyModel } = useConfigState();
  const platform = typeof window === 'undefined' ? undefined : window.desktop?.platform;
  const envCopyTitle = platform === 'win32'
    ? '复制 7 行 PowerShell 当前会话赋值文本（不持久化）'
    : platform === 'darwin' || platform === 'linux'
      ? '复制 7 行 ANTHROPIC_* export'
      : '当前平台未知或不受支持，无法复制 Env';
  const [showKeys, setShowKeys] = useState(false);
  const [pending, setPending] = useState<ConfigEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [editing, setEditing] = useState<EditMode>(null);
  const [deleting, setDeleting] = useState<{ entry: ConfigEntry; index: number } | null>(null);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  /** ⌘K / Ctrl+K 聚焦搜索框（纯快捷键装饰，不做命令面板） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const confirmApply = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const refreshed = await applyModel(pending);
      setPending(null);
      const message = `已写入 ${pending.model}（zshrc 标记块）`;
      showToast(refreshed ? 'ok' : 'err', refreshed
        ? message : `${message}，但状态刷新失败；请重试读取，不要重复写入。`);
    } catch (err) {
      // 弹窗已播完退场动画处于不可见态，必须卸载，否则下次打开会带着关闭态复活。
      // 失败信息由 toast 给出，并明确要求先核对状态、不要重复写入。
      setPending(null);
      showToast('err', err instanceof ApiError ? err.message : '操作结果无法确认，请刷新状态核对，不要重复写入。');
    } finally {
      setBusy(false);
    }
  };
  /** 复制条目 API Key 到剪贴板，成功/失败均 toast 反馈 */
  const copyKey = async (entry: ConfigEntry) => {
    try {
      await writeClipboardText(entry.key);
      showToast('ok', `已复制 ${entry.model} 的 API Key`);
    } catch (err) {
      showToast('err', clipboardErrorMessage(err));
    }
  };

  /** 复制条目完整 JSON（四字段）到剪贴板 */
  const copyEntryJson = async (entry: ConfigEntry) => {
    try {
      await writeClipboardText(JSON.stringify(entry, null, 2));
      showToast('ok', `已复制 ${entry.model} 的完整配置`);
    } catch (err) {
      showToast('err', clipboardErrorMessage(err));
    }
  };

  /** 按桌面平台复制当前会话环境变量文本，不执行或持久化。 */
  const copyEnv = async (entry: ConfigEntry) => {
    try {
      const result = await copyEnvToClipboard(entry, platform);
      if (!result.ok) {
        showToast('err', result.code === 'UNSUPPORTED_PLATFORM'
          ? '无法识别或不支持当前平台，未提交 Env 复制请求。'
          : '配置包含 Windows Env 文本不支持的字符，未提交复制请求。');
        return;
      }
      showToast('ok', result.format === 'powershell'
        ? '已复制 7 行 PowerShell 环境变量赋值文本；执行后仅作用于当前会话，不持久化。'
        : '已复制 7 行 ANTHROPIC_* export');
    } catch (err) {
      showToast('err', clipboardErrorMessage(err));
    }
  };

  /** 服务端校验最新内容并写入；刷新失败不能当成写入失败。 */
  const mutateDisk = useCallback(
    async (
      mutation: () => Promise<void>,
      successText: string,
    ) => {
      try {
        await mutation();
        const refreshed = await reload();
        showToast(refreshed ? 'ok' : 'err', refreshed
          ? successText : `${successText}，但状态刷新失败；请重试读取，不要重复写入。`);
      } catch (err) {
        showToast('err', err instanceof ApiError ? err.message : '操作结果无法确认，请刷新状态核对，不要重复写入。');
      }
    },
    [reload, showToast],
  );

  return (
    <div className="page">
      <header className="page-header">
        <div className="title-group">
          <div className="title-row">
            <div className="title-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
            <h1>模型切换</h1>
            <span className="version-tag">v{pkg.version}</span>
          </div>
          <div className="subtitle">
            <span>
              配置列表：<code>~/change-ai-config.json</code>；当前仅支持 macOS 写入，
              切换只更新 <code>~/.zshrc</code> 标记块，不修改 settings.json
            </span>
            {platform === 'win32' && (
              <span>
                复制 Env 仅生成 PowerShell 5.1 / 7.x 赋值文本，不会自动执行；执行后仅影响当前会话，不写入持久配置。
                空值在 5.1、7.0–7.4 中删除对应环境变量，7.5 起保留为空字符串。
              </span>
            )}
            {status.kind === 'ready' && (
              <span className="stats-badge">
                共 {status.state.entries.length} 条 · {status.state.groups.length} 个 URL 分组
              </span>
            )}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn" title={showKeys ? '隐藏完整密钥' : '查看完整密钥'} onClick={() => setShowKeys((v) => !v)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {showKeys ? '隐藏 Key' : '显示 Key'}
          </button>
          <button className="btn" title="刷新状态" onClick={() => void reload()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            刷新
          </button>
          <button className="btn btn-primary" onClick={() => setEditing({ kind: 'add' })}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            新增配置
          </button>
        </div>
      </header>

      {status.kind === 'loading' && <p className="hint">读取中…</p>}
      {status.kind === 'error' && <ErrorPane message={status.message} onRetry={reload} />}
      {status.kind === 'ready' && (
        <>
          {status.state.activeIndex >= 0 ? (
            <ActiveHero
              entry={status.state.entries[status.state.activeIndex]!}
              showKeys={showKeys}
              envCopyTitle={envCopyTitle}
              onCopyEnv={(entry) => void copyEnv(entry)}
            />
          ) : (
            <div className="pane">
              <h2>未匹配到激活配置</h2>
              <p>当前激活信息未匹配到列表条目；settings.json 中的配置优先用于识别激活状态。</p>
            </div>
          )}
          <FilterBar
            query={query}
            onQuery={setQuery}
            total={status.state.entries.length}
            searchRef={searchRef}
          />
          <GroupList
            groups={status.state.groups}
            activeIndex={status.state.activeIndex}
            showKeys={showKeys}
            query={query}
            onPick={setPending}
            onEdit={(index, entry) => setEditing({ kind: 'edit', item: { entry, index } })}
            onDelete={(index, entry) => setDeleting({ index, entry })}
            onAdd={(preset) => setEditing({ kind: 'add', preset })}
            onCopyKey={(entry) => void copyKey(entry)}
            onCopyJson={(entry) => void copyEntryJson(entry)}
          />
        </>
      )}

      {pending && (
        <ConfirmDialog
          entry={pending}
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
              await mutateDisk(() => addEntry(entry), `已新增 ${entry.model}`);
            } else {
              await mutateDisk(
                () => updateEntry(mode.item.index, mode.item.entry, entry),
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
              () => deleteEntry(item.index, item.entry),
              `已删除 ${item.entry.model}`,
            );
          }}
        />
      )}

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}

/** Hero 激活卡片：脉冲徽标 + 模型名 + 网关/分组/密钥 meta + 真实一次性测速 + 复制 Env */
function ActiveHero({
  entry,
  showKeys,
  envCopyTitle,
  onCopyEnv,
}: {
  entry: ConfigEntry;
  showKeys: boolean;
  envCopyTitle: string;
  onCopyEnv: (entry: ConfigEntry) => void;
}) {
  const [latency, setLatency] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLatency(undefined);
    void measureLatency(entry.base_url).then((ms) => {
      if (!cancelled) setLatency(ms);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.base_url]);

  return (
    <div className="active-hero">
      <div className="active-hero-left">
        <div className="active-pulse-badge">
          <span className="pulse-dot" />
          ACTIVE CURRENT
        </div>
        <div className="active-details">
          <h2>{entry.model}</h2>
          <div className="meta">
            <span>网关: {entry.base_url}</span>
            <span>分组: {entry.channel || '默认渠道'}</span>
            <span>密钥: {showKeys ? entry.key : maskKey(entry.key)}</span>
          </div>
        </div>
      </div>
      <div className="active-hero-right">
        <div className="latency-pill" title="仅测 HTTP(S) 响应时延，不代表模型 API 可用；不跟随重定向，网络或浏览器安全限制可能导致测速失败">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          {latencyText(latency)}
        </div>
        <button className="btn btn-sm" title={envCopyTitle} onClick={() => onCopyEnv(entry)}>
          复制 Env
        </button>
      </div>
    </div>
  );
}

/** 搜索框：⌘K 快捷键装饰 + 包含匹配过滤 */
function FilterBar({
  query,
  onQuery,
  total,
  searchRef,
}: {
  query: string;
  onQuery: (q: string) => void;
  total: number;
  searchRef: React.RefObject<HTMLInputElement>;
}) {
  return (
    <div className="filter-bar">
      <div className="search-input-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={searchRef}
          type="text"
          className="search-input"
          placeholder="输入模型名称、分组名或代理 URL 快速检索..."
          aria-label="输入模型名称、分组名或代理 URL 快速检索"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
        <span className="kbd-shortcut">⌘ K</span>
      </div>
      <span className="endpoint-count">共 {total} 条</span>
    </div>
  );
}

function GroupList({
  groups,
  activeIndex,
  showKeys,
  query,
  onPick,
  onEdit,
  onDelete,
  onAdd,
  onCopyKey,
  onCopyJson,
}: {
  groups: GroupedConfig[];
  activeIndex: number;
  showKeys: boolean;
  query: string;
  onPick: (entry: ConfigEntry) => void;
  onEdit: (index: number, entry: ConfigEntry) => void;
  onDelete: (index: number, entry: ConfigEntry) => void;
  onAdd: (preset: AddPreset) => void;
  onCopyKey: (entry: ConfigEntry) => void;
  onCopyJson: (entry: ConfigEntry) => void;
}) {
  /** 渲染层过滤：不改动 groups 数据结构（items[].index 语义驱动激活/编辑/删除）；字段防御空值（手工编辑 JSON 可能缺字段） */
  const q = query.trim().toLowerCase();
  const match = (entry: ConfigEntry): boolean =>
    !q ||
    (entry.model ?? '').toLowerCase().includes(q) ||
    (entry.channel ?? '').toLowerCase().includes(q) ||
    (entry.base_url ?? '').toLowerCase().includes(q);
  const filtered = q
    ? groups
        .map((g) => ({
          url: g.url,
          channels: g.channels
            .map((c) => ({ channel: c.channel, items: c.items.filter(({ entry }) => match(entry)) }))
            .filter((c) => c.items.length > 0),
        }))
        .filter((g) => g.channels.length > 0)
    : groups;

  if (q && filtered.length === 0) {
    return (
      <div className="pane">
        <h2>没有匹配的配置</h2>
        <p>关键词「{query.trim()}」未命中任何模型名、渠道或 URL。</p>
      </div>
    );
  }

  return (
    <div className="groups">
      {filtered.map((g) => (
        <section className="endpoint-card" key={g.url}>
          <div className="endpoint-header">
            <div className="endpoint-url">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span>{g.url}</span>
              <span className="endpoint-count">({g.channels.reduce((n, c) => n + c.items.length, 0)}个模型)</span>
            </div>
            <div className="endpoint-actions">
              <button className="btn btn-sm" title="在该 URL 下新增配置" onClick={() => onAdd({ baseUrl: g.url })}>
                + 添加端点模型
              </button>
            </div>
          </div>
          {g.channels.map((c) => (
            <div className="subgroup" key={c.channel}>
              <div className="subgroup-header">
                <div className="subgroup-title">{c.channel}</div>
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
                  + 快速加模型
                </button>
              </div>
              <div className="model-list">
                {c.items.map(({ entry, index }) => {
                  const active = index === activeIndex;
                  return (
                    <div
                      className={`model-row${active ? ' is-active' : ''}`}
                      key={index}
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
                      <div className="model-info">
                        <span className="model-name">{entry.model}</span>
                        <button
                          type="button"
                          className="key-box"
                          title="点击复制 Key"
                          onClick={(e) => {
                            e.stopPropagation();
                            onCopyKey(entry);
                          }}
                        >
                          <span>{showKeys ? entry.key : maskKey(entry.key)}</span>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        </button>
                      </div>
                      <div className="model-actions">
                        <button
                          type="button"
                          className={`btn-switch${active ? ' current' : ''}`}
                          disabled={active}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!active) onPick(entry);
                          }}
                        >
                          {active ? '● 当前使用中' : '切换'}
                        </button>
                        <div className="hover-actions">
                          <button
                            type="button"
                            className="btn-icon"
                            title="复制完整配置（JSON 四字段）"
                            aria-label={`复制 ${entry.model} 的完整配置`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onCopyJson(entry);
                            }}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="btn-icon"
                            title="编辑"
                            aria-label={`编辑 ${entry.model}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onEdit(index, entry);
                            }}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="btn-icon danger"
                            title="删除"
                            aria-label={`删除 ${entry.model}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(index, entry);
                            }}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function ConfirmDialog({
  entry,
  busy,
  showKeys,
  onCancel,
  onConfirm,
}: {
  entry: ConfigEntry;
  busy: boolean;
  showKeys: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // 写入由父级执行并负责置 busy；退场动画结束后才通知父级，避免弹窗瞬间消失。
  const actionRef = useRef<'cancel' | 'confirm' | null>(null);
  const { closing, requestClose, onAnimationEnd } = useModalClose(() => {
    if (actionRef.current === 'confirm') onConfirm();
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
          <dt>写入位置</dt>
          <dd><code>~/.zshrc</code> 标记块</dd>
        </dl>
        <p className="hint">仅更新 ~/.zshrc 标记块，不修改 settings.json；写入成功后，激活高亮仍可能由 settings.json 决定。</p>
        <p className="hint">已打开的终端不会即时生效，请在新开的 shell / Claude 会话中确认配置。</p>
        <div className="modal-actions">
          <button className="btn" onClick={() => close('cancel')} disabled={busy || closing}>
            取消
          </button>
          <button className="btn btn-primary" onClick={() => close('confirm')} disabled={busy || closing}>
            {busy ? '写入中…' : '确认切换'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ErrorPane({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => Promise<boolean>;
}) {
  return (
    <div className="pane pane-error">
      <h2>无法读取本机配置</h2>
      <p>{message}</p>
      <p className="hint">请检查桌面应用与本地配置后重新读取；若此前执行过写入，请先核对结果，不要直接重复写入。</p>
      <div className="pane-actions">
        <button className="btn btn-primary" onClick={() => void onRetry()}>
          重新读取
        </button>
      </div>
    </div>
  );
}
