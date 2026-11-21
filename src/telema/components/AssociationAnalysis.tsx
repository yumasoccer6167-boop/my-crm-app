import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { AssocTreeNode } from "../lib/association-tree";
import type { AssociationOverviewItem } from "../types";
import { Card } from "./ui";

type Metric = "rate" | "facilities" | "organizations" | "users";
const METRICS: { key: Metric; label: string; value: (a: AssociationOverviewItem) => number | null }[] = [
  { key: "rate", label: "ユーザー率が高い順", value: (a) => a.user_rate },
  { key: "facilities", label: "加盟施設が多い順", value: (a) => a.facility_count },
  { key: "organizations", label: "加盟法人が多い順", value: (a) => a.organization_count },
  { key: "users", label: "ユーザー施設が多い順", value: (a) => a.user_count },
];
const MIN_ORGS = [0, 3, 5, 10, 20];
const selectCls = "rounded-md border-0 bg-white px-2.5 py-1.5 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500";
const num = (n: number) => n.toLocaleString();

/** バー付きの数字のセル。バーは表示中でいちばん大きい値を100%にした長さ */
function BarCell({ value, max, label, color, active }: { value: number | null; max: number; label: string; color: string; active: boolean }) {
  return (
    <td className={`px-3 py-2 ${active ? "bg-indigo-50/50" : ""}`}>
      <div className="flex items-center justify-end gap-2">
        <div className="hidden h-2 w-20 rounded-full bg-slate-100 md:block" aria-hidden>
          <div className={`h-2 rounded-full ${color}`} style={{ width: `${value && max ? (value / max) * 100 : 0}%` }} />
        </div>
        <span className={`w-16 text-right tabular-nums ${active ? "font-semibold text-slate-900" : "text-slate-700"}`}>{value == null ? <span className="text-slate-300">—</span> : label}</span>
      </div>
    </td>
  );
}

/** 協会の分析：ユーザー率・加盟施設数・加盟法人数・ユーザー施設数の順位。数字は協会の一覧と同じ（下位の協会の加盟施設も含む。ユーザー率は協会カルテと同じ） */
export function AssociationAnalysis({ rows }: { rows: { node: AssocTreeNode; region: string }[] }) {
  const [metric, setMetric] = useState<Metric>("rate");
  const [leafOnly, setLeafOnly] = useState(false);
  const [minOrgs, setMinOrgs] = useState(0);

  const ranked = useMemo(() => {
    const m = METRICS.find((x) => x.key === metric)!;
    const list = rows
      .filter(({ node }) => (!leafOnly || node.children.length === 0) && node.item.organization_count >= minOrgs)
      .map(({ node, region }) => ({ a: node.item, region }));
    // 選んだ指標の大きい順。同じ値なら、ユーザー率→加盟施設数→協会名の順。値が無いもの（加盟法人なしのユーザー率）は最後
    list.sort((x, y) => {
      const vx = m.value(x.a), vy = m.value(y.a);
      if ((vx == null) !== (vy == null)) return vx == null ? 1 : -1;
      return (vy ?? 0) - (vx ?? 0) || (y.a.user_rate ?? -1) - (x.a.user_rate ?? -1) || y.a.facility_count - x.a.facility_count || x.a.name.localeCompare(y.a.name, "ja");
    });
    // 同じ値は同じ順位にする
    let prev: number | null | undefined;
    let rank = 0;
    return list.map((r, i) => {
      const v = m.value(r.a);
      if (i === 0 || v !== prev) rank = i + 1;
      prev = v;
      return { ...r, rank: v == null ? null : rank };
    });
  }, [rows, metric, leafOnly, minOrgs]);

  const max = (f: (a: AssociationOverviewItem) => number) => Math.max(1, ...ranked.map((r) => f(r.a)));
  const maxFac = max((a) => a.facility_count);
  const maxOrg = max((a) => a.organization_count);
  const maxUser = max((a) => a.user_count);
  const th = (key: Metric | null, label: string, title?: string) => (
    <th className={`whitespace-nowrap px-3 py-2 text-right font-medium ${key === metric ? "bg-indigo-50/50 text-indigo-700" : ""}`} title={title}>
      {label}
      {key === metric && <span aria-hidden> ▼</span>}
    </th>
  );

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div role="tablist" aria-label="順位の基準" className="inline-flex flex-wrap rounded-md bg-slate-100 p-0.5 text-sm">
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={metric === m.key}
                onClick={() => setMetric(m.key)}
                className={`rounded px-3 py-1 font-medium ${metric === m.key ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-sm text-slate-600" title="地区・都道府県の協会のように、下位の協会をまとめた協会を除き、実際に施設が加盟している協会だけを並べます">
            <input type="checkbox" checked={leafOnly} onChange={(e) => setLeafOnly(e.target.checked)} />
            下位の協会を持たない協会だけ
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-600" title="加盟法人が少ない協会は、ユーザー率が極端になりやすいので除けます">
            加盟法人が
            <select value={minOrgs} onChange={(e) => setMinOrgs(Number(e.target.value))} className={selectCls} aria-label="加盟法人数の下限">
              {MIN_ORGS.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "指定なし" : `${n}以上`}
                </option>
              ))}
            </select>
          </label>
          <span className="ml-auto text-sm text-slate-500">{ranked.length}協会</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          ユーザー率は「ユーザー法人 ÷ 加盟法人」で、協会カルテと同じです（法人が登録されていない施設は数えません）。加盟施設・加盟法人は、下位の協会の加盟施設も含みます。上の絞り込み（協会名・地区）も効きます。
        </p>
      </Card>

      {ranked.length === 0 ? (
        <p className="rounded-lg bg-white px-4 py-8 text-center text-sm text-slate-400 ring-1 ring-slate-200">条件に合う協会がありません</p>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-slate-200">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="w-12 px-3 py-2 text-right font-medium">順位</th>
                <th className="px-3 py-2 font-medium">協会</th>
                <th className="px-3 py-2 font-medium">地区・都道府県</th>
                {th("facilities", "加盟施設数", "下位の協会の加盟施設を含みます")}
                {th("organizations", "加盟法人数")}
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">ユーザー法人数</th>
                {th("rate", "ユーザー率", "ユーザー法人 ÷ 加盟法人")}
                {th("users", "ユーザー施設")}
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ a, region, rank }) => (
                <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{rank ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link to={`/associations/${a.id}`} className="font-medium text-indigo-700 hover:underline">
                      {a.name}
                    </Link>
                    {!a.is_active && <span className="ml-1.5 text-xs text-slate-400">（無効）</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                    {region}
                    {a.prefecture && <span className="text-slate-400">／{a.prefecture}</span>}
                  </td>
                  <BarCell value={a.facility_count} max={maxFac} label={num(a.facility_count)} color="bg-indigo-400" active={metric === "facilities"} />
                  <BarCell value={a.organization_count} max={maxOrg} label={num(a.organization_count)} color="bg-sky-400" active={metric === "organizations"} />
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{num(a.user_organization_count)}</td>
                  <BarCell value={a.user_rate} max={100} label={a.user_rate == null ? "—" : `${a.user_rate.toFixed(1)}%`} color="bg-emerald-500" active={metric === "rate"} />
                  <BarCell value={a.user_count} max={maxUser} label={num(a.user_count)} color="bg-amber-400" active={metric === "users"} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
