import { useMemo, useState } from "react";
import type { AssociationOverviewItem } from "../types";
import { PREFECTURES } from "../shared/prefectures";
import { regionOfPrefecture, UNKNOWN_REGION } from "../shared/regions";
import { api, unwrap } from "../lib/api";
import { Button } from "./ui";

const selCls = "w-full rounded-md border-0 bg-white px-2.5 py-1.5 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50";

/** 協会とその下位の協会すべての id（親にするとぐるぐる回ってしまうので、親の候補から外す） */
export function descendantIds(items: AssociationOverviewItem[], id: number): Set<number> {
  const below = new Set<number>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const x of items) {
      if (x.parent_id != null && below.has(x.parent_id) && !below.has(x.id)) {
        below.add(x.id);
        grew = true;
      }
    }
  }
  return below;
}

/** 親の協会の名前を、上から順にたどった表示（例：東京都私立幼稚園協会 ＞ 多摩地区） */
function pathLabel(items: AssociationOverviewItem[], id: number): string {
  const byId = new Map(items.map((i) => [i.id, i]));
  const names: string[] = [];
  const seen = new Set<number>();
  for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined) {
    seen.add(cur.id);
    names.unshift(cur.name);
  }
  return names.join(" ＞ ");
}

/**
 * 協会の組織図での位置を決める。「上位の協会」を選ぶと、その協会の下に入る（選ばなければ都道府県の協会）。
 * 都道府県の協会は、都道府県を選ぶとその地区に入る。変更はすぐ保存される。
 */
export function AssociationStructureFields({
  item,
  items,
  onSaved,
  compact = false,
}: {
  item: AssociationOverviewItem;
  items: AssociationOverviewItem[];
  onSaved: () => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = useMemo(() => {
    const below = descendantIds(items, item.id);
    return items.filter((x) => !below.has(x.id)).sort((a, b) => pathLabel(items, a.id).localeCompare(pathLabel(items, b.id), "ja"));
  }, [items, item.id]);

  async function save(json: { parent_id?: number | null; prefecture?: string | null; is_top_level?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.associations[":id"].structure.$patch({ param: { id: String(item.id) }, json }));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const region = regionOfPrefecture(item.prefecture);
  const isTop = item.is_top_level === 1;
  return (
    <div className={compact ? "space-y-1.5" : "space-y-3"}>
      <label className="flex items-center gap-1.5 text-sm text-slate-700">
        <input type="checkbox" checked={isTop} disabled={busy} onChange={(e) => void save({ is_top_level: e.target.checked })} />
        最上位の組織にする（全日本私立幼稚園連合会と同じ位置）
      </label>
      {!isTop && (
      <label className="block">
        <span className="mb-0.5 block text-xs text-slate-500">上位の協会（この協会が入る協会）</span>
        <select className={selCls} value={item.parent_id ?? ""} disabled={busy} onChange={(e) => void save({ parent_id: e.target.value ? Number(e.target.value) : null })}>
          <option value="">（なし：都道府県の協会として、地区の下に置く）</option>
          {candidates.map((x) => (
            <option key={x.id} value={x.id}>
              {pathLabel(items, x.id)}
            </option>
          ))}
        </select>
      </label>
      )}
      {!isTop && item.parent_id == null && (
        <label className="block">
          <span className="mb-0.5 block text-xs text-slate-500">都道府県（入る地区：{region?.label ?? UNKNOWN_REGION.label}）</span>
          <select className={selCls} value={item.prefecture_setting ?? ""} disabled={busy} onChange={(e) => void save({ prefecture: e.target.value || null })}>
            <option value="">（加盟施設から自動{item.prefecture_setting == null && item.prefecture ? `：${item.prefecture}` : ""}）</option>
            {PREFECTURES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** マインドマップで協会を選んだときに開く編集ダイアログ */
export function AssociationStructureDialog({ itemId, items, onSaved, onClose }: { itemId: number; items: AssociationOverviewItem[]; onSaved: () => void; onClose: () => void }) {
  // 保存のたびに一覧を読み直すので、最新の協会をここで引き直す
  const item = items.find((x) => x.id === itemId);
  if (!item) return null;
  const children = items.filter((x) => x.parent_id === item.id);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={`${item.name}の位置を変更`} onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-slate-900">{item.name}</h3>
        <p className="mb-3 mt-0.5 text-xs text-slate-500">組織図でこの協会を入れる場所を選びます。「最上位の組織」にすると、全日本私立幼稚園連合会と並んで表示されます。{children.length > 0 && `下位の${children.length}協会も一緒に移ります。`}</p>
        <AssociationStructureFields item={item} items={items} onSaved={onSaved} />
        <div className="mt-4 flex justify-end">
          <Button onClick={onClose}>閉じる</Button>
        </div>
      </div>
    </div>
  );
}
