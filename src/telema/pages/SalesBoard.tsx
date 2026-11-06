import { useState } from "react";
import type { SalesBoardRow, TargetsData } from "../types";
import { api, unwrap } from "../lib/api";
import { todayJst } from "../lib/format";
import { useMasters } from "../lib/masters";
import { pToYen, yenToP } from "../lib/points";
import { useApi } from "../lib/useApi";
import { Button, Card, Empty, ErrorBox, inputCls, Loading } from "../components/ui";

const p = (yen: number) => (yen / 10000).toLocaleString(undefined, { maximumFractionDigits: 2 });
const rate = (n: number | null) => (n == null ? "-" : `${n.toFixed(1)}%`);
const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

const ROW_STYLE: Record<SalesBoardRow["level"], string> = {
  member: "bg-white text-slate-700",
  unit: "bg-white font-semibold text-slate-900",
  group: "bg-sky-100 font-semibold text-slate-900",
  total: "bg-slate-800 font-semibold text-white",
};

/** 数字の列。value が負のときは赤で出す（残数の列） */
const COLUMNS: { label: string; real?: boolean; get: (r: SalesBoardRow) => string; value?: (r: SalesBoardRow) => number }[] = [
  { label: "月間目標 営業P", get: (r) => p(r.target_gp) },
  { label: "月間目標 台数", get: (r) => String(r.target_units) },
  { label: "累計必要数 営業P", get: (r) => p(r.need_gp) },
  { label: "累計必要数 台数", get: (r) => String(r.need_units) },
  { label: "実数 営業P", real: true, get: (r) => p(r.act_gp) },
  { label: "実数 台数", real: true, get: (r) => String(r.act_units) },
  { label: "実数 契約数", real: true, get: (r) => String(r.contracts) },
  { label: "実数 受注件数", real: true, get: (r) => String(r.orders) },
  { label: "達成率 営業P", get: (r) => rate(r.rate_gp) },
  { label: "達成率 台数", get: (r) => rate(r.rate_units) },
  { label: "営業P残数 現進捗", get: (r) => num((r.act_gp - r.need_gp) / 10000), value: (r) => r.act_gp - r.need_gp },
  { label: "台数残数 現進捗", get: (r) => num(r.act_units - r.need_units), value: (r) => r.act_units - r.need_units },
  { label: "営業P残数 月末", get: (r) => num((r.act_gp - r.target_gp) / 10000), value: (r) => r.act_gp - r.target_gp },
  { label: "台数残数 月末", get: (r) => num(r.act_units - r.target_units), value: (r) => r.act_units - r.target_units },
  { label: "決アポ", get: (r) => String(r.appo_dm) },
  { label: "担アポ", get: (r) => String(r.appo_staff) },
  { label: "商談数", get: (r) => String(r.deals) },
  { label: "落ち率", get: (r) => rate(r.rate_fall) },
];

/** 営業成績ダッシュボード：組織図の部署ごとに、営業担当の月間目標・累計必要数・実数・達成率を並べ、課・部・事業部の小計と合計を出す */
export function SalesBoard() {
  const { me } = useMasters();
  const [month, setMonth] = useState(todayJst().slice(0, 7));
  const [editing, setEditing] = useState(false);
  const { data, error, loading, reload } = useApi(() => unwrap(api["sales-board"].$get({ query: { month } })), [month]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-sm text-slate-600">
          組織図の部署ごとに、営業担当の月間目標と実績を一覧します。累計必要数は月間目標を稼働日で日割りしたもの（四捨五入）、達成率は実数 ÷ 累計必要数です。
        </p>
        {me.role === "admin" && (
          <Button size="sm" onClick={() => setEditing(!editing)}>
            {editing ? "目標設定を閉じる" : "目標設定"}
          </Button>
        )}
      </div>
      <Card
        title={
          <span className="flex flex-wrap items-center gap-4 text-sm font-normal text-slate-600">
            <label className="flex items-center gap-2 whitespace-nowrap">
              対象月
              <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${inputCls} w-40`} aria-label="対象月" />
            </label>
            {data && (
              <>
                <span>
                  総稼働日数 <b className="ml-1 text-slate-900">{data.workdays_total}</b>
                </span>
                <span>
                  累計日数 <b className="ml-1 text-slate-900">{data.workdays_elapsed}</b>
                </span>
              </>
            )}
          </span>
        }
      >
        {error ? (
          <ErrorBox message={error} onRetry={reload} />
        ) : loading && !data ? (
          <Loading />
        ) : !data || data.rows.length === 0 ? (
          <Empty>表示するメンバーがいません。組織図で、部署にメンバーを配属してください。</Empty>
        ) : (
          <div className="overflow-x-auto rounded-md ring-1 ring-slate-200">
            <table className="w-full min-w-[1500px] border-collapse text-sm tabular-nums">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-600">
                  <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-medium">氏名</th>
                  {COLUMNS.map((c) => (
                    <th key={c.label} className={`whitespace-nowrap px-3 py-2 text-right font-medium ${c.real ? "bg-indigo-50" : ""}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={`${r.kind}${r.user_id ?? r.department_id ?? "x"}${i}`} className={`border-t border-slate-100 ${ROW_STYLE[r.level]}`}>
                    <td className={`sticky left-0 z-10 whitespace-nowrap px-3 py-2 ${ROW_STYLE[r.level]}`} style={r.kind === "member" ? { paddingLeft: "1.25rem" } : undefined}>
                      {r.name}
                    </td>
                    {COLUMNS.map((c) => (
                      <td key={c.label} className={`whitespace-nowrap px-3 py-2 text-right ${c.value && c.value(r) < 0 ? (r.level === "total" ? "text-red-400" : "text-red-600") : ""}`}>
                        {c.get(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <TargetEditor month={month} order={(data?.rows ?? []).filter((r) => r.kind === "member").map((r) => r.user_id!)} onSaved={reload} />}
    </div>
  );
}

/** 全メンバーの月間目標（営業P・台数）をまとめて設定する（管理者） */
function TargetEditor({ month, order, onSaved }: { month: string; order: number[]; onSaved: () => void }) {
  const { data, error, loading, reload } = useApi(() => unwrap(api.targets.$get({ query: { month } })), [month]);
  return (
    <Card title={`${month} の月間目標を設定`}>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Loading /> : data && <TargetTable key={month} data={data} order={order} onSaved={() => { onSaved(); void reload(); }} />}
    </Card>
  );
}

function TargetTable({ data, order, onSaved }: { data: TargetsData; order: number[]; onSaved: () => void }) {
  const rank = new Map(order.map((id, i) => [id, i]));
  const items = [...data.items].sort((a, b) => (rank.get(a.user_id) ?? 1e9) - (rank.get(b.user_id) ?? 1e9));
  const [draft, setDraft] = useState<Record<number, { gp: string; units: string }>>(() => Object.fromEntries(items.map((t) => [t.user_id, { gp: yenToP(t.gross_profit), units: t.units == null ? "" : String(t.units) }])));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const changed = items.filter((t) => {
        const d = draft[t.user_id]!;
        return d.gp !== yenToP(t.gross_profit) || d.units !== (t.units == null ? "" : String(t.units));
      });
      for (const t of changed) {
        const d = draft[t.user_id]!;
        await unwrap(api.targets[":user_id"][":month"].$put({ param: { user_id: String(t.user_id), month: data.month }, json: { gross_profit: pToYen(d.gp) ?? 0, units: Math.max(0, Math.round(Number(d.units) || 0)) } }));
      }
      setMessage(changed.length ? `${changed.length}人分を保存しました` : "変更はありません");
      onSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="max-h-96 overflow-auto rounded-md ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">氏名</th>
              <th className="px-3 py-2 text-left font-medium">営業P（1万円＝1P）</th>
              <th className="px-3 py-2 text-left font-medium">台数</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.user_id} className="border-t border-slate-100">
                <td className="whitespace-nowrap px-3 py-1.5">{t.user_name}</td>
                <td className="px-3 py-1.5">
                  <input type="number" min={0} step="any" inputMode="decimal" value={draft[t.user_id]!.gp} onChange={(e) => setDraft({ ...draft, [t.user_id]: { ...draft[t.user_id]!, gp: e.target.value } })} className={`${inputCls} w-32`} aria-label={`${t.user_name}の営業P`} />
                </td>
                <td className="px-3 py-1.5">
                  <input type="number" min={0} step={1} inputMode="numeric" value={draft[t.user_id]!.units} onChange={(e) => setDraft({ ...draft, [t.user_id]: { ...draft[t.user_id]!, units: e.target.value } })} className={`${inputCls} w-24`} aria-label={`${t.user_name}の台数`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" size="sm" disabled={saving} onClick={save}>
          {saving ? "保存中…" : "保存"}
        </Button>
        {message && <span className="text-xs text-slate-600">{message}</span>}
      </div>
    </div>
  );
}
