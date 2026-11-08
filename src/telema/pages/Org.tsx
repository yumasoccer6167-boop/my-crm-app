import { useState } from "react";
import type { OrgDepartment, OrgMember } from "../types";
import { api, unwrap } from "../lib/api";
import { todayJst } from "../lib/format";
import { useMasters } from "../lib/masters";
import { useApi } from "../lib/useApi";
import { MindMap, type MapNode } from "../components/MindMap";
import { Button, Card, Empty, ErrorBox, inputCls, Loading, selectCls } from "../components/ui";

type Node = OrgDepartment & { children: Node[] };

function buildTree(departments: OrgDepartment[]): Node[] {
  const nodes = new Map(departments.map((d) => [d.id, { ...d, children: [] as Node[] }]));
  const roots: Node[] = [];
  for (const d of departments) {
    const n = nodes.get(d.id)!;
    const parent = d.parent_id == null ? undefined : nodes.get(d.parent_id);
    (parent ? parent.children : roots).push(n);
  }
  return roots;
}

/** 部署の選択肢（階層を字下げして並べる）。exclude の配下は除く */
function flatten(nodes: Node[], depth = 0, exclude?: number): { id: number; label: string }[] {
  return nodes.flatMap((n) => (n.id === exclude ? [] : [{ id: n.id, label: `${"　".repeat(depth)}${n.name}` }, ...flatten(n.children, depth + 1, exclude)]));
}

const BRANCH_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#ef4444"];
const ROOT_COLOR = "#334155";
const NONE_COLOR = "#94a3b8";

/** 組織図：部署のツリー（事業部 > 部 > 課 など）と、メンバーの所属。管理者は部署の追加・名前の変更・付け替え・並べ替え・削除と、メンバーの異動ができる */
export function Org() {
  const { me } = useMasters();
  const { data, error, loading, reload } = useApi(() => unwrap(api.org.$get({})), []);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"map" | "list">("map");
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const isAdmin = me.role === "admin";

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      await reload();
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const tree = buildTree(data.departments);
  const membersOf = (id: number | null) => data.members.filter((m) => m.department_id === id);
  const options = flatten(tree);

  // マインドマップ用：部署 → 子の部署 → メンバー の順に枝を伸ばす
  const places = new Map<number, { node: Node; siblings: Node[]; index: number }>();
  const index = (nodes: Node[]) => nodes.forEach((n, i) => { places.set(n.id, { node: n, siblings: nodes, index: i }); index(n.children); });
  index(tree);
  const memberNode = (m: OrgMember, color: string): MapNode => ({ key: `u${m.user_id}`, kind: "member", label: m.name, color, children: [] });
  // 人数は、配下の課まで含めた合計で出す
  const headcount = (n: Node): number => membersOf(n.id).length + n.children.reduce((sum, c) => sum + headcount(c), 0);
  const deptNode = (n: Node, color: string): MapNode => ({
    key: `d${n.id}`,
    kind: "dept",
    label: n.name,
    sub: `${headcount(n)}人`,
    color,
    children: [...n.children.map((c) => deptNode(c, color)), ...membersOf(n.id).map((m) => memberNode(m, color))],
  });
  const unassigned = membersOf(null);
  const root: MapNode = {
    key: "root",
    kind: "root",
    label: "組織",
    color: ROOT_COLOR,
    children: [
      ...tree.map((n, i) => deptNode(n, BRANCH_COLORS[i % BRANCH_COLORS.length]!)),
      ...(unassigned.length ? [{ key: "none", kind: "dept" as const, label: "所属なし", sub: `${unassigned.length}人`, color: NONE_COLOR, children: unassigned.map((m) => memberNode(m, NONE_COLOR)) }] : []),
    ],
  };
  const toggle = (key: string) => setCollapsed((prev) => { const next = new Set(prev); if (!next.delete(key)) next.add(key); return next; });
  const selDept = selected?.startsWith("d") ? places.get(Number(selected.slice(1))) : undefined;
  const selMember = selected?.startsWith("u") ? data.members.find((m) => m.user_id === Number(selected.slice(1))) : undefined;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        部署のツリーとメンバーの所属です。営業部の下に課を作る、のように何階層でも分けられます。異動は日付つきで登録でき、営業成績ダッシュボード・日報の集計に使われます。
        {!isAdmin && "（部署の変更・異動は管理者が行います）"}
      </p>
      {message && <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">{message}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1">
          <Button size="sm" variant={view === "map" ? "primary" : "ghost"} onClick={() => setView("map")}>
            マインドマップ
          </Button>
          <Button size="sm" variant={view === "list" ? "primary" : "ghost"} onClick={() => setView("list")}>
            一覧
          </Button>
        </span>
        {isAdmin && <AddForm parentId={null} label="最上位の部署を追加" busy={busy} onAdd={(name) => run(() => unwrap(api.org.departments.$post({ json: { name, parent_id: null } })))} />}
      </div>
      {tree.length === 0 && unassigned.length === 0 ? (
        <Card title="部署">
          <Empty>部署がまだありません。{isAdmin ? "「最上位の部署を追加」から、事業部や部の名前を登録してください。" : ""}</Empty>
        </Card>
      ) : view === "map" ? (
        <>
          <MindMap root={root} selected={selected} onSelect={(k) => setSelected(k === selected ? null : k)} collapsed={collapsed} onToggle={toggle} />
          <p className="text-xs text-slate-500">ノードを押すと、部署の名前変更・付け替え・メンバーの異動ができます（管理者）。右端の丸で枝を畳む／開く。</p>
          {selDept && (
            <div className="rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
              <DeptHeader key={selDept.node.id} node={selDept.node} siblings={selDept.siblings} index={selDept.index} tree={tree} count={membersOf(selDept.node.id).length} isAdmin={isAdmin} busy={busy} run={run} />
            </div>
          )}
          {selMember && (
            <div className="space-y-1 rounded-md bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{selMember.name}</span>
                <span className="text-xs text-slate-500">
                  {selMember.department_id == null ? "所属なし" : (places.get(selMember.department_id)?.node.name ?? "")}
                  {selMember.since && `（${selMember.since} から）`}
                </span>
              </div>
              {isAdmin && <AssignForm key={`${selMember.user_id}-${selMember.department_id}`} member={selMember} options={options} busy={busy} run={run} onDone={() => undefined} />}
            </div>
          )}
        </>
      ) : (
        <>
          <Card title="部署">
            <ul className="space-y-1">
              {tree.map((n, i) => (
                <DeptNode key={n.id} node={n} siblings={tree} index={i} depth={0} tree={tree} options={options} membersOf={membersOf} isAdmin={isAdmin} busy={busy} run={run} />
              ))}
            </ul>
          </Card>
          <Card title={`所属なしのメンバー（${unassigned.length}人）`}>
            {unassigned.length === 0 ? <Empty>全員がどこかの部署に所属しています</Empty> : <MemberList members={unassigned} options={options} isAdmin={isAdmin} busy={busy} run={run} />}
          </Card>
        </>
      )}
    </div>
  );
}

type RunFn = (fn: () => Promise<unknown>) => Promise<boolean>;

function AddForm({ parentId, label, busy, onAdd }: { parentId: number | null; label: string; busy: boolean; onAdd: (name: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  if (!open)
    return (
      <Button size="sm" onClick={() => setOpen(true)} aria-label={`${label}${parentId ?? ""}`}>
        ＋ {label}
      </Button>
    );
  return (
    <span className="flex items-center gap-1.5">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="部署名（例：特販二課）" maxLength={50} className={`${inputCls} w-48`} aria-label="新しい部署名" />
      <Button
        size="sm"
        variant="primary"
        disabled={busy || !name.trim()}
        onClick={async () => {
          if (await onAdd(name.trim())) {
            setName("");
            setOpen(false);
          }
        }}
      >
        追加
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        やめる
      </Button>
    </span>
  );
}

function DeptHeader({ node, siblings, index, tree, count, isAdmin, busy, run }: { node: Node; siblings: Node[]; index: number; tree: Node[]; count: number; isAdmin: boolean; busy: boolean; run: RunFn }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(node.name);
  const [moving, setMoving] = useState(false);
  const patch = (id: number, json: Record<string, unknown>) => unwrap(api.org.departments[":id"].$patch({ param: { id: String(id) }, json }));
  // 並べ替えは、隣の部署と sort_order を入れ替える
  const swap = (other: Node) => run(async () => {
    await patch(node.id, { sort_order: other.sort_order });
    await patch(other.id, { sort_order: node.sort_order });
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {renaming ? (
          <span className="flex items-center gap-1.5">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={50} className={`${inputCls} w-48`} aria-label="部署名" />
            <Button size="sm" variant="primary" disabled={busy || !name.trim()} onClick={async () => { if (await run(() => patch(node.id, { name: name.trim() }))) setRenaming(false); }}>
              保存
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setRenaming(false); setName(node.name); }}>
              やめる
            </Button>
          </span>
        ) : (
          <span className="text-sm font-semibold text-slate-900">{node.name}</span>
        )}
        <span className="text-xs text-slate-500">{count}人</span>
        {isAdmin && !renaming && (
          <span className="ml-auto flex flex-wrap items-center gap-1">
            <AddForm parentId={node.id} label="下に部署を追加" busy={busy} onAdd={(n) => run(() => unwrap(api.org.departments.$post({ json: { name: n, parent_id: node.id } })))} />
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRenaming(true)}>
              名前変更
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMoving(!moving)}>
              付け替え
            </Button>
            <Button size="sm" variant="ghost" disabled={busy || index === 0} onClick={() => swap(siblings[index - 1]!)} aria-label={`${node.name}を上へ`}>
              ↑
            </Button>
            <Button size="sm" variant="ghost" disabled={busy || index === siblings.length - 1} onClick={() => swap(siblings[index + 1]!)} aria-label={`${node.name}を下へ`}>
              ↓
            </Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => { if (window.confirm(`部署「${node.name}」を削除します。よろしいですか？`)) void run(() => unwrap(api.org.departments[":id"].$delete({ param: { id: String(node.id) } }))); }}>
              削除
            </Button>
          </span>
        )}
      </div>
      {moving && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-slate-500">移す先：</span>
          <select
            className={selectCls}
            value={node.parent_id ?? ""}
            aria-label={`${node.name}の移す先`}
            onChange={async (e) => {
              if (await run(() => patch(node.id, { parent_id: e.target.value === "" ? null : Number(e.target.value) }))) setMoving(false);
            }}
          >
            <option value="">（最上位）</option>
            {flatten(tree, 0, node.id).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

function DeptNode({
  node,
  siblings,
  index,
  depth,
  tree,
  options,
  membersOf,
  isAdmin,
  busy,
  run,
}: {
  node: Node;
  siblings: Node[];
  index: number;
  depth: number;
  tree: Node[];
  options: { id: number; label: string }[];
  membersOf: (id: number | null) => OrgMember[];
  isAdmin: boolean;
  busy: boolean;
  run: RunFn;
}) {
  const members = membersOf(node.id);

  return (
    <li>
      <div className="rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-200" style={{ marginLeft: depth * 20 }}>
        <DeptHeader node={node} siblings={siblings} index={index} tree={tree} count={members.length} isAdmin={isAdmin} busy={busy} run={run} />
        {members.length > 0 && (
          <div className="mt-2">
            <MemberList members={members} options={options} isAdmin={isAdmin} busy={busy} run={run} />
          </div>
        )}
      </div>
      {node.children.length > 0 && (
        <ul className="mt-1 space-y-1">
          {node.children.map((c, i) => (
            <DeptNode key={c.id} node={c} siblings={node.children} index={i} depth={depth + 1} tree={tree} options={options} membersOf={membersOf} isAdmin={isAdmin} busy={busy} run={run} />
          ))}
        </ul>
      )}
    </li>
  );
}

function MemberList({ members, options, isAdmin, busy, run }: { members: OrgMember[]; options: { id: number; label: string }[]; isAdmin: boolean; busy: boolean; run: RunFn }) {
  const [openId, setOpenId] = useState<number | null>(null);
  return (
    <ul className="space-y-1">
      {members.map((m) => (
        <li key={m.user_id} className="text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white px-2.5 py-0.5 text-slate-800 ring-1 ring-inset ring-slate-300">{m.name}</span>
            {m.since && <span className="text-xs text-slate-400">{m.since} から</span>}
            {isAdmin && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpenId(openId === m.user_id ? null : m.user_id)}>
                {m.department_id == null ? "配属する" : "異動"}
              </Button>
            )}
          </div>
          {openId === m.user_id && <AssignForm member={m} options={options} busy={busy} run={run} onDone={() => setOpenId(null)} />}
        </li>
      ))}
    </ul>
  );
}

function AssignForm({ member, options, busy, run, onDone }: { member: OrgMember; options: { id: number; label: string }[]; busy: boolean; run: RunFn; onDone: () => void }) {
  const [dept, setDept] = useState<string>(member.department_id == null ? "" : String(member.department_id));
  const [date, setDate] = useState(todayJst());
  const [note, setNote] = useState("");
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 rounded-md bg-white p-2 text-xs ring-1 ring-slate-200">
      <span className="text-slate-500">異動先</span>
      <select value={dept} onChange={(e) => setDept(e.target.value)} className={selectCls} aria-label={`${member.name}の異動先`}>
        <option value="">（所属なし）</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="text-slate-500">異動日</span>
      <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={selectCls} aria-label="異動日" />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="メモ（任意）" maxLength={200} className={`${inputCls} w-40`} aria-label="異動のメモ" />
      <Button
        size="sm"
        variant="primary"
        disabled={busy}
        onClick={async () => {
          const ok = await run(() => unwrap(api.org.assignments.$post({ json: { user_id: member.user_id, department_id: dept === "" ? null : Number(dept), effective_date: date, note: note.trim() || null } })));
          if (ok) onDone();
        }}
      >
        登録
      </Button>
    </div>
  );
}
