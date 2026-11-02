import { api, unwrap } from "../../lib/api";
import { fromLocalInput, toLocalInput } from "../../lib/format";
import { FIRST_RESULTS, REPLY_RESULTS, SALES_RESULTS, SALES_TERMS } from "../../lib/record-kind";
import type { CallLog, FirstResult, SalesResult } from "../../types";
import { useApi } from "../../lib/useApi";
import { inputCls } from "../ui";

export type SalesDetail = { product: string; fee: string; term: string; result: SalesResult | ""; followupAt: string; amount: string; grossProfit: string; units: string; firstResult: FirstResult | ""; firstAt: string };
export const emptySales: SalesDetail = { product: "", fee: "", term: "", result: "", followupAt: "", amount: "", grossProfit: "", units: "", firstResult: "", firstAt: "" };

const numStr = (n: number | null) => (n == null ? "" : String(n));

/** 保存済みの訪問記録から、フォームの値を作る */
export function salesFromCall(c: CallLog): SalesDetail {
  return {
    product: c.sales_product ?? "",
    fee: numStr(c.sales_monthly_fee),
    term: c.sales_term ?? "",
    result: c.sales_result ?? "",
    followupAt: toLocalInput(c.sales_followup_at),
    amount: numStr(c.sales_amount),
    grossProfit: numStr(c.sales_gross_profit),
    units: numStr(c.sales_units),
    firstResult: c.first_result ?? "",
    firstAt: toLocalInput(c.first_followup_at),
  };
}

/** 訪問の内容が「営業」のときの、商材（今ある商材から選ぶ）・月額（円）・期間（現金一括／12〜84か月） */
export function SalesDetailFields({ value, onChange, currentProduct }: { value: SalesDetail; onChange: (v: SalesDetail) => void; currentProduct?: string | null }) {
  const products = useApi(() => unwrap(api.products.$get()), []);
  // 商材マスタから外れた商材でも、この記録にすでに付いているものは選択肢に残す
  const options = [...(products.data ?? [])];
  if (currentProduct && !options.includes(currentProduct)) options.unshift(currentProduct);
  return (
    <div className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-3">
      <div>
        <div className="mb-1 text-xs text-slate-500">商材</div>
        <select value={value.product} onChange={(e) => onChange({ ...value, product: e.target.value })} className={inputCls}>
          <option value="">（未選択）</option>
          {options.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div>
        <div className="mb-1 text-xs text-slate-500">月額（円）</div>
        <input type="number" min={0} step={1} inputMode="numeric" value={value.fee} onChange={(e) => onChange({ ...value, fee: e.target.value })} placeholder="例：9800" className={inputCls} />
      </div>
      <div>
        <div className="mb-1 text-xs text-slate-500">期間</div>
        <select value={value.term} onChange={(e) => onChange({ ...value, term: e.target.value })} className={inputCls}>
          <option value="">（未選択）</option>
          {SALES_TERMS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
    </div>
    <div>
      <div className="mb-1 text-xs text-slate-500">結果（もう一度押すと外れます）</div>
      <div className="flex flex-wrap gap-1.5">
        {SALES_RESULTS.map((r) => {
          const on = value.result === r.value;
          return (
            <button
              key={r.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ ...value, result: on ? "" : r.value })}
              className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset transition-colors ${on ? r.on : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
            >
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
    {(value.result === "waiting" || value.result === "resales") && (
      <div className="sm:max-w-xs">
        <div className="mb-1 text-xs text-slate-500">{value.result === "waiting" ? "返事をもらう日時" : "再営業の日時"}</div>
        <input type="datetime-local" value={value.followupAt} onChange={(e) => onChange({ ...value, followupAt: e.target.value })} className={inputCls} />
      </div>
    )}
    {value.result === "won" && (
      <div className="grid gap-3 sm:grid-cols-3">
        {([["amount", "受注金額（円）", "例：480000"], ["grossProfit", "粗利（円）", "例：150000"], ["units", "台数", "例：1"]] as const).map(([k, label, ph]) => (
          <div key={k}>
            <div className="mb-1 text-xs text-slate-500">{label}</div>
            <input type="number" min={0} step={1} inputMode="numeric" value={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.value })} placeholder={ph} className={inputCls} />
          </div>
        ))}
        <p className="text-xs text-slate-400 sm:col-span-3">即決受注で保存すると、契約情報にも自動で登録されます（商材の選択が必要です）。</p>
      </div>
    )}
    </div>
  );
}

/** 保存用の値に直す。空は null */
export function salesPayload(v: SalesDetail) {
  const num = (x: string) => (x.trim() === "" ? null : Math.max(0, Math.round(Number(x))));
  const won = v.result === "won";
  const followup = v.result === "waiting" || v.result === "resales";
  return {
    sales_product: v.product || null,
    sales_monthly_fee: num(v.fee),
    sales_term: v.term || null,
    sales_result: v.result || null,
    sales_followup_at: followup ? fromLocalInput(v.followupAt) : null,
    sales_amount: won ? num(v.amount) : null,
    sales_gross_profit: won ? num(v.grossProfit) : null,
    sales_units: won ? num(v.units) : null,
  };
}

/** 訪問の内容が「初回訪問」のときの、結果（営業時間設定・見込みなし）。営業時間設定のときは、営業の日時を決める */
export function FirstVisitFields({ value, onChange }: { value: SalesDetail; onChange: (v: SalesDetail) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs text-slate-500">結果（もう一度押すと外れます）</div>
        <div className="flex flex-wrap gap-1.5">
          {FIRST_RESULTS.map((r) => {
            const on = value.firstResult === r.value;
            return (
              <button
                key={r.value}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ ...value, firstResult: on ? "" : r.value })}
                className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset transition-colors ${on ? r.on : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>
      {value.firstResult === "scheduled" && (
        <div className="sm:max-w-xs">
          <div className="mb-1 text-xs text-slate-500">営業の日時</div>
          <input type="datetime-local" value={value.firstAt} onChange={(e) => onChange({ ...value, firstAt: e.target.value })} className={inputCls} />
        </div>
      )}
    </div>
  );
}

/** 初回訪問の結果の保存用の値。営業の日時は営業時間設定のときだけ */
export function firstPayload(v: SalesDetail) {
  return { first_result: v.firstResult || null, first_followup_at: v.firstResult === "scheduled" ? fromLocalInput(v.firstAt) : null };
}

/** 返事待ち対応の結果（受注・NG・再営業）。受注は商材・受注金額・粗利・台数、再営業は次回日時 */
export function ReplyFields({ value, onChange, currentProduct }: { value: SalesDetail; onChange: (v: SalesDetail) => void; currentProduct?: string | null }) {
  const products = useApi(() => unwrap(api.products.$get()), []);
  const options = [...(products.data ?? [])];
  if (currentProduct && !options.includes(currentProduct)) options.unshift(currentProduct);
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs text-slate-500">結果</div>
        <div className="flex flex-wrap gap-1.5">
          {REPLY_RESULTS.map((r) => {
            const on = value.result === r.value;
            return (
              <button
                key={r.value}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ ...value, result: on ? "" : r.value })}
                className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset transition-colors ${on ? r.on : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>
      {value.result === "resales" && (
        <div className="sm:max-w-xs">
          <div className="mb-1 text-xs text-slate-500">再営業の日時</div>
          <input type="datetime-local" value={value.followupAt} onChange={(e) => onChange({ ...value, followupAt: e.target.value })} className={inputCls} />
        </div>
      )}
      {value.result === "won" && (
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <div className="mb-1 text-xs text-slate-500">商材</div>
            <select value={value.product} onChange={(e) => onChange({ ...value, product: e.target.value })} className={inputCls}>
              <option value="">（未選択）</option>
              {options.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          {([["amount", "受注金額（円）", "例：480000"], ["grossProfit", "粗利（円）", "例：150000"], ["units", "台数", "例：1"]] as const).map(([k, label, ph]) => (
            <div key={k}>
              <div className="mb-1 text-xs text-slate-500">{label}</div>
              <input type="number" min={0} step={1} inputMode="numeric" value={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.value })} placeholder={ph} className={inputCls} />
            </div>
          ))}
          <p className="text-xs text-slate-400 sm:col-span-4">受注で保存すると、契約情報にも自動で登録されます（商材の選択が必要です）。</p>
        </div>
      )}
    </div>
  );
}

/** 返事待ち対応の保存用の値 */
export function replyPayload(v: SalesDetail) {
  const num = (x: string) => (x.trim() === "" ? null : Math.max(0, Math.round(Number(x))));
  const won = v.result === "won";
  return {
    sales_result: v.result || null,
    sales_product: won ? v.product || null : null,
    sales_amount: won ? num(v.amount) : null,
    sales_gross_profit: won ? num(v.grossProfit) : null,
    sales_units: won ? num(v.units) : null,
    sales_followup_at: v.result === "resales" ? fromLocalInput(v.followupAt) : null,
  };
}
