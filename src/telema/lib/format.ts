const dtf = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const df = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short" });
const tf = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });

export const fmtDateTime = (iso: string | null | undefined) => (iso ? dtf.format(new Date(iso)) : "—");

/** 一覧向けの短い表記：今日 15:00 / 明日 10:00 / 10/3(金) 15:00 / 期限超過は呼び出し側で色付け */
export function fmtShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const dayDiff = Math.round((startOfJstDay(d) - startOfJstDay(new Date())) / 86400000);
  const t = tf.format(d);
  if (dayDiff === 0) return `今日 ${t}`;
  if (dayDiff === 1) return `明日 ${t}`;
  if (dayDiff === -1) return `昨日 ${t}`;
  return `${df.format(d)} ${t}`;
}

function startOfJstDay(d: Date): number {
  const j = new Date(d.getTime() + 9 * 3600000);
  return Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate());
}

export const isOverdue = (iso: string | null | undefined) => !!iso && new Date(iso).getTime() < Date.now();

/** <input type="datetime-local"> 用（ブラウザのローカル時刻） */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

/** 次回架電のクイック選択 */
export function quickDate(kind: "today15" | "tomorrow" | "days3" | "week" | "month"): string {
  const d = new Date();
  const at = (h: number) => d.setHours(h, 0, 0, 0);
  if (kind === "today15") at(15);
  if (kind === "tomorrow") (d.setDate(d.getDate() + 1), at(10));
  if (kind === "days3") (d.setDate(d.getDate() + 3), at(10));
  if (kind === "week") (d.setDate(d.getDate() + 7), at(10));
  if (kind === "month") (d.setMonth(d.getMonth() + 1), at(10));
  return d.toISOString();
}
