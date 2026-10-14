import { Link } from "react-router";
import type { Sibling } from "../../types";

/** カルテ上部の、姉妹園（同じ法人の施設）の切り替えボタン。いま開いている施設を含め、園名のボタンを並べる */
export function SiblingTabs({ current, organizationName, siblings }: { current: { id: number; company_name: string; is_user: number }; organizationName: string | null; siblings: Sibling[] }) {
  if (siblings.length === 0) return null;
  const all = [{ id: current.id, company_name: current.company_name, is_user: current.is_user }, ...siblings].sort((a, b) => a.company_name.localeCompare(b.company_name, "ja"));
  return (
    <nav aria-label="同じ法人の施設" className="flex flex-wrap items-center gap-1.5 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
      <span className="mr-1 text-xs text-slate-500">{organizationName ? `${organizationName}の施設` : "姉妹園"}</span>
      {all.map((s) => {
        const active = s.id === current.id;
        return (
          <Link
            key={s.id}
            to={`/companies/${s.id}`}
            aria-current={active ? "page" : undefined}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${active ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
          >
            {s.company_name}
            {!!s.is_user && <span className={`rounded px-1 text-[10px] ${active ? "bg-emerald-400/30 text-emerald-100" : "bg-emerald-50 text-emerald-700"}`}>ユーザー</span>}
          </Link>
        );
      })}
    </nav>
  );
}
