// 記録の種類（架電／訪問）と、訪問の方法（訪問／Zoom）の表示名・絞り込み。
import type { CallLog, VisitMethod } from "../types";

export const VISIT_METHODS: { value: VisitMethod; label: string }[] = [
  { value: "visit", label: "訪問" },
  { value: "zoom", label: "Zoom" },
];

export const visitMethodLabel = (m: VisitMethod | null) => VISIT_METHODS.find((x) => x.value === m)?.label ?? "";

/** タイムラインの種類フィルタ。all＝すべて */
export type KindFilter = "all" | "call" | "visit";

export const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "call", label: "架電" },
  { value: "visit", label: "訪問" },
];

export const callsOfKind = (calls: CallLog[], kind: KindFilter) => (kind === "all" ? calls : calls.filter((c) => c.record_type === kind));
