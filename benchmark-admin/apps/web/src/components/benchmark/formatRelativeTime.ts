// Legacy formatRelativeTime: 刚刚 / N 分钟前 / N 小时前 / N 天前, falling back
// to the YYYY-MM-DD prefix after 30 days. Accepts Date or ISO string for parity
// with the legacy helper that took an ISO string only.

export function formatRelativeTime(input: Date | string | null | undefined): string {
  if (input == null) return '';
  const time = typeof input === 'string' ? new Date(input).getTime() : input.getTime();
  if (Number.isNaN(time)) return '';
  const diff = Date.now() - time;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const iso = typeof input === 'string' ? input : input.toISOString();
  return iso.slice(0, 10);
}
