/* 模型切换 + 配置管理单页：分组列表 / 激活高亮 / 内联增删改 / 写入位置选择 / 确认弹窗 / 执行反馈 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConfigState, type WriteTarget } from '../lib/configStore';
import { authorizeFile, FILE_METAS, reauthorize, writeFileAtomic } from '../lib/fileAccess';
import { buildExportLines, type ConfigEntry } from '../lib/applyConfig';
import type { GroupedConfig } from '../lib/configModel';
import { maskKey } from '../lib/maskKey';
import { EntryForm, type EditMode, type AddPreset } from './EntryForm';
import { ConfirmDelete } from './ConfirmDelete';
import pkg from '../../package.json';

/** 写回磁盘：保持 4 空格缩进 + 末尾换行（与现有手工编辑格式一致） */
function serializeConfigs(entries: ConfigEntry[]): string {
  return `${JSON.stringify(entries, null, 4)}\n`;
}

/** 三元组相等（与激活判定同口径） */
function sameEntry(a: ConfigEntry, b: ConfigEntry): boolean {
  return a.model === b.model && a.base_url === b.base_url && a.key === b.key;
}

/** 一次性测速：HEAD 优先，失败/不支持回退 GET；AbortController 5s 超时；失败返回 null（显示 —） */
async function measureLatency(url: string): Promise<number | null> {
  const withTimeout = (init: RequestInit) => {
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 5000);
    return {
      ...init,
      signal: ctl.signal,
      timer,
      clear: () => window.clearTimeout(timer),
    } as RequestInit & { timer: number; clear: () => void };
  };
  const run = async (init: RequestInit): Promise<number | null> => {
    const t0 = performance.now();
    try {
      await fetch(url, init);
      return Math.round(performance.now() - t0);
    } catch {
      return null;
    }
  };
  const head = withTimeout({ method: 'HEAD', cache: 'no-store' });
  try {
    const ms = await run(head);
    if (ms !== null) return ms;
  } finally {
    head.clear?.();
  }
  const get = withTimeout({ cache: 'no-store' });
  try {
    return await run(get);
  } finally {
    get.clear?.();
  }
}

/** 测速结果展示文案：快慢分级与设计稿口径一致 */
function latencyText(ms: number): string {
  if (ms < 80) return `${ms}ms 响应极快`;
  if (ms < 300) return `${ms}ms 响应较快`;
  return `${ms}ms`;
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

  /** 复制条目完整 JSON（四字段）到剪贴板 */
  const copyEntryJson = async (entry: ConfigEntry) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
      showToast('ok', `已复制 ${entry.model} 的完整配置`);
    } catch (err) {
      showToast('err', `复制失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** 复制激活条目的 7 行 export 环境变量（与 zshrc 标记块内容一致） */
  const copyEnv = async (entry: ConfigEntry) => {
    try {
      await navigator.clipboard.writeText(`${buildExportLines(entry).join('\n')}\n`);
      showToast('ok', '已复制 7 行 ANTHROPIC_* export');
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
              与 <code>~/change-ai-config.sh</code> 联动：自动写入 zshrc 标记块与 settings.json env，互斥清理
            </span>
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
      {status.kind === 'error' && <ErrorPane message={status.message} needAuth={status.needAuth} onRetry={reload} />}
      {status.kind === 'json-error' && <JsonErrorPane raw={status.raw} />}
      {status.kind === 'ready' && (
        <>
          {status.state.activeIndex >= 0 ? (
            <ActiveHero
              entry={status.state.entries[status.state.activeIndex]!}
              showKeys={showKeys}
              onCopyEnv={(entry) => void copyEnv(entry)}
            />
          ) : (
            <div className="pane">
              <h2>当前无激活配置</h2>
              <p>settings.json env 与 zshrc 标记块均为空；在下方列表选择一个模型开始切换。</p>
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

/** Hero 激活卡片：脉冲徽标 + 模型名 + 网关/分组/密钥 meta + 真实一次性测速 + 复制 Env */
function ActiveHero({
  entry,
  showKeys,
  onCopyEnv,
}: {
  entry: ConfigEntry;
  showKeys: boolean;
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
        <div className="latency-pill" title="对网关发起一次 HEAD/GET 请求测得">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          {latency === undefined ? '测速中…' : latency === null ? '—' : latencyText(latency)}
        </div>
        <button className="btn btn-sm" title="复制 7 行 ANTHROPIC_* export" onClick={() => onCopyEnv(entry)}>
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
