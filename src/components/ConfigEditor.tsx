/* 配置管理界面：表单化增/改/删 + key 脱敏切换 + JSON 损坏错误态 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { readFileText, writeFileAtomic } from '../lib/fileAccess';
import { groupConfigs } from '../lib/configModel';
import type { ConfigEntry } from '../lib/applyConfig';
import { maskKey } from './ModelSwitch';

/** 写回磁盘：保持 4 空格缩进 + 末尾换行（与现有手工编辑格式一致） */
function serializeConfigs(entries: ConfigEntry[]): string {
  return `${JSON.stringify(entries, null, 4)}\n`;
}

/** 三元组相等（与激活判定同口径） */
function sameEntry(a: ConfigEntry, b: ConfigEntry): boolean {
  return a.model === b.model && a.base_url === b.base_url && a.key === b.key;
}

/** 条目的稳定内存 id（仅渲染 key 用，不落盘） */
interface Item {
  entry: ConfigEntry;
  /** 原数组下标（写前比对用） */
  index: number;
  /** 内存 uuid，条目在本次加载会话内的稳定标识 */
  uid: string;
}

function withMeta(entries: ConfigEntry[]): Item[] {
  return entries.map((entry, index) => ({ entry, index, uid: crypto.randomUUID() }));
}

type EditMode = { kind: 'add' } | { kind: 'edit'; item: Item } | null;

export default function ConfigEditor({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [rawText, setRawText] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const [editing, setEditing] = useState<EditMode>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const showToast = (kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 4000);
  };

  const reload = useCallback(async () => {
    try {
      const text = await readFileText('config');
      const parsed = JSON.parse(text) as ConfigEntry[];
      if (!Array.isArray(parsed)) throw new Error('顶层不是数组');
      setItems(withMeta(parsed));
      setJsonError(null);
    } catch (err) {
      setItems(null);
      setJsonError(err instanceof Error ? err.message : String(err));
      setRawText(await readFileText('config').catch(() => ''));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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
    [reload],
  );

  const groups = useMemo(() => (items ? groupConfigs(items.map((i) => i.entry)) : []), [items]);
  const itemByRef = useMemo(() => {
    const map = new Map<ConfigEntry, Item>();
    items?.forEach((it) => map.set(it.entry, it));
    return map;
  }, [items]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>配置管理</h1>
          <p className="page-sub">增/改/删 change-ai-config.json 条目，写回保持原格式（4 空格缩进）</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setShowKeys((v) => !v)}>
            {showKeys ? '🙈 隐藏 key' : '👁 显示 key'}
          </button>
          <button className="btn" onClick={() => void reload()}>
            ⟳ 刷新
          </button>
          <button className="btn" onClick={onBack}>
            ← 模型切换
          </button>
        </div>
      </header>

      {jsonError && (
        <div className="pane pane-error">
          <h2>JSON 解析失败</h2>
          <p>{jsonError}</p>
          <p className="hint">修复文件后点刷新，或直接编辑原文：</p>
          <pre className="raw-view">{rawText.slice(0, 4000)}</pre>
        </div>
      )}

      {items && !jsonError && (
        <>
          <div className="pane">
            <div className="pane-row">
              <span className="hint">
                共 {items.length} 条 · {groups.length} 个 URL 分组
              </span>
              <button className="btn btn-primary" onClick={() => setEditing({ kind: 'add' })}>
                ＋ 新增配置
              </button>
            </div>
          </div>

          {groups.map((g) => (
            <section className="group-card" key={g.url}>
              <h2 className="group-url">{g.url}</h2>
              {g.channels.map((c) => (
                <div className="channel" key={c.channel}>
                  <h3 className="channel-name">{c.channel}</h3>
                  <ul className="model-list">
                    {c.items.map(({ entry }) => {
                      const item = itemByRef.get(entry)!;
                      return (
                        <li key={item.uid}>
                          <div className="model-item static">
                            <span className="model-name">{entry.model}</span>
                            <code className="model-key">{showKeys ? entry.key : maskKey(entry.key)}</code>
                            <span className="item-actions">
                              <button className="btn btn-sm" onClick={() => setEditing({ kind: 'edit', item })}>
                                编辑
                              </button>
                              <button className="btn btn-sm btn-danger" onClick={() => setDeleting(item)}>
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
        </>
      )}

      {editing && (
        <EntryForm
          mode={editing}
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

function EntryForm({
  mode,
  onCancel,
  onSubmit,
}: {
  mode: { kind: 'add' } | { kind: 'edit'; item: Item };
  onCancel: () => void;
  onSubmit: (entry: ConfigEntry) => Promise<void>;
}) {
  const initial: ConfigEntry =
    mode.kind === 'edit' ? mode.item.entry : { base_url: '', key: '', model: '', channel: '' };
  const [form, setForm] = useState<ConfigEntry>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof ConfigEntry, string>>>({});
  const [busy, setBusy] = useState(false);

  const set = (field: keyof ConfigEntry) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((er) => ({ ...er, [field]: undefined }));
  };

  const validate = (): boolean => {
    const er: Partial<Record<keyof ConfigEntry, string>> = {};
    if (!form.base_url.trim()) er.base_url = '必填';
    else if (!/^https?:\/\//.test(form.base_url.trim())) er.base_url = '需以 http(s):// 开头';
    if (!form.key.trim()) er.key = '必填';
    if (!form.model.trim()) er.model = '必填';
    setErrors(er);
    return Object.keys(er).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      await onSubmit({
        base_url: form.base_url.trim(),
        key: form.key.trim(),
        model: form.model.trim(),
        channel: form.channel.trim(),
      });
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, name: keyof ConfigEntry, placeholder: string) => (
    <label className="form-field">
      <span>
        {label}
        {name !== 'channel' && <em className="req">*</em>}
      </span>
      <input value={form[name]} onChange={set(name)} placeholder={placeholder} autoFocus={name === 'base_url'} />
      {errors[name] && <em className="field-error">{errors[name]}</em>}
    </label>
  );

  return (
    <div className="modal-mask" role="dialog" aria-modal>
      <div className="modal">
        <h2>{mode.kind === 'add' ? '新增配置' : `编辑：${initial.model}`}</h2>
        <div className="form-grid">
          {field('Base URL', 'base_url', 'https://example.com')}
          {field('API Key', 'key', 'sk-…')}
          {field('模型', 'model', 'claude-opus-5')}
          {field('渠道（可选）', 'channel', '留空则归入"默认渠道"')}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDelete({
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
    <div className="modal-mask" role="dialog" aria-modal>
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
