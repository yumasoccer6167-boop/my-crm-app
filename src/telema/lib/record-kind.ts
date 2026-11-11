// 記録の種類（架電／訪問）と、訪問の方法（訪問／Zoom）の表示名・絞り込み。
import type { CallLog, FirstResult, SalesResult, VisitMethod } from "../types";
import { fmtDateTime } from "./format";
import { fmtP } from "./points";

export const VISIT_METHODS: { value: VisitMethod; label: string }[] = [
  { value: "visit", label: "訪問" },
  { value: "zoom", label: "Zoom" },
];

export const visitMethodLabel = (m: VisitMethod | null) => VISIT_METHODS.find((x) => x.value === m)?.label ?? "";

/** 訪問の内容が「営業」のときだけ、商材・支払い内容（商品・サーバーの月額と回数、CB）を残せる（名前で判定する） */
export const SALES_PURPOSE_NAME = "営業";
/** 受注の支払いの回数（商品・サーバー）。現金一括・自社回収・12〜84回 */
export const PAYMENT_TERMS: { value: string; label: string }[] = [
  { value: "cash", label: "現金一括" },
  { value: "inhouse", label: "自社回収" },
  ...[12, 24, 36, 48, 60, 72, 84].map((n) => ({ value: String(n), label: `${n}回` })),
];
export const paymentTermLabel = (t: string | null) => PAYMENT_TERMS.find((x) => x.value === t)?.label ?? "";

/** 支払い内容（商品の月額・回数、サーバーの月額・回数、CB）を、入っている項目だけ文にする */
export function paymentParts(p: { productMonthly: number | null; productTerm: string | null; serverMonthly: number | null; serverTerm: string | null; cashback: number | null }): string[] {
  const part = (name: string, monthly: number | null, term: string | null) => (monthly != null || term ? `${name} ${[monthly != null ? `月額 ${monthly.toLocaleString()}円` : "", term ? paymentTermLabel(term) : ""].filter(Boolean).join("・")}` : "");
  return [part("商品", p.productMonthly, p.productTerm), part("サーバー", p.serverMonthly, p.serverTerm), p.cashback != null ? `CB ${p.cashback.toLocaleString()}円` : ""].filter(Boolean);
}

/** 架電の結果「初回訪問時間設定」。この結果と「時間設定」のときだけ、訪問する日時・事前確認日時を付けられる（名前で判定する） */
export const FIRST_SCHEDULING_STATUS = "初回訪問時間設定";

/** 訪問の内容が「初回訪問」のときだけ、結果（営業時間設定・見込みなし）を残せる（名前で判定する） */
export const FIRST_PURPOSE_NAME = "初回訪問";
export const FIRST_RESULTS: { value: FirstResult; label: string; on: string }[] = [
  { value: "scheduled", label: "営業時間設定", on: "bg-sky-600 text-white ring-sky-600" },
  { value: "no_prospect", label: "見込みなし", on: "bg-slate-600 text-white ring-slate-600" },
];
export const firstResultLabel = (r: FirstResult | null) => FIRST_RESULTS.find((x) => x.value === r)?.label ?? "";

/** 初回訪問の結果を1行の文にする（営業時間設定のときは営業の日時つき）。結果が無ければ空 */
export const firstSummary = (c: Pick<CallLog, "first_result" | "first_followup_at">): string =>
  c.first_result ? `${firstResultLabel(c.first_result)}${c.first_followup_at ? `（営業 ${fmtDateTime(c.first_followup_at)}）` : ""}` : "";

/** 営業の結果（即決受注・返事待ち・NG・再営業）。on は選んだときのボタンの色 */
export const SALES_RESULTS: { value: SalesResult; label: string; on: string }[] = [
  { value: "won", label: "即決受注", on: "bg-emerald-600 text-white ring-emerald-600" },
  { value: "waiting", label: "返事待ち", on: "bg-amber-500 text-white ring-amber-500" },
  { value: "ng", label: "NG", on: "bg-rose-600 text-white ring-rose-600" },
  { value: "resales", label: "再営業", on: "bg-indigo-600 text-white ring-indigo-600" },
];
/** 結果の表示名。返事待ち対応（reply）の「受注」は、営業の訪問の「即決受注」と区別して「受注」と出す */
export const salesResultLabel = (r: SalesResult | null, reply = false) => (reply && r === "won" ? "受注" : (SALES_RESULTS.find((x) => x.value === r)?.label ?? ""));

/** 返事待ち対応で選べる結果（受注・NG・再営業） */
export const REPLY_RESULTS: { value: SalesResult; label: string; on: string }[] = [
  { value: "won", label: "受注", on: "bg-emerald-600 text-white ring-emerald-600" },
  { value: "ng", label: "NG", on: "bg-rose-600 text-white ring-rose-600" },
  { value: "resales", label: "再営業", on: "bg-indigo-600 text-white ring-indigo-600" },
];

type SalesFields = Pick<CallLog, "sales_product" | "sales_result" | "sales_followup_at" | "sales_amount" | "sales_gross_profit" | "sales_units"> &
  Partial<Pick<CallLog, "sales_product_monthly" | "sales_product_term" | "sales_server_monthly" | "sales_server_term" | "sales_cashback">>;

/** 営業の内容（商材・結果・受注金額・支払い内容）を1行の文にする。何も無ければ空 */
export function salesSummary(c: SalesFields, reply = false): string {
  return [
    c.sales_product,
    c.sales_result ? `結果 ${salesResultLabel(c.sales_result, reply)}${c.sales_followup_at ? `（${fmtDateTime(c.sales_followup_at)}）` : ""}` : "",
    c.sales_amount != null ? `受注金額 ${c.sales_amount.toLocaleString()}円` : "",
    c.sales_gross_profit != null ? `粗利 ${fmtP(c.sales_gross_profit)}` : "",
    c.sales_units != null ? `${c.sales_units}台` : "",
    ...paymentParts({ productMonthly: c.sales_product_monthly ?? null, productTerm: c.sales_product_term ?? null, serverMonthly: c.sales_server_monthly ?? null, serverTerm: c.sales_server_term ?? null, cashback: c.sales_cashback ?? null }),
  ].filter(Boolean).join(" ／ ");
}

/** タイムラインの種類フィルタ。all＝すべて */
export type KindFilter = "all" | "call" | "visit" | "reply";

export const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "call", label: "架電" },
  { value: "visit", label: "訪問" },
  { value: "reply", label: "返事待ち対応" },
];

export const callsOfKind = (calls: CallLog[], kind: KindFilter) => (kind === "all" ? calls : calls.filter((c) => c.record_type === kind));
