import { Fragment, useState } from "react";
import { api, unwrap } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Card, Empty, ErrorBox, Loading } from "./ui";

type Cell = { calls: number; appointments: number };
const ZERO: Cell = { calls: 0, appointments: 0 };
const add = (a: Cell, b: Cell): Cell => ({ calls: a.calls + b.calls, appointments: a.appointments + b.appointments });
const rate = (c: Cell) => (c.calls ? `${((c.appointments / c.calls) * 100).toFixed(1)}%` : "—");

/** 担当（架電した人）ごとの、月別のコール数と時間設定成立数 */
export function CallStatsCard() {
  const [months, setMonths] = useState(6);
  const { data, error, loading, reload } = useApi(() => unwrap(api.dashboard["calls-monthly"].$get({ query: { months: String(months) } })), [months]);

  const body = () => {
    if (error) return <ErrorBox message={error} onRetry={reload} />;
    if (loading && !data) return <Loading />;
    if (!data) return null;

    // 担当 × 月 の表に組み直す（担当なし＝取り込みなどで架電者が分からない分）
    const users = new Map<string, { name: string; cells: Map<string, Cell> }>();
    for (const r of data.rows) {
      const key = String(r.user_id ?? "none");
      const u = users.get(key) ?? { name: r.user_name ?? "（担当なし）", cells: new Map<string, Cell>() };
      u.cells.set(r.month, add(u.cells.get(r.month) ?? ZERO, r));
      users.set(key, u);
    }
    if (users.size === 0) return <Empty>この期間の架電はまだありません</Empty>;
    const list = [...users.values()].map((u) => ({ ...u, total: [...u.cells.values()].reduce(add, ZERO) })).sort((a, b) => b.total.calls - a.total.calls);
    const monthTotal = (m: string) => list.reduce((s, u) => add(s, u.cells.get(m) ?? ZERO), ZERO);
    const grand = list.reduce((s, u) => add(s, u.total), ZERO);
    const label = (m: string) => `${Number(m.slice(5))}月`;

    const cell = (c: Cell, strong = false) => (
      <td className={`px-2 py-1.5 text-right tabular-nums ${strong ? "bg-slate-50" : ""}`}>
        <div className={`${strong ? "font-semibold" : ""} ${c.calls ? "text-slate-900" : "text-slate-300"}`}>{c.calls.toLocaleString()}</div>
        <div className={`text-xs ${c.appointments ? "font-medium text-amber-600" : "text-slate-300"}`}>{c.appointments.toLocaleString()}</div>
      </td>
    );

    return (
      <div className="-mx-4 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500">
              <th className="px-4 py-1.5 text-left font-medium">担当</th>
              {data.months.map((m) => (
                <th key={m} className="px-2 py-1.5 text-right font-medium" title={m}>
                  {m.endsWith("-01") || m === data.months[0] ? `${m.slice(0, 4)}年` : ""}
                  {label(m)}
                </th>
              ))}
              <th className="bg-slate-50 px-2 py-1.5 text-right font-medium">合計</th>
              <th className="px-4 py-1.5 text-right font-medium">成立率</th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.name} className="border-b border-slate-100">
                <td className="whitespace-nowrap px-4 py-1.5 font-medium text-slate-800">{u.name}</td>
                {data.months.map((m) => (
                  <Fragment key={m}>{cell(u.cells.get(m) ?? ZERO)}</Fragment>
                ))}
                {cell(u.total, true)}
                <td className="px-4 py-1.5 text-right tabular-nums text-slate-600">{rate(u.total)}</td>
              </tr>
            ))}
            {list.length > 1 && (
              <tr className="border-t-2 border-slate-200 bg-slate-50/60">
                <td className="px-4 py-1.5 font-semibold text-slate-800">合計</td>
                {data.months.map((m) => (
                  <Fragment key={m}>{cell(monthTotal(m), true)}</Fragment>
                ))}
                {cell(grand, true)}
                <td className="px-4 py-1.5 text-right font-semibold tabular-nums text-slate-700">{rate(grand)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <Card
      title={
        <>
          担当別の架電実績（月別）
          <span className="ml-2 text-xs font-normal text-slate-500">
            上段 コール数 ／ <span className="text-amber-600">下段 {data?.appointment_labels.join("・") || "時間設定成立"}</span>
          </span>
        </>
      }
      action={
        <select
          className="rounded-md bg-white px-2 py-1 text-xs ring-1 ring-inset ring-slate-300"
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
        >
          <option value={3}>直近3か月</option>
          <option value={6}>直近6か月</option>
          <option value={12}>直近12か月</option>
        </select>
      }
    >
      {body()}
    </Card>
  );
}
