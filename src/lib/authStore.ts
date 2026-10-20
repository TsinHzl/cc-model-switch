/* 密码门禁：SHA-256(salt+password) 哈希存 localStorage，sessionStorage 会话解锁 */
/* 定位为防误触，不是安全边界（localStorage 可被同源脚本读取） */

const HASH_KEY = 'cccfg.auth.hash';
const SALT_KEY = 'cccfg.auth.salt';
const SESSION_KEY = 'cccfg.auth.unlocked';

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHex(digest);
}

function randomSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return toHex(bytes.buffer);
}

export function hasPassword(): boolean {
  return localStorage.getItem(HASH_KEY) !== null && localStorage.getItem(SALT_KEY) !== null;
}

/** 首次设置密码：两次输入一致则写入哈希并解锁当前会话；已设置时返回 false 不覆盖 */
export async function setPassword(pw: string, confirmPw: string): Promise<{ ok: boolean; error?: string }> {
  if (hasPassword()) return { ok: false, error: '密码已设置，如需重置请清除站点数据' };
  if (pw.length < 4) return { ok: false, error: '密码至少 4 位' };
  if (pw !== confirmPw) return { ok: false, error: '两次输入不一致' };
  const salt = randomSalt();
  localStorage.setItem(HASH_KEY, await sha256Hex(salt + pw));
  localStorage.setItem(SALT_KEY, salt);
  sessionStorage.setItem(SESSION_KEY, '1');
  return { ok: true };
}

export async function verifyPassword(pw: string): Promise<boolean> {
  const salt = localStorage.getItem(SALT_KEY);
  const stored = localStorage.getItem(HASH_KEY);
  if (salt === null || stored === null) return false;
  return (await sha256Hex(salt + pw)) === stored;
}

export function isUnlocked(): boolean {
  return sessionStorage.getItem(SESSION_KEY) === '1';
}

/** 登录成功后标记会话解锁（刷新保留，关标签页失效） */
export function markUnlocked(): void {
  sessionStorage.setItem(SESSION_KEY, '1');
}

export function lockSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}
