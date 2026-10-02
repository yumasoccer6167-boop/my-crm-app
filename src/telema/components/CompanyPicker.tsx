import { useEffect, useState } from "react";
import type { CompanyListItem } from "../types";
import { api, unwrap } from "../lib/api";
import { inputCls } from "./ui";

/** ユーザー（導入済み）か、それ以外か。営業ステータスとは別に持つ */
export function UserTag({ isUser }: { isUser: number | boolean }) {
  return isUser ? (
    <span className="shrink-0 rounded bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">ユーザー</span>
  ) : (
    <span className="shrink-0 rounded bg-slate-50 px-1.5 text-[11px] text-slate-500 ring-1 ring-inset ring-slate-200">ユーザー以外</span>
  );
}

/**
 * 施設を名前・電話・住所・担当者名で探して1件選ぶ（ユーザーかどうかは問わない）。
 * onCreate を渡すと、見つからないときに入力した名前で新しい施設を登録する入口を出す
 */
export function CompanyPicker({
  placeholder,
  exclude = [],
  autoFocus,
  onPick,
  onCreate,
  onError,
}: {
  placeholder: string;
  exclude?: number[];
  autoFocus?: boolean;
  onPick: (c: CompanyListItem) => void;
  onCreate?: (name: string) => void;
  onError: (message: string) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CompanyListItem[]>([]);
  // 検索が終わった語（新規登録の入口は、検索結果を見てから出す）
  const [searched, setSearched] = useState("");
  const excludeKey = exclude.join(",");

  // 入力が止まってから検索
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      setSearched("");
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await unwrap(
          api.companies.$get({
            query: {
              q: q.trim(),
              per_page: "10",
              sort: "company_name",
              skip_count: "1",
            },
          }),
        );
        setHits(r.items.filter((x) => !exclude.includes(x.id)));
        setSearched(q.trim());
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
      {(hits.length > 0 || (onCreate && searched)) && (
        <ul className="mt-1 max-h-56 overflow-y-auto rounded-md bg-white ring-1 ring-slate-200">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => onPick(h)} className="block w-full px-2.5 py-1.5 text-left text-sm hover:bg-indigo-50">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium text-slate-900">{h.company_name}</span>
                  <UserTag isUser={h.is_user} />
                </div>
                <div className="text-xs text-slate-500">{[h.city, h.contact_name, h.phone].filter(Boolean).join(" · ")}</div>
              </button>
            </li>
          ))}
          {onCreate && searched && (
            <li className="border-t border-slate-100">
              <button
                type="button"
                onClick={() => onCreate(searched)}
                className="block w-full px-2.5 py-1.5 text-left text-sm text-indigo-700 hover:bg-indigo-50"
              >
                ＋「{searched}」を新しい園として登録
                <div className="text-xs text-slate-500">
                  {hits.length === 0 ? "見つかりませんでした。" : "上に無ければ、"}
                  まだ登録の無い園を追加してつなぎます
                </div>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
