import { api, unwrap } from "../../lib/api";
import { SALES_TERMS } from "../../lib/record-kind";
import { useApi } from "../../lib/useApi";
import { inputCls } from "../ui";

export type SalesDetail = { product: string; fee: string; term: string };
export const emptySales: SalesDetail = { product: "", fee: "", term: "" };

/** 訪問の内容が「営業」のときの、商材（今ある商材から選ぶ）・月額（円）・期間（現金一括／12〜84か月） */
export function SalesDetailFields({ value, onChange, currentProduct }: { value: SalesDetail; onChange: (v: SalesDetail) => void; currentProduct?: string | null }) {
  const products = useApi(() => unwrap(api.products.$get()), []);
  // 商材マスタから外れた商材でも、この記録にすでに付いているものは選択肢に残す
  const options = [...(products.data ?? [])];
  if (currentProduct && !options.includes(currentProduct)) options.unshift(currentProduct);
  return (
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
  );
}

/** 保存用の値に直す。空は null */
export function salesPayload(v: SalesDetail) {
  const fee = v.fee.trim();
  return { sales_product: v.product || null, sales_monthly_fee: fee === "" ? null : Math.max(0, Math.round(Number(fee))), sales_term: v.term || null };
}
