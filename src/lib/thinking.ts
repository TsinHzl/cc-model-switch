import type { ChatEffort } from './chatIpcContract';

export type ThinkingMode = 'effort' | 'budget';

export const EFFORT_OPTIONS = Object.freeze(
  ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
) as readonly ChatEffort[];

const BUDGET_EFFORT_OPTIONS = Object.freeze(
  ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
) as readonly ChatEffort[];

/** Claude 4.5 代际（含带日期的连字符别名）走 budget 模式。 */
const CLAUDE_45 = /^claude-.*-4[.-]5($|-)/;

export function thinkingMode(modelId: string): ThinkingMode {
  const id = modelId.toLowerCase();
  if (CLAUDE_45.test(id)) return 'budget';
  return id.startsWith('claude-') || id.startsWith('gpt-') ? 'effort' : 'budget';
}

export function effortOptionsFor(modelId: string): readonly ChatEffort[] {
  return thinkingMode(modelId) === 'budget' ? BUDGET_EFFORT_OPTIONS : EFFORT_OPTIONS;
}

/** 已保存档位不被当前模型支持时收敛为 high。 */
export function normalizeEffort(modelId: string, effort: ChatEffort): ChatEffort {
  return effortOptionsFor(modelId).includes(effort) ? effort : 'high';
}

/** budget_tokens 必须小于主进程的 MAX_OUTPUT_TOKENS（16384），
 * 否则网关拒绝请求；最高档留 1024 token 给正文。 */
const BUDGET_TOKENS: Partial<Record<ChatEffort, number>> = Object.freeze({
  low: 4096, medium: 10240, high: 12288, xhigh: 14336, max: 15360,
});

/** 请求体里的 thinking / output_config；off 时两者都不带。 */
export function thinkingRequestFields(
  modelId: string, effort: ChatEffort,
): Record<string, unknown> {
  if (effort === 'off') return {};
  if (thinkingMode(modelId) === 'budget') {
    return {
      thinking: {
        type: 'enabled', budget_tokens: BUDGET_TOKENS[effort] ?? BUDGET_TOKENS.high,
      },
    };
  }
  return { thinking: { type: 'adaptive' }, output_config: { effort } };
}
