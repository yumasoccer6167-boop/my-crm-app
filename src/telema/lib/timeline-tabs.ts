// ユーザーの施設のタイムラインを部署別に切り替えるタブ。
// 全体／部署ごと／未分類（部署が付いていない記録）。件数は各タブの記録数
import type { CallLog, Section } from "../types";

export type TimelineTab = { key: string; label: string; count: number };

export const ALL_TAB = "all";
export const UNSORTED_TAB = "none";
export const sectionTab = (id: number) => `s${id}`;

/**
 * 出すタブの一覧。部署はマスタの並び順で、有効なものは記録が0件でも出す（これから使う部署に切り替えられるように）。
 * 無効にした部署は、記録が付いているときだけ出す（付いている記録が見られなくならないように）。
 * 「未分類」は、部署の付いていない記録があるときだけ出す
 */
export function timelineTabs(calls: CallLog[], sections: Section[]): TimelineTab[] {
  const countBySection = new Map<number, number>();
  let unsorted = 0;
  for (const c of calls) {
    if (c.section_id == null) unsorted += 1;
    else countBySection.set(c.section_id, (countBySection.get(c.section_id) ?? 0) + 1);
  }
  const tabs: TimelineTab[] = [{ key: ALL_TAB, label: "全体", count: calls.length }];
  for (const s of sections) {
    const count = countBySection.get(s.id) ?? 0;
    if (s.is_active || count > 0) tabs.push({ key: sectionTab(s.id), label: s.name, count });
  }
  if (unsorted > 0) tabs.push({ key: UNSORTED_TAB, label: "未分類", count: unsorted });
  return tabs;
}

/** 選んだタブに属する記録 */
export function callsInTab(calls: CallLog[], tab: string): CallLog[] {
  if (tab === ALL_TAB) return calls;
  if (tab === UNSORTED_TAB) return calls.filter((c) => c.section_id == null);
  return calls.filter((c) => sectionTab(c.section_id ?? -1) === tab);
}
