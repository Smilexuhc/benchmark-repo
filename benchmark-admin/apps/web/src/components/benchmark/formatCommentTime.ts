// Legacy parity: comment headers display the timestamp as `M月D日 HH:mm` (no
// year, two-digit time). Anything that does not parse as a real Date falls back
// to its raw string so we never render `NaN月NaN日 NaN:NaN`.
export function formatCommentTime(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return typeof value === 'string' ? value : '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mi}`;
}
