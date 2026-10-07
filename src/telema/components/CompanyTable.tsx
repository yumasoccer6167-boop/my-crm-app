import { Link } from "react-router";
import type { CompanyListItem } from "../types";
import { fmtShort, isOverdue } from "../lib/format";
import { StatusBadge, Temperature } from "./ui";

export function Rating({ rating, count }: { rating: number | null; count: number | null }) {
  if (rating == null && !count) return <span className="text-slate-300">—</span>;
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className="text-amber-500">★</span>
      <span className="font-medium text-slate-800">{rating?.toFixed(1) ?? "—"}</span>
      <span className="ml-0.5 text-xs text-slate-500">({(count ?? 0).toLocaleString()})</span>
    </span>
  );
}

/** 加盟協会・リスト種類のチップ。名前が長くても列が潰れないよう、折り返して並べる。種類の見分けがつくよう色を変える */
const CHIP_TONE = {
  association: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  listType: "bg-emerald-50 text-emerald-800 ring-emerald-200",
} as const;

function TagChips({ names, tone }: { names: string[]; tone: keyof typeof CHIP_TONE }) {
  if (names.length === 0) return <span className="text-slate-300">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {names.map((n) => (
        <span key={n} className={`break-words rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${CHIP_TONE[tone]}`}>
          {n}
        </span>
      ))}
    </span>
  );
}

function NextCall({ iso }: { iso: string | null }) {
  return <span className={isOverdue(iso) ? "font-semibold text-rose-600" : "text-slate-700"}>{fmtShort(iso)}</span>;
}

/** PCはテーブル、スマホはカード */
export function CompanyTable({
  items,
  showAssignee = true,
  selected,
  onSelectedChange,
  highlightId,
}: {
  items: CompanyListItem[];
  showAssignee?: boolean;
  /** 目印を付ける行（リストに戻ったときの、直前に開いていた施設） */
  highlightId?: number | null;
  /** 渡すと行の選択チェックボックスを出す */
  selected?: Set<number>;
  onSelectedChange?: (next: Set<number>) => void;
}) {
  const selectable = !!selected && !!onSelectedChange;
  const allChecked = selectable && items.length > 0 && items.every((c) => selected.has(c.id));
  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange!(next);
  };
  const toggleAll = () => {
    const next = new Set(selected);
    for (const c of items) {
      if (allChecked) next.delete(c.id);
      else next.add(c.id);
    }
    onSelectedChange!(next);
  };
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              {selectable && (
                <th className="w-8 py-2 pr-2">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="このページをすべて選択" />
                </th>
              )}
              <th className="py-2 pr-3 font-medium">会社・施設</th>
              <th className="px-3 py-2 font-medium">電話</th>
              <th className="px-3 py-2 font-medium">ステータス</th>
              <th className="px-3 py-2 text-center font-medium">温度</th>
              <th className="px-3 py-2 font-medium">口コミ</th>
              <th className="px-3 py-2 font-medium">担当者</th>
              <th className="px-3 py-2 font-medium">リスト種類</th>
              <th className="px-3 py-2 font-medium">加盟協会</th>
              <th className="px-3 py-2 font-medium">次回架電</th>
              <th className="px-3 py-2 font-medium">最終架電</th>
              {showAssignee && <th className="px-3 py-2 font-medium">営業</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr
                key={c.id}
                data-company-id={c.id}
                className={`border-b border-slate-100 hover:bg-slate-50 ${selected?.has(c.id) ? "bg-indigo-50" : c.id === highlightId ? "bg-amber-50 shadow-[inset_3px_0_0_#f59e0b]" : ""}`}
              >
                {selectable && (
                  <td className="py-2 pr-2">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={`${c.company_name}を選択`} />
                  </td>
                )}
                <td className="max-w-72 py-2 pr-3">
                  <div className="flex items-center">
                    <Link to={`/companies/${c.id}`} className="truncate font-medium text-indigo-700 hover:underline">
                      {c.company_name}
                    </Link>
                    {!!c.is_user && <span className="ml-1.5 rounded bg-emerald-50 px-1.5 align-middle text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">ユーザー</span>}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {[c.city, c.industry, c.organization_name].filter(Boolean).join(" · ")}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {c.phone ? (
                    <a href={`tel:${c.phone}`} className="tabular-nums text-slate-700 hover:underline">
                      {c.phone}
                    </a>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge label={c.status_label} category={c.status_category} />
                </td>
                <td className="px-3 py-2 text-center">
                  <Temperature value={c.temperature} />
                </td>
                <td className="px-3 py-2">
                  <Rating rating={c.google_rating} count={c.google_review_count} />
                </td>
                <td className="max-w-32 truncate px-3 py-2 text-slate-700">{c.contact_name ?? <span className="text-slate-400">—</span>}</td>
                <td className="min-w-24 max-w-40 px-3 py-2">
                  <TagChips names={c.list_types} tone="listType" />
                </td>
                <td className="min-w-28 max-w-56 px-3 py-2">
                  <TagChips names={c.associations} tone="association" />
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  <NextCall iso={c.next_call_at} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-500">
                  {fmtShort(c.last_called_at)}
                  {c.call_count > 0 && <span className="ml-1 text-xs text-slate-400">({c.call_count}回)</span>}
                </td>
                {showAssignee && <td className="whitespace-nowrap px-3 py-2 text-slate-600">{c.assigned_user_name ?? "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-slate-100 md:hidden">
        {items.map((c) => (
          <li key={c.id} data-company-id={c.id} className={`py-3 ${c.id === highlightId ? "-mx-2 rounded-md bg-amber-50 px-2 shadow-[inset_3px_0_0_#f59e0b]" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <label className="flex items-start gap-2">
                {selectable && (
                  <input type="checkbox" className="mt-1" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={`${c.company_name}を選択`} />
                )}
                <Link to={`/companies/${c.id}`} className="font-medium text-indigo-700">
                  {c.company_name}
                </Link>
                {!!c.is_user && <span className="ml-1.5 rounded bg-emerald-50 px-1.5 align-middle text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">ユーザー</span>}
              </label>
              <StatusBadge label={c.status_label} category={c.status_category} />
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
              <span>{[c.city, c.industry].filter(Boolean).join(" · ")}</span>
              {c.google_rating != null && <Rating rating={c.google_rating} count={c.google_review_count} />}
            </div>
            {(c.list_types.length > 0 || c.associations.length > 0) && (
              <div className="mt-1 flex flex-wrap gap-1">
                {c.list_types.length > 0 && <TagChips names={c.list_types} tone="listType" />}
                {c.associations.length > 0 && <TagChips names={c.associations} tone="association" />}
              </div>
            )}
            <div className="mt-1.5 flex items-center justify-between text-sm">
              {c.phone ? (
                <a href={`tel:${c.phone}`} className="tabular-nums text-slate-700 underline">
                  {c.phone}
                </a>
              ) : (
                <span />
              )}
              <span className="text-xs">
                次回 <NextCall iso={c.next_call_at} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
