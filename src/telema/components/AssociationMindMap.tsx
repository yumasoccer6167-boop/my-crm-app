import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Crown } from "lucide-react";
import type { AssociationMembers, AssociationOverviewItem } from "../types";
import { PREFECTURES } from "../shared/prefectures";
import { api, unwrap } from "../lib/api";
import { layoutMindMap, NODE_H, NODE_W, type MapNode } from "../lib/mindmap-layout";
import { Button } from "./ui";
import { groupByOrganization } from "./AssociationMembers";

const UNKNOWN_PREF = "都道府県不明";

const KIND_STYLE: Record<MapNode["kind"], string> = {
  root: "bg-slate-800 text-white ring-slate-800",
  pref: "bg-indigo-50 text-indigo-900 ring-indigo-200",
  assoc: "bg-white text-slate-900 ring-indigo-400 font-semibold",
  person: "bg-amber-50 text-amber-900 ring-amber-200",
  org: "bg-sky-50 text-sky-900 ring-sky-200",
  facility: "bg-white text-slate-800 ring-slate-300",
  note: "bg-transparent text-slate-400 ring-transparent",
};

/**
 * 加盟協会のマインドマップ。左から「加盟協会」→都道府県→協会→（協会会長・役員／法人→施設）と広がる。
 * 協会を開いたときに、その協会の加盟施設を読み込む。ノードをクリックで開閉。施設・会長・役員はクリックでカルテへ
 */
export function AssociationMindMap({ associations }: { associations: AssociationOverviewItem[] }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<Record<number, AssociationMembers | "loading" | "error">>({});
  const scroller = useRef<HTMLDivElement>(null);

  const tree = useMemo<MapNode>(() => {
    const byPref = new Map<string, AssociationOverviewItem[]>();
    for (const a of associations) {
      const k = a.prefecture ?? UNKNOWN_PREF;
      byPref.set(k, [...(byPref.get(k) ?? []), a]);
    }
    const prefs = [...byPref.keys()].sort((a, b) => {
      const ia = PREFECTURES.indexOf(a as never);
      const ib = PREFECTURES.indexOf(b as never);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
    return {
      key: "root",
      label: "加盟協会",
      sub: `${associations.length}協会`,
      kind: "root",
      children: prefs.map((p) => {
        const list = byPref.get(p)!;
        return {
          key: `pref:${p}`,
          label: p,
          sub: `${list.length}協会・${list.reduce((n, a) => n + a.facility_count, 0)}施設`,
          kind: "pref" as const,
          children: list.map((a) => assocNode(a, members[a.id])),
        };
      }),
    };
  }, [associations, members]);

  const { placed, links, width, height } = useMemo(() => layoutMindMap(tree, open), [tree, open]);

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
    if (node.children.length === 0 && node.kind !== "assoc") return;
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(node.key)) next.delete(node.key);
      else next.add(node.key);
      return next;
    });
    if (node.kind === "assoc" && !open.has(node.key)) void loadMembers(Number(node.key.split(":")[1]));
  }

  function expandPrefectures(all: boolean) {
    setOpen(all ? new Set(tree.children.map((c) => c.key)) : new Set());
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Button size="sm" onClick={() => expandPrefectures(true)}>
          都道府県をすべて開く
        </Button>
        <Button size="sm" onClick={() => expandPrefectures(false)}>
          すべて閉じる
        </Button>
        <span>ノードをクリックで開閉します。協会を開くと、会長・役員と加盟法人・施設が出ます。施設・会長・役員をクリックでカルテへ移動します。</span>
      </div>
      <div ref={scroller} className="max-h-[70vh] overflow-auto rounded-lg bg-white ring-1 ring-slate-200">
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
            const clickable = n.kind !== "note" && (p.expandable || n.kind === "assoc" || n.kind === "facility" || n.kind === "person");
            return (
              <button
                key={n.key}
                type="button"
                disabled={!clickable}
                onClick={() => toggle(n)}
                title={[n.label, n.sub].filter(Boolean).join("　")}
                style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                className={`absolute flex items-center gap-1.5 rounded-xl px-2.5 text-left text-xs ring-1 ring-inset ${KIND_STYLE[n.kind]} ${clickable ? "cursor-pointer hover:shadow" : "cursor-default"}`}
              >
                {n.kind === "person" && <Crown className={`h-3.5 w-3.5 shrink-0 ${n.label.startsWith("会長") ? "text-amber-500" : "text-slate-400"}`} aria-hidden />}
                {p.expandable && n.kind !== "root" && <span className="shrink-0 text-[10px] text-slate-500">{p.isOpen ? "▼" : "▶"}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate leading-tight">{n.label}</span>
                  {n.sub && <span className={`block truncate text-[10px] font-normal leading-tight ${n.kind === "root" ? "text-slate-300" : "text-slate-500"}`}>{n.sub}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 協会のノード。子は、協会会長・協会役員、加盟法人（法人未登録の施設は最後にまとめる）。加盟施設は開いたときに読み込む */
function assocNode(a: AssociationOverviewItem, m: AssociationMembers | "loading" | "error" | undefined): MapNode {
  const children: MapNode[] = [];
  for (const [kind, list] of [["会長", a.chairs], ["役員", a.officers]] as const) {
    for (const p of list) {
      children.push({ key: `person:${a.id}:${p.contact_id}`, label: `${kind} ${p.name ?? "氏名不明"}`, sub: p.role ?? p.company_name, kind: "person", companyId: p.company_id, children: [] });
    }
  }
  if (m === "loading" || m === undefined) {
    if (a.facility_count > 0) children.push({ key: `note:${a.id}:loading`, label: "読み込み中…", kind: "note", children: [] });
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
  return { key: `assoc:${a.id}`, label: a.name, sub: `${a.facility_count}施設・${a.organization_count}法人`, kind: "assoc", children };
}
