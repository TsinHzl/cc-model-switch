import { describe, expect, it } from 'vitest';
import {
  EFFORT_OPTIONS, effortOptionsFor, normalizeEffort, thinkingMode, thinkingRequestFields,
} from '../thinking';

describe('思考力度', () => {
  it.each([
    'claude-opus-4-5',
    'claude-opus-4-5-20251101',
    'claude-sonnet-4.5',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001',
  ])('%s 走 budget 模式', model => {
    expect(thinkingMode(model)).toBe('budget');
  });

  it.each(['claude-opus-4-6', 'claude-sonnet-5', 'gpt-5', 'kimi-k3', 'glm-5', 'deepseek-v3'])(
    '%s 的模式判定',
    model => {
      expect(thinkingMode(model)).toBe(model.startsWith('claude-') || model.startsWith('gpt-')
        ? 'effort' : 'budget');
    },
  );

  it('大写模型名同样识别', () => {
    expect(thinkingMode('CLAUDE-OPUS-4-5')).toBe('budget');
    expect(thinkingMode('GPT-5')).toBe('effort');
  });

  it('budget 模式只提供四档', () => {
    expect(effortOptionsFor('claude-opus-4-5')).toEqual(['off', 'low', 'medium', 'high']);
  });

  it('effort 模式提供六档', () => {
    expect(effortOptionsFor('claude-sonnet-5')).toEqual(EFFORT_OPTIONS);
    expect(EFFORT_OPTIONS).toHaveLength(6);
  });

  it.each(['xhigh', 'max'] as const)('budget 模式把 %s 收敛为 high', effort => {
    expect(normalizeEffort('claude-opus-4-5', effort)).toBe('high');
  });

  it.each(['off', 'low', 'medium', 'high'] as const)('budget 模式保留 %s', effort => {
    expect(normalizeEffort('claude-opus-4-5', effort)).toBe(effort);
  });

  it('effort 模式保留 xhigh 与 max', () => {
    expect(normalizeEffort('gpt-5', 'xhigh')).toBe('xhigh');
    expect(normalizeEffort('gpt-5', 'max')).toBe('max');
  });

  it('off 不发送任何 thinking 字段', () => {
    expect(thinkingRequestFields('claude-sonnet-5', 'off')).toEqual({});
    expect(thinkingRequestFields('kimi-k3', 'off')).toEqual({});
  });

  it('budget 模式发送 budget_tokens', () => {
    expect(thinkingRequestFields('claude-opus-4-5', 'low'))
      .toEqual({ thinking: { type: 'enabled', budget_tokens: 4096 } });
    expect(thinkingRequestFields('claude-opus-4-5', 'medium'))
      .toEqual({ thinking: { type: 'enabled', budget_tokens: 10240 } });
    expect(thinkingRequestFields('claude-opus-4-5', 'high'))
      .toEqual({ thinking: { type: 'enabled', budget_tokens: 20000 } });
  });

  it('effort 模式发送 adaptive + output_config', () => {
    expect(thinkingRequestFields('claude-sonnet-5', 'medium'))
      .toEqual({ thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } });
    expect(thinkingRequestFields('gpt-5', 'max'))
      .toEqual({ thinking: { type: 'adaptive' }, output_config: { effort: 'max' } });
  });
});
