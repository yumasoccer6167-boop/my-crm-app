import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router";
import type { AssociationPerson } from "../types";
import { REGIONS, UNKNOWN_REGION } from "../shared/regions";
import { buildAssociationForest, flattenForest, groupByRegion, type AssocTreeNode } from "../lib/association-tree";
import { api, unwrap } from "../lib/api";
import { useApi } from "../lib/useApi";
import { AssociationMembers } from "../components/AssociationMembers";
import { AssociationMindMap } from "../components/AssociationMindMap";
import { ChairCrown, OfficerCrown } from "../components/CompanyTable";
import { Button, Card, Empty, ErrorBox, inputCls } from "../components/ui";

type View = "map" | "list";
const selectCls = "rounded-md border-0 bg-white px-2.5 py-1.5 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500";
const VIEW_KEY = "telema:associations-view";
const SORTS = [
  { value: "tree", label: "組織図の順（地区→都道府県→下位の協会）" },
  { value: "facilities", label: "加盟施設数が多い順" },
  { value: "organizations", label: "加盟法人数が多い順" },
  { value: "name", label: "協会名順" },
];

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "map";
  } catch {
    return "map";
  }
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-lg bg-white px-4 py-3 ring-1 ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums text-slate-900">{value.toLocaleString()}</div>
      {note && <div className="text-[11px] text-slate-400">{note}</div>}
    </div>
  );
}

/** 協会の組織図・加盟施設数・加盟法人数の一覧。マインドマップ表示とリスト表示を切り替えられる */
export function Associations() {
  const { data, error, loading, reload } = useApi(() => unwrap(api["association-overview"].$get()), []);
  const [view, setView] = useState<View>(loadView);
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [sort, setSort] = useState("tree");
  const [showInactive, setShowInactive] = useState(false);

  function changeView(v: View) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // 保存できなくても動作は続ける
    }
  }

  const all = useMemo(() => (data?.associations ?? []).filter((a) => showInactive || a.is_active), [data, showInactive]);
  // 組織図の順に平らにする。地区は、いちばん上の協会（都道府県の協会）から決まる
  const flat = useMemo(() => flattenForest(groupByRegion(buildAssociationForest(all))), [all]);
  const shown = useMemo(() => {
    const t = q.trim();
    const list = flat.filter((f) => (!t || f.node.item.name.includes(t)) && (!region || f.region === region));
    const cmp: Record<string, (x: (typeof flat)[number], y: (typeof flat)[number]) => number> = {
      facilities: (x, y) => y.node.item.facility_count - x.node.item.facility_count,
      organizations: (x, y) => y.node.item.organization_count - x.node.item.organization_count,
      name: (x, y) => x.node.item.name.localeCompare(y.node.item.name, "ja"),
    };
    return sort === "tree" ? list : [...list].sort(cmp[sort]!);
  }, [flat, q, region, sort]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">加盟協会ごとの加盟施設・加盟法人と、協会会長・協会役員の一覧です。</p>
        <div role="tablist" aria-label="表示の切り替え" className="inline-flex rounded-md bg-slate-100 p-0.5 text-sm">
          {([["map", "マインドマップ"], ["list", "リスト"]] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => changeView(v)}
              className={`rounded px-3 py-1 font-medium ${view === v ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <p className="text-sm text-slate-400">読み込み中…</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="加盟協会数" value={data.totals.association_count} />
            <Stat label="加盟施設数" value={data.totals.facility_count} note="複数の協会に入っていても1施設" />
            <Stat label="加盟法人数" value={data.totals.organization_count} note="法人が登録された施設の法人" />
            <Stat label="うちユーザー施設" value={data.totals.user_count} />
          </div>

          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="協会名で探す" className={`${inputCls} min-w-52 flex-1`} />
              <select value={region} onChange={(e) => setRegion(e.target.value)} className={selectCls} aria-label="地区">
                <option value="">地区（すべて）</option>
                {[...REGIONS.map((r) => r.label), UNKNOWN_REGION.label].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              {view === "list" && (
                <select value={sort} onChange={(e) => setSort(e.target.value)} className={selectCls} aria-label="並び順">
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              )}
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                無効な協会も表示
              </label>
              <span className="ml-auto text-sm text-slate-500">{shown.length}協会</span>
            </div>
          </Card>

          {shown.length === 0 ? <Empty>該当する協会がありません</Empty> : view === "map" ? <AssociationMindMap associations={all.filter((a) => shown.some((f) => f.node.item.id === a.id))} /> : <AssociationList rows={shown} indent={sort === "tree"} />}
        </>
      )}
    </div>
  );
}

function PeopleCell({ people, kind }: { people: AssociationPerson[]; kind: "chair" | "officer" }) {
  if (people.length === 0) return <span className="text-slate-300">—</span>;
  return (
    <ul className="space-y-0.5">
      {people.map((p) => (
        <li key={p.contact_id} className="flex items-center gap-1 text-sm">
          {kind === "chair" ? <ChairCrown /> : <OfficerCrown />}
          <Link to={`/companies/${p.company_id}`} className="text-indigo-700 hover:underline" title={p.company_name}>
            {p.name ?? "氏名不明"}
          </Link>
          {p.role && <span className="text-xs text-slate-500">（{p.role}）</span>}
        </li>
      ))}
    </ul>
  );
}

function AssociationList({ rows, indent }: { rows: { node: AssocTreeNode; region: string }[]; indent: boolean }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const members = useApi(
    async () => (openId == null ? null : unwrap(api["association-overview"][":id"].members.$get({ param: { id: String(openId) } }))),
    [openId],
  );
  return (
    <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-slate-200">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="px-3 py-2 font-medium">協会</th>
            <th className="px-3 py-2 font-medium">地区</th>
            <th className="px-3 py-2 font-medium">都道府県</th>
            <th className="px-3 py-2 text-right font-medium" title="下位の協会の加盟施設を含みます">加盟施設数</th>
            <th className="px-3 py-2 text-right font-medium">加盟法人数</th>
            <th className="px-3 py-2 text-right font-medium">ユーザー施設</th>
            <th className="px-3 py-2 font-medium">協会会長</th>
            <th className="px-3 py-2 font-medium">協会役員</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ node, region }) => {
            const a = node.item;
            return (
              <Fragment key={a.id}>
                <tr className={`border-b border-slate-100 align-top ${openId === a.id ? "bg-indigo-50/40" : "hover:bg-slate-50"}`}>
                  <td className="px-3 py-2" style={{ paddingLeft: indent ? 12 + node.depth * 20 : undefined }}>
                    <button type="button" onClick={() => setOpenId(openId === a.id ? null : a.id)} className="text-left font-medium text-indigo-700 hover:underline" aria-expanded={openId === a.id}>
                      <span className="mr-1 text-[10px] text-slate-500">{openId === a.id ? "▼" : "▶"}</span>
                      {a.name}
                    </button>
                    {!a.is_active && <span className="ml-1.5 text-xs text-slate-400">（無効）</span>}
                    {node.children.length > 0 && <span className="ml-1.5 text-[11px] text-slate-400">下位{node.children.length}協会</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{region}</td>
                  <td className="px-3 py-2 text-slate-700">{a.prefecture ?? <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.facility_count.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.organization_count.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.user_count.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <PeopleCell people={a.chairs} kind="chair" />
                  </td>
                  <td className="px-3 py-2">
                    <PeopleCell people={a.officers} kind="officer" />
                  </td>
                </tr>
                {openId === a.id && (
                  <tr className="border-b border-slate-100 bg-slate-50/60">
                    <td colSpan={8} className="px-4 py-3">
                      {a.facility_count > a.own_facility_count && <p className="mb-2 text-xs text-slate-500">この協会に直接加盟している施設（{a.own_facility_count}施設）です。下位の協会の施設は、各協会の行で見られます。</p>}
                      {members.error ? (
                        <ErrorBox message={members.error} onRetry={members.reload} />
                      ) : members.data ? (
                        <AssociationMembers facilities={members.data.facilities} truncated={members.data.truncated} />
                      ) : (
                        <p className="text-sm text-slate-400">読み込み中…</p>
                      )}
                      <div className="mt-2">
                        <Button size="sm" variant="ghost" onClick={() => setOpenId(null)}>
                          閉じる
                        </Button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
