import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router";
import type { GraphEdge, GraphNode } from "../types";
import { prefOf } from "../lib/network-layout";
import { UserTag } from "./CompanyPicker";
import { ConnectForm } from "./ConnectForm";
import { Button, Card, Empty } from "./ui";

type Kind = "all" | "user" | "other";
const PAGE = 100;

/**
 * 相関図の下の施設一覧（ユーザー・ユーザー以外の両方）。
 * 行の「＋知り合いをつなぐ」でその園を施設1にしたつなぐフォームを行の下に開く。相手が未登録ならフォーム内で新規登録できる
 */
export function NetworkList({
  title,
  nodes,
  edges,
  all,
  query,
  onFocus,
  onConnected,
}: {
  title: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  all: Map<number, GraphNode>;
  query: string;
  onFocus: (id: number) => void;
  onConnected: () => void;
}) {
  const [kind, setKind] = useState<Kind>("all");
  const [lonely, setLonely] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  // つなぐフォームを開いている行（"new" は一覧の上で、施設を選ばずに開いたとき）
  const [open, setOpen] = useState<number | "new" | null>(null);

  // 施設ごとの知り合い（相手の施設）
  const friends = useMemo(() => {
    const m = new Map<number, GraphNode[]>();
    const add = (id: number, other: number) => {
      const o = all.get(other);
      if (o) m.set(id, [...(m.get(id) ?? []), o]);
    };
    for (const e of edges) {
      add(e.source, e.target);
      add(e.target, e.source);
    }
    return m;
  }, [edges, all]);

  const counts = { all: nodes.length, user: 0, other: 0 };
  for (const n of nodes) counts[n.is_user ? "user" : "other"]++;

  const rows = nodes
    .filter((n) => kind === "all" || (kind === "user") === !!n.is_user)
    .filter((n) => !lonely || !friends.has(n.id))
    .filter((n) => !query || [n.company_name, n.contact_name, n.address].some((v) => v?.includes(query)));

  const chip = (active: boolean) =>
    `whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${active ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`;
  const saved = () => {
    setOpen(null);
    onConnected();
  };

  return (
    <Card
      title={`${title}の施設一覧（${rows.length}）`}
      action={
        <Button size="sm" variant="primary" onClick={() => setOpen(open === "new" ? null : "new")}>
          ＋知り合いの園をつなぐ
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ["all", "すべて"],
              ["user", "ユーザー"],
              ["other", "ユーザー以外"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" className={chip(kind === k)} onClick={() => setKind(k)}>
              {label} {counts[k]}
            </button>
          ))}
          <label className="ml-2 flex items-center gap-1.5 text-xs text-slate-700">
            <input type="checkbox" checked={lonely} onChange={(e) => setLonely(e.target.checked)} />
            まだ知り合いが登録されていない園だけ
          </label>
          {query && <span className="text-xs text-slate-500">「{query}」で絞り込み中</span>}
        </div>

        {open === "new" && (
          <div className="max-w-xl rounded-md bg-slate-50 p-3 ring-1 ring-slate-200">
            <ConnectForm onSaved={saved} onClose={() => setOpen(null)} />
          </div>
        )}

        {rows.length === 0 ? (
          <Empty>該当する施設がありません。「＋知り合いの園をつなぐ」で、ユーザー・新規の園どちらからでも登録できます。</Empty>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="px-4 py-1.5 font-medium">園名</th>
                  <th className="px-2 py-1.5 font-medium">所在地</th>
                  <th className="px-2 py-1.5 font-medium">担当者</th>
                  <th className="px-2 py-1.5 font-medium">知り合いの園</th>
                  <th className="px-4 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((n) => {
                  const fs = friends.get(n.id) ?? [];
                  return (
                    <Fragment key={n.id}>
                      <tr className={`border-b border-slate-100 ${open === n.id ? "bg-indigo-50/40" : "hover:bg-slate-50"}`}>
                        <td className="px-4 py-2 align-top">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onFocus(n.id)}
                              className="text-left font-medium text-slate-900 hover:text-indigo-700 hover:underline"
                              title="相関図で表示"
                            >
                              {n.company_name}
                            </button>
                            <UserTag isUser={n.is_user} />
                          </div>
                          <Link to={`/companies/${n.id}`} className="text-xs text-indigo-700 hover:underline">
                            カルテ
                          </Link>
                        </td>
                        <td className="px-2 py-2 align-top text-xs text-slate-600">
                          {prefOf(n)}
                          {n.city && ` ${n.city}`}
                        </td>
                        <td className="px-2 py-2 align-top text-xs text-slate-700">
                          {n.contact_name ? (
                            `${n.contact_name}${n.contact_role ? `（${n.contact_role}）` : ""}`
                          ) : (
                            <span className="text-slate-400">未判明</span>
                          )}
                        </td>
                        <td className="px-2 py-2 align-top text-xs">
                          {fs.length === 0 ? (
                            <span className="text-slate-400">なし</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {fs.map((f) => (
                                <button
                                  key={f.id}
                                  type="button"
                                  onClick={() => onFocus(f.id)}
                                  className={`rounded px-1.5 ring-1 ring-inset hover:underline ${f.is_user ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-slate-50 text-slate-700 ring-slate-200"}`}
                                >
                                  {f.company_name}
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right align-top">
                          <Button
                            size="sm"
                            variant={open === n.id ? "ghost" : "secondary"}
                            className="whitespace-nowrap"
                            onClick={() => setOpen(open === n.id ? null : n.id)}
                          >
                            {open === n.id ? "閉じる" : "＋知り合いをつなぐ"}
                          </Button>
                        </td>
                      </tr>
                      {open === n.id && (
                        <tr className="border-b border-slate-100 bg-indigo-50/40">
                          <td colSpan={5} className="px-4 pb-3">
                            <div className="max-w-xl rounded-md bg-white p-3 ring-1 ring-slate-200">
                              <ConnectForm initial={n} onSaved={saved} onClose={() => setOpen(null)} />
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
        )}
        {rows.length > limit && (
          <div className="text-center">
            <Button size="sm" onClick={() => setLimit(limit + PAGE)}>
              さらに表示（残り {rows.length - limit}）
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
