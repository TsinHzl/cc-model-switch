import { describe, it, expect } from 'vitest';
import { shellQuote } from '../shellQuote';

describe('shellQuote — 与 macOS bash 3.2 printf %q 逐字节对齐（实测基准）', () => {
  // 实测基准：bash /tmp/quote_diff.sh 与 printf '%q\n' 的真实输出
  it.each([
    ['claude-opus-5', 'claude-opus-5'],
    ['sk-xxxx6789012345678901234567890abcd', 'sk-xxxx6789012345678901234567890abcd'],
    ['https://kiro2ccproxy.zeabur.app', 'https://kiro2ccproxy.zeabur.app'],
    ['https://open.bigmodel.cn/api/anthropic', 'https://open.bigmodel.cn/api/anthropic'],
    ['gpt-5.6-terra', 'gpt-5.6-terra'],
    ['abcd1234567890abcdef._fakePlaceholderZ', 'abcd1234567890abcdef._fakePlaceholderZ'],
    // 转义形态（实测：bash 3.2 用反斜杠而非单引号）
    ["a'b", "a\\'b"],
    ['x$y', 'x\\$y'],
    ['a"b', 'a\\"b'],
    ['p|q', 'p\\|q'],
    ['a b', 'a\\ b'],
    ['值 空格', '值\\ 空格'],
    // 空串输出一对单引号（bash 实测）
    ['', "''"],
  ])('%j → %s', (input, expected) => {
    expect(shellQuote(input)).toBe(expected);
  });
});
