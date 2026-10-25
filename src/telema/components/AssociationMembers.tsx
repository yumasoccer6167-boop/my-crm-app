import { Link } from "react-router";
import type { AssociationMember } from "../types";
import { ChairCrown, OfficerCrown } from "./CompanyTable";
import { HeadquartersBadge } from "./company/SiblingTabs";
import { StatusBadge } from "./ui";

/** 加盟施設を法人ごとにまとめる。法人に属していない施設は、最後に「法人未登録」としてまとめる */
export function groupByOrganization(facilities: AssociationMember[]): { key: string; name: string | null; facilities: AssociationMember[] }[] {
  const groups = new Map<string, { key: string; name: string | null; facilities: AssociationMember[] }>();
  for (const f of facilities) {
    const key = f.organization_id == null ? "none" : String(f.organization_id);
    const g = groups.get(key) ?? { key, name: f.organization_name, facilities: [] };
    g.facilities.push(f);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : (a.name ?? "").localeCompare(b.name ?? "", "ja")));
}

/** 協会の加盟施設を、法人ごとに並べて表示する（リスト表示で協会を開いたときの中身） */
export function AssociationMembers({ facilities, truncated }: { facilities: AssociationMember[]; truncated: boolean }) {
  if (facilities.length === 0) return <p className="text-sm text-slate-400">加盟している施設はありません。</p>;
  const groups = groupByOrganization(facilities);
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="mb-1 text-xs font-medium text-slate-600">
            {g.key === "none" ? "法人未登録の施設" : g.name || "（法人名なし）"}
            <span className="ml-1 font-normal text-slate-400">{g.facilities.length}施設</span>
          </div>
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {g.facilities.map((f) => (
              <li key={f.id} className="flex min-w-0 items-center gap-1.5 text-sm">
                <Link to={`/companies/${f.id}`} className="truncate text-indigo-700 hover:underline">
                  {f.company_name}
                </Link>
                {f.has_association_chair && <ChairCrown />}
                {f.has_association_officer && <OfficerCrown />}
                {!!f.is_headquarters && <HeadquartersBadge />}
                {!!f.is_user && <span className="shrink-0 rounded bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">ユーザー</span>}
                {f.status_label && <StatusBadge label={f.status_label} category={f.status_category} />}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {truncated && <p className="text-xs text-amber-700">加盟施設が多いため、先頭の一部だけを表示しています。</p>}
    </div>
  );
}
