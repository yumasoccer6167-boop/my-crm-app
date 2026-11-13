import { api, unwrap } from "../../lib/api";
import { fromLocalInput, toLocalInput } from "../../lib/format";
import { pToYen, yenToP } from "../../lib/points";
import { FIRST_RESULTS, PAYMENT_TERMS, REPLY_RESULTS, SALES_RESULTS } from "../../lib/record-kind";
import type { CallLog, FirstResult, SalesItem, SalesResult } from "../../types";
import { useApi } from "../../lib/useApi";
import { inputCls } from "../ui";

/** 商材の1行。商材ごとに 支払い内容（商品・サーバーの月額（円）と回数、CB＝キャッシュバック料金・円）、受注なら受注金額・粗利（P）・台数 を入れる */
export type ItemDraft = {
  product: string;
  productMonthly: string;
  productTerm: string;
  serverMonthly: string;
  serverTerm: string;
  cashback: string;
  amount: string;
  grossProfit: string;
  units: string;
};
export const emptyItem: ItemDraft = { product: "", productMonthly: "", productTerm: "", serverMonthly: "", serverTerm: "", cashback: "", amount: "", grossProfit: "", units: "" };
/** 1つの記録に登録できる商材の数 */
const MAX_ITEMS = 10;

export type SalesDetail = {
  /** 商材（複数登録できる） */
  items: ItemDraft[];
  result: SalesResult | "";
  followupAt: string;
  firstResult: FirstResult | "";
  firstAt: string;
};
export const emptySales: SalesDetail = { items: [emptyItem], result: "", followupAt: "", firstResult: "", firstAt: "" };

const numStr = (n: number | null | undefined) => (n == null ? "" : String(n));

const draftOfItem = (i: SalesItem): ItemDraft => ({
  product: i.product ?? "",
  productMonthly: numStr(i.product_monthly),
  productTerm: i.product_term ?? "",
  serverMonthly: numStr(i.server_monthly),
  serverTerm: i.server_term ?? "",
  cashback: numStr(i.cashback),
  amount: numStr(i.amount),
  grossProfit: yenToP(i.gross_profit),
  units: numStr(i.units),
});

/** 保存済みの訪問記録から、フォームの値を作る。商材の行が無い記録（これまでの記録）は、記録の商材・支払い内容・金額から1行作る */
export function salesFromCall(c: CallLog): SalesDetail {
  const legacy: SalesItem = {
    product: c.sales_product,
    product_monthly: c.sales_product_monthly,
    product_term: c.sales_product_term,
    server_monthly: c.sales_server_monthly,
    server_term: c.sales_server_term,
    cashback: c.sales_cashback,
    amount: c.sales_amount,
    gross_profit: c.sales_gross_profit,
    units: c.sales_units,
  };
  const rows = c.sales_items?.length ? c.sales_items : Object.values(legacy).some((v) => v != null) ? [legacy] : [];
  return {
    items: rows.length ? rows.map(draftOfItem) : [emptyItem],
    result: c.sales_result ?? "",
    followupAt: toLocalInput(c.sales_followup_at),
    firstResult: c.first_result ?? "",
    firstAt: toLocalInput(c.first_followup_at),
  };
}

const num = (x: string) => (x.trim() === "" ? null : Math.max(0, Math.round(Number(x))));

/** 商材の行の保存用の値。何も入っていない行はサーバーで除かれる。受注金額・粗利・台数は受注のときだけ */
function itemsPayload(v: SalesDetail, won: boolean) {
  return v.items.map((it) => ({
    product: it.product || null,
    product_monthly: num(it.productMonthly),
    product_term: it.productTerm || null,
    server_monthly: num(it.serverMonthly),
    server_term: it.serverTerm || null,
    cashback: num(it.cashback),
    amount: won ? num(it.amount) : null,
    gross_profit: won ? pToYen(it.grossProfit) : null,
    units: won ? num(it.units) : null,
  }));
}

/** 商材の入力欄（複数）。商材ごとに 商材・支払い内容（商品・サーバーの月額と回数、CB）、受注なら受注金額・粗利・台数。回数は現金一括・自社回収・12〜84回 */
function ItemsEditor({ value, onChange, showWon }: { value: SalesDetail; onChange: (v: SalesDetail) => void; showWon: boolean }) {
  const products = useApi(() => unwrap(api.products.$get()), []);
  // 商材マスタから外れた商材でも、この記録にすでに付いているものは選択肢に残す
  const options = [...(products.data ?? [])];
  for (const it of value.items) if (it.product && !options.includes(it.product)) options.unshift(it.product);
  const set = (i: number, patch: Partial<ItemDraft>) => onChange({ ...value, items: value.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const many = value.items.length > 1;
  return (
    <div className="space-y-3">
      {value.items.map((it, i) => (
        <div key={i} className={many ? "space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3" : "space-y-3"}>
          {many && (
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-600">商材 {i + 1}</div>
              <button type="button" onClick={() => onChange({ ...value, items: value.items.filter((_, j) => j !== i) })} className="text-xs text-rose-600 hover:underline">
                この商材を外す
              </button>
            </div>
          )}
          <div className="sm:max-w-xs">
            <div className="mb-1 text-xs text-slate-500">商材</div>
            <select value={it.product} onChange={(e) => set(i, { product: e.target.value })} className={inputCls}>
              <option value="">（未選択）</option>
              {options.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          {showWon && (
            <div className="grid gap-3 sm:grid-cols-3">
              {([["amount", "受注金額（円）", "例：480000"], ["grossProfit", "粗利（P）", "例：15（1万円＝1P）"], ["units", "台数", "例：1"]] as const).map(([k, label, ph]) => (
                <div key={k}>
                  <div className="mb-1 text-xs text-slate-500">{label}</div>
                  <input type="number" min={0} step={k === "grossProfit" ? "any" : 1} inputMode={k === "grossProfit" ? "decimal" : "numeric"} value={it[k]} onChange={(e) => set(i, { [k]: e.target.value })} placeholder={ph} className={inputCls} />
                </div>
              ))}
            </div>
          )}
          <PaymentFields item={it} onChange={(patch) => set(i, patch)} />
        </div>
      ))}
      {value.items.length < MAX_ITEMS && (
        <button type="button" onClick={() => onChange({ ...value, items: [...value.items, emptyItem] })} className="rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50">
          ＋ 商材を追加
        </button>
      )}
    </div>
  );
}

/** 支払い内容の入力欄：商品（月額・回数）、サーバー（月額・回数）、CB（キャッシュバック料金）。回数は現金一括・自社回収・12〜84回 */
function PaymentFields({ item, onChange }: { item: ItemDraft; onChange: (patch: Partial<ItemDraft>) => void }) {
  const termSelect = (key: "productTerm" | "serverTerm", label: string) => (
    <div>
      <div className="mb-1 text-xs text-slate-500">{label}</div>
      <select value={item[key]} onChange={(e) => onChange({ [key]: e.target.value })} className={inputCls}>
        <option value="">（未選択）</option>
        {PAYMENT_TERMS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </div>
  );
  const money = (key: "productMonthly" | "serverMonthly" | "cashback", label: string, ph: string) => (
    <div>
      <div className="mb-1 text-xs text-slate-500">{label}</div>
      <input type="number" min={0} step={1} inputMode="numeric" value={item[key]} onChange={(e) => onChange({ [key]: e.target.value })} placeholder={ph} className={inputCls} />
    </div>
  );
  return (
    <div className="grid items-end gap-3 sm:grid-cols-5">
      {money("productMonthly", "商品の月額（円）", "例：9800")}
      {termSelect("productTerm", "商品の回数")}
      {money("serverMonthly", "サーバーの月額（円）", "例：1100")}
      {termSelect("serverTerm", "サーバーの回数")}
      {money("cashback", "CB（キャッシュバック料金・円）", "例：30000")}
    </div>
  );
}

/** 訪問の内容が「営業」のときの、商材（複数・今ある商材から選ぶ）・支払い内容（商品・サーバーの月額と回数、CB）・結果。支払い内容は、結果を決める前の提案の内容でも残せる */
export function SalesDetailFields({ value, onChange }: { value: SalesDetail; onChange: (v: SalesDetail) => void }) {
  return (
    <div className="space-y-3">
      <ItemsEditor value={value} onChange={onChange} showWon={value.result === "won"} />
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
      {value.result === "won" && <p className="text-xs text-slate-400">即決受注で保存すると、商材ごとに契約情報にも自動で登録されます（すべての商材の選択が必要です）。</p>}
    </div>
  );
}

/** 保存用の値に直す。空は null。商材の行は sales_items にまとめて送る（記録の商材・金額の合計はサーバーが決める） */
export function salesPayload(v: SalesDetail) {
  const followup = v.result === "waiting" || v.result === "resales";
  return {
    sales_items: itemsPayload(v, v.result === "won"),
    sales_result: v.result || null,
    sales_followup_at: followup ? fromLocalInput(v.followupAt) : null,
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

/** 返事待ち対応の結果（受注・NG・再営業）。受注は商材（複数）・受注金額・粗利・台数・支払い内容、再営業は次回日時 */
export function ReplyFields({ value, onChange }: { value: SalesDetail; onChange: (v: SalesDetail) => void }) {
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
        <>
          <ItemsEditor value={value} onChange={onChange} showWon />
          <p className="text-xs text-slate-400">受注で保存すると、商材ごとに契約情報にも自動で登録されます（すべての商材の選択が必要です）。</p>
        </>
      )}
    </div>
  );
}

/** 返事待ち対応の保存用の値。商材の行は受注のときだけ */
export function replyPayload(v: SalesDetail) {
  const won = v.result === "won";
  return {
    sales_result: v.result || null,
    sales_items: won ? itemsPayload(v, true) : [],
    sales_followup_at: v.result === "resales" ? fromLocalInput(v.followupAt) : null,
  };
}
