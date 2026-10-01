import { useEffect, useState } from "react";
import type { CompanyListItem } from "../types";
import { api, unwrap } from "../lib/api";
import { inputCls } from "./ui";

/** ユーザー（受注）か、それ以外か */
export function UserTag({ category }: { category: string | null }) {
  return category === "won" ? (
    <span className="shrink-0 rounded bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">ユーザー</span>
  ) : (
    <span className="shrink-0 rounded bg-slate-50 px-1.5 text-[11px] text-slate-500 ring-1 ring-inset ring-slate-200">ユーザー以外</span>
  );
}

/** 施設を名前・電話・住所・担当者名で探して1件選ぶ（ユーザーかどうかは問わない） */
export function CompanyPicker({
  placeholder,
  exclude = [],
  autoFocus,
  onPick,
  onError,
}: {
  placeholder: string;
  exclude?: number[];
  autoFocus?: boolean;
  onPick: (c: CompanyListItem) => void;
  onError: (message: string) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CompanyListItem[]>([]);
  const excludeKey = exclude.join(",");

  // 入力が止まってから検索
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await unwrap(api.companies.$get({ query: { q: q.trim(), per_page: "10", sort: "company_name", skip_count: "1" } }));
        setHits(r.items.filter((x) => !exclude.includes(x.id)));
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, excludeKey]);

  return (
    <div>
      <input className={inputCls} autoFocus={autoFocus} placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      {hits.length > 0 && (
        <ul className="mt-1 max-h-56 overflow-y-auto rounded-md bg-white ring-1 ring-slate-200">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => onPick(h)} className="block w-full px-2.5 py-1.5 text-left text-sm hover:bg-indigo-50">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium text-slate-900">{h.company_name}</span>
                  <UserTag category={h.status_category} />
                </div>
                <div className="text-xs text-slate-500">{[h.city, h.contact_name, h.phone].filter(Boolean).join(" · ")}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
