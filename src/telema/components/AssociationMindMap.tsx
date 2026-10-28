import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Crown, Pencil } from "lucide-react";
import type { AssociationMembers, AssociationOverviewItem } from "../types";
import { NATIONAL_ASSOCIATION_NAME } from "../shared/regions";
import { api, unwrap } from "../lib/api";
import { buildAssociationForest, groupByRegion, topLevelNodes, type AssocTreeNode } from "../lib/association-tree";
import { layoutMindMap, NODE_H, NODE_W, type MapNode } from "../lib/mindmap-layout";
import { Button } from "./ui";
import { groupByOrganization } from "./AssociationMembers";

const KIND_STYLE: Record<MapNode["kind"], string> = {
  root: "bg-slate-800 text-white ring-slate-800",
  region: "bg-indigo-600 text-white ring-indigo-600",
  assoc: "bg-white text-slate-900 ring-indigo-400 font-semibold",
  person: "bg-amber-50 text-amber-900 ring-amber-200",
  org: "bg-sky-50 text-sky-900 ring-sky-200",
  facility: "bg-white text-slate-800 ring-slate-300",
  note: "bg-transparent text-slate-400 ring-transparent",
};

const ONLY_KEY = "telema:associations-map-only";

function loadOnly(): boolean {
  try {
    return localStorage.getItem(ONLY_KEY) === "1";
  } catch {
    return false;
  }
}

type MemberState = AssociationMembers | "loading" | "error";

/**
 * 協会のマインドマップ（組織図）。左から「全日本私立幼稚園連合会」→地区→都道府県の協会→地区単位の協会→各地域の協会と広がる。
 * 協会を開くと、下位の協会に加えて、協会会長・役員と、その協会に直接加盟している法人・施設が出る（加盟施設は開いたときに読み込む）。
 * ノードをクリックで開閉。施設・会長・役員はクリックでカルテへ
 */
export function AssociationMindMap({ associations, onEdit }: { associations: AssociationOverviewItem[]; onEdit?: (id: number) => void }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<Record<number, MemberState>>({});
  // 協会だけの表示（会長・役員・法人・施設を出さない）。選んだ表示は覚えておく
  const [only, setOnly] = useState(loadOnly);

  function changeOnly(v: boolean) {
    setOnly(v);
    try {
      localStorage.setItem(ONLY_KEY, v ? "1" : "0");
    } catch {
      // 保存できなくても動作は続ける
    }
  }

  const forest = useMemo(() => buildAssociationForest(associations), [associations]);
  const groups = useMemo(() => groupByRegion(forest), [forest]);
  const tops = useMemo(() => topLevelNodes(forest), [forest]);

  // 最上位の組織は、全日本私立幼稚園連合会の下に並べて、複数登録できる
  const roots = useMemo<MapNode[]>(() => {
    const national: MapNode = {
      key: "root",
      label: NATIONAL_ASSOCIATION_NAME,
      sub: `${groups.reduce((n, g) => n + g.top.length, 0)}の都道府県協会`,
      kind: "root",
      // 地区は全部並べる（協会がまだ無い地区も）。地区が決まらない協会が無ければ「地区不明」は出さない
      children: groups
        .filter((g) => g.key !== "unknown" || g.top.length > 0)
        .map((g) => ({
          key: `region:${g.key}`,
          label: g.label,
          sub: g.top.length ? `${g.top.length}協会・${g.facilityCount.toLocaleString()}施設` : "協会はまだありません",
          kind: "region" as const,
          children: g.top.map((n) => assocNode(n, members, only)),
        })),
    };
    return [national, ...tops.map((n) => ({ ...assocNode(n, members, only), top: true }))];
  }, [groups, tops, members, only]);

  const { placed, links, width, height } = useMemo(() => layoutMindMap(roots, open), [roots, open]);

  // 協会だけの表示から詳しい表示に戻したとき、開いている協会の加盟施設を読み込む
  useEffect(() => {
    if (only) return;
    for (const key of open) if (key.startsWith("assoc:")) void loadMembers(Number(key.split(":")[1]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [only, open]);

  async function loadMembers(id: number) {
    if (members[id] && members[id] !== "error") return;
    setMembers((m) => ({ ...m, [id]: "loading" }));
    try {
      const r = await unwrap(api["association-overview"][":id"].members.$get({ param: { id: String(id) } }));
      setMembers((m) => ({ ...m, [id]: r }));
    } catch {
      setMembers((m) => ({ ...m, [id]: "error" }));
    }
  }

  function toggle(node: MapNode) {
    if (node.kind === "facility" || node.kind === "person") {
      if (node.companyId != null) navigate(`/companies/${node.companyId}`);
      return;
    }
    const opening = !open.has(node.key);
    setOpen((prev) => {
      const next = new Set(prev);
      if (opening) next.add(node.key);
      else next.delete(node.key);
      return next;
    });
    if (opening && node.kind === "assoc" && !only) void loadMembers(Number(node.key.split(":")[1]));
  }

  /** 地区だけ／下位の協会をもつ協会まで、一気に開く */
  function expand(level: "regions" | "associations" | "none") {
    if (level === "none") return setOpen(new Set());
    const keys = new Set<string>(roots[0]!.children.map((c) => c.key));
    if (level === "associations") {
      const walk = (n: AssocTreeNode) => {
        if (n.children.length > 0) {
          keys.add(`assoc:${n.item.id}`);
          if (!only) void loadMembers(n.item.id);
        }
        n.children.forEach(walk);
      };
      groups.forEach((g) => g.top.forEach(walk));
      tops.forEach(walk);
    }
    setOpen(keys);
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Button size="sm" onClick={() => expand("regions")}>
          地区をすべて開く
        </Button>
        <Button size="sm" onClick={() => expand("associations")}>
          下位の協会まですべて開く
        </Button>
        <Button size="sm" onClick={() => expand("none")}>
          すべて閉じる
        </Button>
        <div role="group" aria-label="表示する内容" className="inline-flex rounded-md bg-slate-100 p-0.5 text-sm">
          {([[false, "すべて表示"], [true, "協会だけ表示"]] as const).map(([v, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={only === v}
              onClick={() => changeOnly(v)}
              className={`rounded px-3 py-1 font-medium ${only === v ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              title={v ? "会長・役員・法人・施設を出さずに、協会だけを表示します" : "協会に加えて、会長・役員・法人・施設も表示します"}
            >
              {label}
            </button>
          ))}
        </div>
        <span>{only ? "ノードをクリックで開閉します。協会だけを表示しています（会長・役員・法人・施設は「すべて表示」で出ます）。" : "ノードをクリックで開閉します。協会を開くと、下位の協会・会長・役員と、直接加盟している法人・施設が出ます。施設・会長・役員をクリックでカルテへ移動します。"}</span>
      </div>
      <div className="max-h-[72vh] overflow-auto rounded-lg bg-white ring-1 ring-slate-200">
        <div className="relative" style={{ width, height }}>
          <svg className="absolute inset-0" width={width} height={height} aria-hidden>
            {links.map((l) => {
              const x1 = l.from.x + NODE_W;
              const y1 = l.from.y + NODE_H / 2;
              const x2 = l.to.x;
              const y2 = l.to.y + NODE_H / 2;
              const mx = (x1 + x2) / 2;
              return <path key={`${l.from.node.key}>${l.to.node.key}`} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="#cbd5e1" strokeWidth={1.5} />;
            })}
          </svg>
          {placed.map((p) => {
            const n = p.node;
            const clickable = n.kind !== "note" && n.kind !== "root" && (p.expandable || n.kind === "assoc" || n.kind === "facility" || n.kind === "person");
            const dark = n.kind === "root" || n.kind === "region" || n.top === true;
            return (
              <Fragment key={n.key}>
              <button
                type="button"
                disabled={!clickable}
                onClick={() => toggle(n)}
                title={[n.label, n.sub].filter(Boolean).join("　")}
                style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                className={`absolute flex items-center gap-1.5 rounded-xl px-2.5 text-left text-xs ring-1 ring-inset ${n.top ? KIND_STYLE.root : KIND_STYLE[n.kind]} ${clickable ? "cursor-pointer hover:shadow" : "cursor-default"}`}
              >
                {n.kind === "person" && <Crown className={`h-3.5 w-3.5 shrink-0 ${n.label.startsWith("会長") ? "text-amber-500" : "text-slate-400"}`} aria-hidden />}
                {p.expandable && n.kind !== "root" && <span className={`shrink-0 text-[10px] ${dark ? "text-white/70" : "text-slate-500"}`}>{p.isOpen ? "▼" : "▶"}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate leading-tight">{n.label}</span>
                  {n.sub && <span className={`block truncate text-[10px] font-normal leading-tight ${dark ? "text-white/70" : "text-slate-500"}`}>{n.sub}</span>}
                </span>
              </button>
              {onEdit && n.kind === "assoc" && (
                <button
                  type="button"
                  onClick={() => onEdit(Number(n.key.split(":")[1]))}
                  title={`${n.label}の位置を変更`}
                  aria-label={`${n.label}の位置を変更`}
                  style={{ left: p.x + NODE_W - 24, top: p.y + 8 }}
                  className="absolute flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white shadow hover:bg-indigo-700"
                >
                  <Pencil className="h-3 w-3" aria-hidden />
                </button>
              )}
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 協会のノード。子は、下位の協会、協会会長・協会役員、直接加盟している法人（法人未登録の施設は最後にまとめる） */
function assocNode(n: AssocTreeNode, members: Record<number, MemberState>, only: boolean): MapNode {
  const a = n.item;
  const m = members[a.id];
  const children: MapNode[] = n.children.map((c) => assocNode(c, members, only));
  const sub = [`${a.facility_count.toLocaleString()}施設`, `${a.organization_count.toLocaleString()}法人`, n.children.length ? `下位${n.children.length}協会` : null].filter(Boolean).join("・");
  if (only) return { key: `assoc:${a.id}`, label: a.name, sub, kind: "assoc", children };
  for (const [kind, list] of [["会長", a.chairs], ["役員", a.officers]] as const) {
    for (const p of list) {
      children.push({ key: `person:${a.id}:${p.contact_id}`, label: `${kind} ${p.name ?? "氏名不明"}`, sub: p.role ?? p.company_name, kind: "person", companyId: p.company_id, children: [] });
    }
  }
  if (a.own_facility_count > 0) {
    if (m === undefined || m === "loading") {
      children.push({ key: `note:${a.id}:loading`, label: "読み込み中…", kind: "note", children: [] });
    } else if (m === "error") {
      children.push({ key: `note:${a.id}:error`, label: "読み込めませんでした", kind: "note", children: [] });
    } else {
      for (const g of groupByOrganization(m.facilities)) {
        children.push({
          key: `org:${a.id}:${g.key}`,
          label: g.key === "none" ? "法人未登録の施設" : g.name || "（法人名なし）",
          sub: `${g.facilities.length}施設`,
          kind: "org",
          children: g.facilities.map((f) => ({ key: `fac:${a.id}:${f.id}`, label: f.company_name, sub: f.is_headquarters ? "本部" : f.is_user ? "ユーザー" : undefined, kind: "facility" as const, companyId: f.id, children: [] })),
        });
      }
      if (m.truncated) children.push({ key: `note:${a.id}:more`, label: "（一部のみ表示）", kind: "note", children: [] });
    }
  }
  return { key: `assoc:${a.id}`, label: a.name, sub, kind: "assoc", children };
}
