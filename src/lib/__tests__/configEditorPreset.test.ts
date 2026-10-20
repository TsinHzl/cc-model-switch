/* resolveAddPreset 预设解析单测：URL 入口 / 渠道入口 / 默认渠道三条条件路径 */
import { describe, expect, it } from 'vitest';
import { resolveAddPreset } from '../../components/EntryForm';

describe('resolveAddPreset', () => {
  it('URL 入口（仅 baseUrl）→ base_url 锁定预填，渠道留空可自由填写', () => {
    const r = resolveAddPreset({ baseUrl: 'https://kiro2ccproxy.zeabur.app' });
    expect(r.initial).toEqual({ base_url: 'https://kiro2ccproxy.zeabur.app', key: '', model: '', channel: '' });
    expect(r.lockUrl).toBe(true);
    expect(r.lockChannel).toBe(false);
    expect(r.lockKey).toBe(false);
  });

  it('渠道入口（baseUrl + channel，无 key）→ base_url 与渠道锁定，key 可填', () => {
    const r = resolveAddPreset({ baseUrl: 'https://kiro2ccproxy.zeabur.app', channel: 'kiro反代cc专属' });
    expect(r.initial).toEqual({
      base_url: 'https://kiro2ccproxy.zeabur.app',
      key: '',
      model: '',
      channel: 'kiro反代cc专属',
    });
    expect(r.lockUrl).toBe(true);
    expect(r.lockChannel).toBe(true);
    expect(r.lockKey).toBe(false);
  });

  it('默认渠道入口（channel 为空串）→ 渠道锁定为空而非写入字面量「默认渠道」', () => {
    // 「默认渠道」是空 channel 的展示标签，按钮侧已转换为 ''；此处锁定后提交 channel=''，仍归默认渠道分组
    const r = resolveAddPreset({ baseUrl: 'https://api.example.com', channel: '' });
    expect(r.initial.channel).toBe('');
    expect(r.lockChannel).toBe(true);
    expect(r.lockKey).toBe(false);
  });

  it('渠道入口（baseUrl + channel + key）→ base_url/channel/key 均锁定预填', () => {
    const r = resolveAddPreset({
      baseUrl: 'https://kiro2ccproxy.zeabur.app',
      channel: 'kiro反代cc专属',
      key: 'sk-xxxx',
    });
    expect(r.initial).toEqual({
      base_url: 'https://kiro2ccproxy.zeabur.app',
      key: 'sk-xxxx',
      model: '',
      channel: 'kiro反代cc专属',
    });
    expect(r.lockUrl).toBe(true);
    expect(r.lockChannel).toBe(true);
    expect(r.lockKey).toBe(true);
  });

  it('渠道入口（baseUrl + channel + 空串 key）→ 空串不锁，key 可填', () => {
    const r = resolveAddPreset({
      baseUrl: 'https://kiro2ccproxy.zeabur.app',
      channel: 'kiro反代cc专属',
      key: '',
    });
    expect(r.lockKey).toBe(false);
  });
});
