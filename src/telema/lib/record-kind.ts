// 記録の種類（架電／訪問）と、訪問の方法（訪問／Zoom）の表示名・絞り込み。
import type { CallLog, VisitMethod } from "../types";

export const VISIT_METHODS: { value: VisitMethod; label: string }[] = [
  { value: "visit", label: "訪問" },
  { value: "zoom", label: "Zoom" },
];

export const visitMethodLabel = (m: VisitMethod | null) => VISIT_METHODS.find((x) => x.value === m)?.label ?? "";

/** 訪問の内容が「営業」のときだけ、商材・月額・期間を残せる（名前で判定する） */
export const SALES_PURPOSE_NAME = "営業";
export const SALES_TERMS: { value: string; label: string }[] = [
  { value: "cash", label: "現金一括" },
  ...[12, 24, 36, 48, 60, 72, 84].map((n) => ({ value: String(n), label: `${n}か月` })),
];
export const salesTermLabel = (t: string | null) => SALES_TERMS.find((x) => x.value === t)?.label ?? "";

/** 営業の内容（商材・月額・期間）を1行の文にする。何も無ければ空 */
export function salesSummary(c: Pick<CallLog, "sales_product" | "sales_monthly_fee" | "sales_term">): string {
  return [c.sales_product, c.sales_monthly_fee != null ? `月額 ${c.sales_monthly_fee.toLocaleString()}円` : "", c.sales_term ? `期間 ${salesTermLabel(c.sales_term)}` : ""].filter(Boolean).join(" ／ ");
}

/** タイムラインの種類フィルタ。all＝すべて */
export type KindFilter = "all" | "call" | "visit";

export const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "call", label: "架電" },
  { value: "visit", label: "訪問" },
];

export const callsOfKind = (calls: CallLog[], kind: KindFilter) => (kind === "all" ? calls : calls.filter((c) => c.record_type === kind));
