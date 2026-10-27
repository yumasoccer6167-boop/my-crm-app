import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router";
import type { AssociationOverviewItem, AssociationPerson } from "../types";
import { REGIONS, UNKNOWN_REGION } from "../shared/regions";
import { PREFECTURES } from "../shared/prefectures";
import { buildAssociationForest, flattenForest, groupByRegion, topLevelNodes, TOP_LEVEL_LABEL, type AssocTreeNode } from "../lib/association-tree";
import { api, unwrap } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useMasters } from "../lib/masters";
import { AssociationMembers } from "../components/AssociationMembers";
import { AssociationMindMap } from "../components/AssociationMindMap";
import { AssociationStructureDialog, AssociationStructureFields, descendantIds } from "../components/AssociationStructureEditor";
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
  const { me } = useMasters();
  const canEdit = me.role === "admin";
  // 組織図を編集するモード（管理者のみ）。マインドマップでは鉛筆の印、リストでは「組織図の位置」の欄が出る
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);

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
  const flat = useMemo(() => {
    const forest = buildAssociationForest(all);
    return flattenForest(groupByRegion(forest), topLevelNodes(forest));
  }, [all]);
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
        <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <Button variant={editing ? "primary" : "secondary"} size="sm" onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
            {editing ? "組織図の編集を終わる" : "組織図を編集"}
          </Button>
        )}
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
      </div>

      {editing && (
        <p className="rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-900 ring-1 ring-indigo-200">
          組織図の編集中です。{view === "map" ? "マインドマップの協会の右にある ✎ を押すと、その協会を入れる「上位の協会」を選べます。たくさんの協会をまとめて移すときは、リスト表示で選んでください。" : "各協会の「組織図の位置」で、その協会を入れる「上位の協会」を選べます。左のチェックで複数の協会を選ぶと、まとめて同じ上位の協会に移せます。"}
          上位の協会を選ばない協会は「都道府県の協会」になり、都道府県から地区に入ります。「最上位の組織にする」と、全日本私立幼稚園連合会と並ぶ組織になります。変更はすぐ保存されます。
          {view === "map" && (
            <Button size="sm" className="ml-2" onClick={() => changeView("list")}>
              リスト表示でまとめて選ぶ
            </Button>
          )}
        </p>
      )}

      {editing && <AddTopLevel onAdded={reload} />}

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
                {[TOP_LEVEL_LABEL, ...REGIONS.map((r) => r.label), UNKNOWN_REGION.label].map((r) => (
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

          {shown.length === 0 ? <Empty>該当する協会がありません</Empty> : view === "map" ? <AssociationMindMap associations={all.filter((a) => shown.some((f) => f.node.item.id === a.id))} onEdit={editing ? setEditId : undefined} /> : <AssociationList rows={shown} indent={sort === "tree"} editing={editing} all={all} onSaved={reload} />}
        </>
      )}
      {editId != null && <AssociationStructureDialog itemId={editId} items={all} onSaved={reload} onClose={() => setEditId(null)} />}
    </div>
  );
}

/** 最上位の組織（全日本私立幼稚園連合会と同じ位置に並ぶ組織）を追加する。同じ名前の協会が既にあれば、それを最上位にする */
function AddTopLevel({ onAdded }: { onAdded: () => void }) {
  const { associations, reload: reloadMasters } = useMasters();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setError(null);
    try {
      const existing = associations.find((a) => a.name === n);
      const id = existing ? existing.id : (await unwrap(api.associations.$post({ json: { name: n } }))).id;
      await unwrap(api.associations[":id"].structure.$patch({ param: { id: String(id) }, json: { is_top_level: true } }));
      setName("");
      reloadMasters();
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="最上位の組織を追加">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="組織の名前（例：全国私立幼稚園PTA連合会）" className={`${inputCls} min-w-64 flex-1`} aria-label="最上位の組織の名前" />
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
          追加
        </Button>
      </form>
      <p className="mt-1.5 text-xs text-slate-500">追加した組織は、全日本私立幼稚園連合会と同じ位置に表示されます。その下に入る協会は、各協会の ✎（リストでは「組織図の位置」）で「上位の協会」にこの組織を選んでください。</p>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </Card>
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

function AssociationList({ rows, indent, editing, all, onSaved }: { rows: { node: AssocTreeNode; region: string }[]; indent: boolean; editing: boolean; all: AssociationOverviewItem[]; onSaved: () => void }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const members = useApi(
    async () => (openId == null ? null : unwrap(api["association-overview"][":id"].members.$get({ param: { id: String(openId) } }))),
    [openId],
  );
  const shownIds = rows.map((r) => r.node.item.id);
  const allShownSelected = shownIds.length > 0 && shownIds.every((id) => selected.has(id));
  const toggle = (ids: number[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  return (
    <div className="space-y-3">
      {editing && selected.size > 0 && <BulkStructureBar selectedIds={[...selected].filter((id) => all.some((a) => a.id === id))} all={all} onClear={() => setSelected(new Set())} onSaved={() => { setSelected(new Set()); onSaved(); }} />}
    <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-slate-200">
      <table className={`w-full text-sm ${editing ? "min-w-[1200px]" : "min-w-[900px]"}`}>
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            {editing && (
              <th className="w-8 px-3 py-2">
                <input type="checkbox" checked={allShownSelected} onChange={(e) => toggle(shownIds, e.target.checked)} aria-label="表示中の協会をすべて選ぶ" title="表示中の協会をすべて選ぶ" />
              </th>
            )}
            <th className="px-3 py-2 font-medium">協会</th>
            {editing && <th className="px-3 py-2 font-medium">組織図の位置（上位の協会を選ぶ）</th>}
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
                <tr className={`border-b border-slate-100 align-top ${openId === a.id ? "bg-indigo-50/40" : selected.has(a.id) ? "bg-indigo-50/60" : "hover:bg-slate-50"}`}>
                  {editing && (
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(a.id)} onChange={(e) => toggle([a.id], e.target.checked)} aria-label={`${a.name}を選ぶ`} />
                    </td>
                  )}
                  <td className="px-3 py-2" style={{ paddingLeft: indent ? 12 + node.depth * 20 : undefined }}>
                    <button type="button" onClick={() => setOpenId(openId === a.id ? null : a.id)} className="text-left font-medium text-indigo-700 hover:underline" aria-expanded={openId === a.id}>
                      <span className="mr-1 text-[10px] text-slate-500">{openId === a.id ? "▼" : "▶"}</span>
                      {a.name}
                    </button>
                    {!a.is_active && <span className="ml-1.5 text-xs text-slate-400">（無効）</span>}
                    {node.children.length > 0 && <span className="ml-1.5 text-[11px] text-slate-400">下位{node.children.length}協会</span>}
                  </td>
                  {editing && (
                    <td className="min-w-72 px-3 py-2">
                      <AssociationStructureFields item={a} items={all} onSaved={onSaved} compact />
                    </td>
                  )}
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
                    <td colSpan={editing ? 10 : 8} className="px-4 py-3">
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
    </div>
  );
}

const pathName = (all: AssociationOverviewItem[], id: number): string => {
  const byId = new Map(all.map((a) => [a.id, a]));
  const names: string[] = [];
  for (let cur = byId.get(id), n = 0; cur && n < 20; cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined, n++) names.unshift(cur.name);
  return names.join(" ＞ ");
};

/** 選んだ協会の「上位の協会」（と都道府県）を、まとめて同じ内容にする。1件でも入れられない協会があれば、全件とも変更しない */
function BulkStructureBar({ selectedIds, all, onClear, onSaved }: { selectedIds: number[]; all: AssociationOverviewItem[]; onClear: () => void; onSaved: () => void }) {
  // "" 未選択 / "none" 上位なし（都道府県の協会）/ "top" 最上位の組織 / 協会のID
  const [target, setTarget] = useState("");
  const [prefecture, setPrefecture] = useState("keep"); // keep 変えない / auto 加盟施設から自動 / 都道府県名
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = useMemo(() => {
    // 選んだ協会と、その下位の協会は、上位の協会にできない
    const blocked = new Set<number>();
    for (const id of selectedIds) descendantIds(all, id).forEach((x) => blocked.add(x));
    return all.filter((a) => !blocked.has(a.id)).sort((x, y) => pathName(all, x.id).localeCompare(pathName(all, y.id), "ja"));
  }, [all, selectedIds]);

  async function apply() {
    if (!target || busy) return;
    const label = target === "none" ? "都道府県の協会" : target === "top" ? "最上位の組織" : `「${pathName(all, Number(target))}」の下`;
    if (!window.confirm(`選んだ${selectedIds.length}協会を、${label}に移します。よろしいですか？`)) return;
    setBusy(true);
    setError(null);
    try {
      const json: { association_ids: number[]; parent_id?: number | null; prefecture?: string | null; is_top_level?: boolean } = { association_ids: selectedIds };
      if (target === "top") json.is_top_level = true;
      else {
        json.parent_id = target === "none" ? null : Number(target);
        if (target === "none" && prefecture !== "keep") json.prefecture = prefecture === "auto" ? null : prefecture;
        if (target === "none") json.is_top_level = false;
      }
      await unwrap(api["association-structure"].bulk.$post({ json }));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sticky top-0 z-10 rounded-lg bg-white p-3 shadow ring-1 ring-indigo-300">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-900">{selectedIds.length}協会を選択中</span>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          上位の協会
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={`${selectCls} max-w-md`} aria-label="まとめて移す先">
            <option value="">選んでください</option>
            <option value="none">（なし：都道府県の協会として、地区の下に置く）</option>
            <option value="top">（最上位の組織にする）</option>
            {candidates.map((a) => (
              <option key={a.id} value={a.id}>
                {pathName(all, a.id)}
              </option>
            ))}
          </select>
        </label>
        {target === "none" && (
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            都道府県
            <select value={prefecture} onChange={(e) => setPrefecture(e.target.value)} className={selectCls} aria-label="まとめて決める都道府県">
              <option value="keep">（変えない）</option>
              <option value="auto">（加盟施設から自動）</option>
              {PREFECTURES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button variant="primary" size="sm" onClick={() => void apply()} disabled={!target || busy}>
          まとめて移す
        </Button>
        <Button size="sm" variant="ghost" onClick={onClear}>
          選択をやめる
        </Button>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}
