// 協会の組織図：全日本私立幼稚園連合会 → 地区 → 都道府県の協会 → 地区単位の協会 → 各地域の協会。
// 親の協会（parent_id）で階層を作り、親が無い協会（都道府県の協会）は、都道府県から地区に入れる。
import type { AssociationOverviewItem } from "../types";
import { REGIONS, regionOfPrefecture, UNKNOWN_REGION } from "../shared/regions";

export type AssocTreeNode = { item: AssociationOverviewItem; depth: number; children: AssocTreeNode[] };
export type RegionGroup = { key: string; label: string; top: AssocTreeNode[]; facilityCount: number };

/** 親の協会でつないだ木。親が一覧に無い（無効で隠した等）協会は、最上位の扱いにする */
export function buildAssociationForest(items: AssociationOverviewItem[]): AssocTreeNode[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const kids = new Map<number, AssociationOverviewItem[]>();
  const roots: AssociationOverviewItem[] = [];
  for (const i of items) {
    if (i.parent_id != null && byId.has(i.parent_id)) kids.set(i.parent_id, [...(kids.get(i.parent_id) ?? []), i]);
    else roots.push(i);
  }
  const order = (a: AssociationOverviewItem, b: AssociationOverviewItem) => a.sort_order - b.sort_order || a.id - b.id;
  const make = (i: AssociationOverviewItem, depth: number, seen: Set<number>): AssocTreeNode => ({
    item: i,
    depth,
    children: seen.has(i.id) ? [] : (kids.get(i.id) ?? []).sort(order).map((c) => make(c, depth + 1, new Set([...seen, i.id]))),
  });
  return roots.sort(order).map((r) => make(r, 0, new Set()));
}

/** 地区ごとにまとめる。地区は全部（協会が無くても）並べ、地区が決まらない協会は最後の「地区不明」に入れる */
export function groupByRegion(forest: AssocTreeNode[]): RegionGroup[] {
  const groups: RegionGroup[] = [...REGIONS.map((r) => ({ key: r.key, label: r.label })), UNKNOWN_REGION].map((r) => ({ ...r, top: [], facilityCount: 0 }));
  for (const n of forest) {
    const region = regionOfPrefecture(n.item.prefecture);
    const g = groups.find((x) => x.key === (region?.key ?? UNKNOWN_REGION.key))!;
    g.top.push(n);
    g.facilityCount += n.item.facility_count;
  }
  return groups;
}

/** 木を、表示の順（地区→都道府県の協会→下位の協会）に平らにする */
export function flattenForest(groups: RegionGroup[]): { node: AssocTreeNode; region: string }[] {
  const out: { node: AssocTreeNode; region: string }[] = [];
  const walk = (n: AssocTreeNode, region: string) => {
    out.push({ node: n, region });
    n.children.forEach((c) => walk(c, region));
  };
  for (const g of groups) g.top.forEach((n) => walk(n, g.label));
  return out;
}
