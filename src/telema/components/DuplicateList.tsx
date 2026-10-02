import { Link } from "react-router";
import type { DuplicateCandidate } from "../types";
import { api, unwrap } from "../lib/api";

const MATCH_LABEL: Record<DuplicateCandidate["match"], string> = { phone: "電話番号が同じ", name_address: "施設名と住所が同じ", name: "施設名が同じ" };

/** 登録しようとしている施設と同じかもしれない、登録済みの施設を探す */
export function findDuplicates(v: { company_name?: string; phone?: string; address?: string }) {
  return unwrap(api.companies.duplicates.$get({ query: { company_name: v.company_name?.trim(), phone: v.phone?.trim(), address: v.address?.trim() } }));
}

/** 重複候補の一覧。onPick があれば「この施設を使う」を出す */
export function DuplicateList({ items, onPick }: { items: DuplicateCandidate[]; onPick?: (c: DuplicateCandidate) => void }) {
  return (
    <div className="rounded-md bg-amber-50 p-2 text-sm ring-1 ring-amber-200">
      <div className="mb-1 font-medium text-amber-800">同じ施設が既に登録されているかもしれません</div>
      <ul className="space-y-1">
        {items.map((c) => (
          <li key={c.id} className="flex flex-wrap items-baseline gap-x-2">
            <Link to={`/companies/${c.id}`} className="font-medium text-slate-900 hover:underline">
              {c.company_name}
            </Link>
            <span className="text-xs text-amber-700">{MATCH_LABEL[c.match]}</span>
            <span className="text-xs text-slate-500">{[c.address, c.phone].filter(Boolean).join(" · ")}</span>
            {onPick && (
              <button type="button" onClick={() => onPick(c)} className="ml-auto text-xs font-medium text-indigo-700 hover:underline">
                この施設を使う
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
