/** key 脱敏：保留前 6 后 4；短 key（≤12 位）按长度缩进保留量，不再整串明文 */
export function maskKey(key: string): string {
  if (key.length <= 4) return '•'.repeat(key.length);
  // 短 key（5–11 位）强制隐藏中间：前 2 后 2，其余打点，避免 head+tail ≥ 长度导致整串明文
  if (key.length <= 11) {
    return `${key.slice(0, 2)}${'•'.repeat(key.length - 4)}${key.slice(-2)}`;
  }
  const head = key.slice(0, Math.min(6, Math.max(3, key.length - 2)));
  const tail = key.slice(-Math.min(4, Math.max(2, key.length - 3)));
  return `${head}${'•'.repeat(Math.min(12, Math.max(4, key.length - head.length - tail.length)))}${tail}`;
}