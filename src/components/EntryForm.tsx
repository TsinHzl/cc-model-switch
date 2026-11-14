/* 配置条目表单：新增（可选预设锁定）/ 编辑，必填校验 */
import { useRef, useState } from 'react';
import type { ConfigEntry } from '../lib/applyConfig';
import { maskKey } from '../lib/maskKey';
import { useModalClose } from './useModalClose';

/** add 分支的预设锁定：URL 入口锁 base_url；渠道入口锁 base_url + channel */
export interface AddPreset {
  baseUrl: string;
  channel?: string;
  /** 渠道入口预填并锁定该渠道既有 key（通常同渠道共用同一 key） */
  key?: string;
}

/** add 预设解析：入口预设 → 表单初始值与锁定字段（纯函数，供单测） */
export function resolveAddPreset(preset: AddPreset): {
  initial: ConfigEntry;
  lockUrl: boolean;
  lockChannel: boolean;
  lockKey: boolean;
} {
  return {
    initial: { base_url: preset.baseUrl, key: preset.key ?? '', model: '', channel: preset.channel ?? '' },
    lockUrl: true,
    lockChannel: preset.channel !== undefined,
    lockKey: (preset.key ?? '') !== '',
  };
}

export type EditMode =
  | { kind: 'add'; preset?: AddPreset }
  | { kind: 'edit'; item: { entry: ConfigEntry; index: number } }
  | null;

export function EntryForm({
  mode,
  showKeys,
  onCancel,
  onSubmit,
}: {
  mode: Exclude<EditMode, null>;
  showKeys: boolean;
  onCancel: () => void;
  onSubmit: (entry: ConfigEntry) => Promise<void>;
}) {
  const initial: ConfigEntry =
    mode.kind === 'edit' ? mode.item.entry : { base_url: '', key: '', model: '', channel: '' };
  const presetResolved = mode.kind === 'add' && mode.preset ? resolveAddPreset(mode.preset) : null;
  const lockUrl = presetResolved?.lockUrl ?? false;
  const lockChannel = presetResolved?.lockChannel ?? false;
  const lockKey = presetResolved?.lockKey ?? false;
  // 锁定时首个可填字段顺延：base_url 锁 → key；key 也锁 → model
  const focusField: keyof ConfigEntry = lockUrl ? (lockKey ? 'model' : 'key') : 'base_url';
  const [form, setForm] = useState<ConfigEntry>(presetResolved?.initial ?? initial);
  const [errors, setErrors] = useState<Partial<Record<keyof ConfigEntry, string>>>({});
  const [busy, setBusy] = useState(false);
  // 提交需要带上动画结束时的最新表单值；取消则直接关闭。
  const submitRef = useRef(false);
  const { closing, requestClose, onAnimationEnd } = useModalClose(() => {
    if (submitRef.current) void submit();
    else onCancel();
  });

  const set = (field: keyof ConfigEntry) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((er) => ({ ...er, [field]: undefined }));
  };

  const validate = (): boolean => {
    const er: Partial<Record<keyof ConfigEntry, string>> = {};
    if (!form.base_url.trim()) er.base_url = '必填';
    // 锁定的 base_url 由既有分组背书，跳过格式校验（避免锁定非法脏 URL 后无法提交也无法修改的死锁）
    else if (!lockUrl && !/^https?:\/\//.test(form.base_url.trim())) er.base_url = '需以 http(s):// 开头';
    if (!lockKey && !form.key.trim()) er.key = '必填';
    if (!form.model.trim()) er.model = '必填';
    setErrors(er);
    return Object.keys(er).length === 0;
  };

  const submit = async () => {
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

  /** 校验通过才播放退场动画；校验失败保留弹窗并展示错误。 */
  const startSubmit = () => {
    if (closing || busy) return;
    if (!validate()) return;
    submitRef.current = true;
    requestClose();
  };

  const field = (label: string, name: keyof ConfigEntry, placeholder: string, locked = false) => (
    <label className="form-field">
      <span>
        {label}
        {name !== 'channel' && <em className="req">*</em>}
      </span>
      {locked ? (
        <input
          className="input-locked"
          value={name === 'key' && !showKeys ? maskKey(form.key) : form[name]}
          readOnly
          title="由所属分组带入，不可修改"
        />
      ) : (
        <input value={form[name]} onChange={set(name)} placeholder={placeholder} autoFocus={name === focusField} />
      )}
      {errors[name] && <em className="field-error">{errors[name]}</em>}
    </label>
  );

  return (
    <div
      className={`modal-mask${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      onAnimationEnd={onAnimationEnd}
    >
      <div className="modal">
        <h2>{mode.kind === 'add' ? '新增配置' : `编辑：${initial.model}`}</h2>
        <div className="form-grid">
          {field('Base URL', 'base_url', 'https://example.com', lockUrl)}
          {field('API Key', 'key', 'sk-…', lockKey)}
          {field('模型', 'model', 'claude-opus-5')}
          {field('渠道（可选）', 'channel', '留空则归入"默认渠道"', lockChannel)}
        </div>
        <div className="modal-actions">
          <button
            className="btn"
            onClick={() => {
              if (closing || busy) return;
              submitRef.current = false;
              requestClose();
            }}
            disabled={busy || closing}
          >
            取消
          </button>
          <button className="btn btn-primary" onClick={startSubmit} disabled={busy || closing}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
