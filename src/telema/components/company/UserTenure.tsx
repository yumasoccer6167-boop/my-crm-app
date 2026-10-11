import type { Contract } from "../../types";
import { fmtDate, todayJst } from "../../lib/format";
import { fmtTenure, tenure } from "../../lib/tenure";

/** ユーザー（契約済みの施設）のカルテに出す、付き合いの長さ（最初の契約日から今日まで）と契約件数 */
export function UserTenure({ contracts }: { contracts: Contract[] }) {
  const active = contracts.filter((c) => c.is_active);
  const first = active.map((c) => c.contract_date).sort()[0];
  const t = first ? tenure(first, todayJst()) : null;
  return (
    <div className="mt-3 flex flex-wrap items-baseline gap-x-8 gap-y-1 border-t border-slate-100 pt-3 text-sm">
      <div>
        <span className="text-xs text-slate-500">付き合い</span>
        {first ? (
          t ? (
            <span className="ml-2">
              <span className="font-semibold text-slate-900">{fmtTenure(t)}</span>
              <span className="ml-1 tabular-nums text-slate-600">（{t.days.toLocaleString()}日）</span>
              <span className="ml-2 text-xs text-slate-500">{fmtDate(first)} の初回契約から</span>
            </span>
          ) : (
            <span className="ml-2 text-slate-600">{fmtDate(first)} に契約開始予定</span>
          )
        ) : (
          <span className="ml-2 text-slate-400">契約情報が未登録です（登録すると表示されます）</span>
        )}
      </div>
      <div>
        <span className="text-xs text-slate-500">契約件数</span>
        <span className="ml-2 font-semibold tabular-nums text-slate-900">{active.length}件</span>
      </div>
    </div>
  );
}
