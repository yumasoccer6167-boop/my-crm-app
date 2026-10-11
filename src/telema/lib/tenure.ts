// ユーザー（契約済みの施設）との付き合いの長さ。最初の契約日から今日まで

export type Tenure = { years: number; months: number; days: number };

/** startIso・todayIso は暦の日付（YYYY-MM-DD）。開始が今日より先なら null。days は通算の日数、years/months は暦で数えた年・ヶ月（端数の日は切り捨て） */
export function tenure(startIso: string, todayIso: string): Tenure | null {
  const [y1, m1, d1] = startIso.split("-").map(Number) as [number, number, number];
  const [y2, m2, d2] = todayIso.split("-").map(Number) as [number, number, number];
  const days = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
  if (!Number.isFinite(days) || days < 0) return null;
  let total = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1) total -= 1;
  return { years: Math.floor(total / 12), months: total % 12, days };
}

/** 「3年2ヶ月」「5ヶ月」「12日」のような表記 */
export function fmtTenure(t: Tenure): string {
  const ym = [t.years > 0 ? `${t.years}年` : "", t.years > 0 || t.months > 0 ? (t.months > 0 ? `${t.months}ヶ月` : "") : ""].join("");
  return ym || `${t.days}日`;
}
