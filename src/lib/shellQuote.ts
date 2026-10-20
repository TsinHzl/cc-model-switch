/* bash printf %q 等价转义（对齐 macOS bash 3.2 UTF-8 locale 的转义形态，与 sh 脚本逐字节一致） */

const SAFE_RE = /^[A-Za-z0-9@%+=:,./_-]$/;

function isSafeChar(ch: string): boolean {
  if (SAFE_RE.test(ch)) return true;
  // bash 3.2 在 UTF-8 locale 下对多字节可打印字符直通（实测 printf %q 不转义中文）
  const code = ch.codePointAt(0)!;
  return code > 0x7e;
}

/** 与 bash `printf '%q'` 输出一致：安全字符直通，其余逐字符反斜杠转义；空串输出一对单引号 */
export function shellQuote(s: string): string {
  if (s.length === 0) return "''";
  let needsQuote = false;
  for (const ch of s) {
    if (!isSafeChar(ch)) {
      needsQuote = true;
      break;
    }
  }
  if (!needsQuote) return s;
  let out = '';
  for (const ch of s) {
    out += isSafeChar(ch) ? ch : `\\${ch}`;
  }
  return out;
}
