export type MapNode = {
  key: string;
  label: string;
  /** 名前の下に小さく出す補足（人数など） */
  sub?: string;
  kind: "root" | "dept" | "member";
  /** 枝と枠の色 */
  color: string;
  children: MapNode[];
};

const PAD = 16;
const ROW = 42;
const NODE_H = 32;
const GAP_X = 56;
const WIDTH: Record<MapNode["kind"], number> = { root: 104, dept: 176, member: 128 };

type Placed = { node: MapNode; x: number; cy: number; w: number };
type Edge = { x1: number; y1: number; x2: number; y2: number; color: string };

/** 左から右へ枝を広げる配置：葉を1行ずつ並べ、親は子の真ん中に置く */
function layout(root: MapNode, collapsed: Set<string>) {
  const kidsOf = (n: MapNode) => (collapsed.has(n.key) ? [] : n.children);
  const colW: number[] = [];
  const measure = (n: MapNode, d: number) => {
    colW[d] = Math.max(colW[d] ?? 0, WIDTH[n.kind]);
    kidsOf(n).forEach((c) => measure(c, d + 1));
  };
  measure(root, 0);
  const colX: number[] = [];
  let x = PAD;
  colW.forEach((w, d) => {
    colX[d] = x;
    x += w + GAP_X;
  });

  let row = 0;
  const placed: Placed[] = [];
  const edges: Edge[] = [];
  const place = (n: MapNode, d: number): Placed => {
    const kids = kidsOf(n).map((c) => place(c, d + 1));
    const cy = kids.length ? (kids[0]!.cy + kids[kids.length - 1]!.cy) / 2 : PAD + row++ * ROW + NODE_H / 2;
    const p: Placed = { node: n, x: colX[d]!, cy, w: WIDTH[n.kind] };
    for (const c of kids) edges.push({ x1: p.x + p.w, y1: cy, x2: c.x, y2: c.cy, color: c.node.color });
    placed.push(p);
    return p;
  };
  place(root, 0);
  return { placed, edges, width: x - GAP_X + PAD, height: PAD * 2 + Math.max(row, 1) * ROW - (ROW - NODE_H) };
}

/** マインドマップ：中心（ルート）から右へ枝が伸びる。ノードを押すと選択、右端の丸で枝を畳む／開く */
export function MindMap({ root, selected, onSelect, collapsed, onToggle }: { root: MapNode; selected: string | null; onSelect: (key: string) => void; collapsed: Set<string>; onToggle: (key: string) => void }) {
  const { placed, edges, width, height } = layout(root, collapsed);
  return (
    <div className="overflow-auto rounded-md bg-slate-50 ring-1 ring-slate-200" style={{ maxHeight: "70vh" }}>
      <div className="relative" style={{ width, height, minWidth: "100%" }}>
        <svg className="absolute left-0 top-0" width={width} height={height} aria-hidden>
          {edges.map((e, i) => {
            const mx = (e.x1 + e.x2) / 2;
            return <path key={i} d={`M${e.x1},${e.y1} C${mx},${e.y1} ${mx},${e.y2} ${e.x2},${e.y2}`} fill="none" stroke={e.color} strokeWidth={2} strokeLinecap="round" opacity={0.75} />;
          })}
        </svg>
        {placed.map(({ node: n, x, cy, w }) => {
          const isSel = selected === n.key;
          const folded = collapsed.has(n.key);
          const base = "absolute flex items-center justify-center overflow-hidden px-3 text-sm leading-tight transition-shadow";
          const style =
            n.kind === "root"
              ? { background: n.color, color: "#fff", borderRadius: 999 }
              : n.kind === "dept"
                ? { background: `${n.color}1f`, border: `2px solid ${n.color}`, color: "#0f172a", borderRadius: 10, fontWeight: 600 }
                : { background: "#fff", border: `1.5px solid ${n.color}`, color: "#1e293b", borderRadius: 999 };
          return (
            <div key={n.key}>
              <button
                type="button"
                onClick={() => onSelect(n.key)}
                aria-pressed={isSel}
                title={n.sub ? `${n.label}（${n.sub}）` : n.label}
                className={`${base} ${isSel ? "shadow-md ring-2 ring-indigo-500 ring-offset-1" : "hover:shadow"}`}
                style={{ left: x, top: cy - NODE_H / 2, width: w, height: NODE_H, ...style }}
              >
                <span className="truncate">{n.label}</span>
                {n.sub && <span className="ml-1.5 shrink-0 text-[11px] font-normal text-slate-500">{n.sub}</span>}
              </button>
              {n.children.length > 0 && n.kind !== "root" && (
                <button
                  type="button"
                  onClick={() => onToggle(n.key)}
                  aria-label={`${n.label}の枝を${folded ? "開く" : "畳む"}`}
                  className="absolute flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-white px-1 text-[11px] font-medium leading-none text-slate-600 shadow-sm ring-1 ring-slate-300 hover:bg-slate-100"
                  style={{ left: x + w - 2, top: cy - 9 }}
                >
                  {folded ? n.children.length : "−"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
