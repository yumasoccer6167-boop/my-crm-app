// マインドマップ（左から右へ広がる木）の配置。ノードの開閉は呼び出し側が持ち、開いているノードの子だけを並べる。

export type MapNode = {
  key: string;
  label: string;
  sub?: string;
  kind: "root" | "region" | "assoc" | "person" | "org" | "facility" | "note";
  /** 組織図の最上位の組織（全日本私立幼稚園連合会と同じ濃い色で表示する） */
  top?: boolean;
  /** カルテを開くときの施設ID */
  companyId?: number;
  children: MapNode[];
};

export type Placed = { node: MapNode; x: number; y: number; depth: number; expandable: boolean; isOpen: boolean };
export type Link = { from: Placed; to: Placed };

export const NODE_W = 232;
export const NODE_H = 40;
const COL_GAP = 46;
const ROW_H = 48;
const PAD = 16;

/** 開いているノードの子を、深さごとの列・葉の順の行に並べる。親は子の真ん中に置く。root は常に開く。木が複数あるときは上から順に並べる */
export function layoutMindMap(roots: MapNode[], open: Set<string>): { placed: Placed[]; links: Link[]; width: number; height: number } {
  const placed: Placed[] = [];
  const links: Link[] = [];
  let row = 0;

  function walk(node: MapNode, depth: number): Placed {
    const isOpen = node.kind === "root" || open.has(node.key);
    const kids = isOpen ? node.children : [];
    const childPlaced = kids.map((c) => walk(c, depth + 1));
    const y = childPlaced.length ? (childPlaced[0]!.y + childPlaced[childPlaced.length - 1]!.y) / 2 : PAD + row++ * ROW_H;
    const p: Placed = { node, x: PAD + depth * (NODE_W + COL_GAP), y, depth, expandable: node.children.length > 0, isOpen };
    placed.push(p);
    for (const c of childPlaced) links.push({ from: p, to: c });
    return p;
  }

  for (const root of roots) walk(root, 0);
  const maxDepth = placed.reduce((m, p) => Math.max(m, p.depth), 0);
  return { placed, links, width: PAD * 2 + (maxDepth + 1) * NODE_W + maxDepth * COL_GAP, height: PAD * 2 + Math.max(1, row) * ROW_H };
}
