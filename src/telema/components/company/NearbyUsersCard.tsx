import { Link } from "react-router";
import { api, unwrap } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { Card, Empty, ErrorBox } from "../ui";

/** 同じ市（政令指定都市は区をまとめた市の単位。それ以外は市区町村）にあるユーザー（導入済みの施設）を自動で一覧にする。理事長名・園長名・法人名・園名を出し、カルテへ移動できる */
export function NearbyUsersCard({ companyId }: { companyId: number }) {
  const id = String(companyId);
  const { data, error, reload } = useApi(() => unwrap(api.companies[":id"]["nearby-users"].$get({ param: { id } })), [id]);
  const place = data ? [data.prefecture, data.city].filter(Boolean).join("") : "";
  return (
    <Card
      title={
        <>
          同じ市のユーザー{place && <span className="ml-1.5 font-normal text-slate-500">{place}</span>}
          {data && data.total > 0 && <span className="ml-1.5 font-normal tabular-nums text-slate-500">{data.total}件</span>}
        </>
      }
    >
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : !data ? (
        <Empty>読み込み中…</Empty>
      ) : !data.city ? (
        <p className="text-sm text-slate-400">この施設の市区町村が登録されていないため、表示できません。住所を登録すると、同じ市区町村のユーザーが表示されます。</p>
      ) : data.items.length === 0 ? (
        <p className="text-sm text-slate-400">{place}に、ほかのユーザーはいません。</p>
      ) : (
        <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
          {data.items.map((u) => (
            <li key={u.id} className="space-y-1 py-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">園名</div>
                  <div className="font-medium text-slate-900">
                    {u.company_name}
                    {u.city && data.city && u.city !== data.city && <span className="ml-1.5 text-xs font-normal text-slate-500">{u.city}</span>}
                  </div>
                </div>
                <Link to={`/companies/${u.id}`} className="shrink-0 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-300 hover:bg-indigo-50">
                  カルテへ
                </Link>
              </div>
              <dl className="grid grid-cols-[3.5rem_1fr] gap-x-2 gap-y-0.5 text-xs">
                <dt className="text-slate-500">法人名</dt>
                <dd className="text-slate-800">{u.organization_name || <span className="text-slate-300">—</span>}</dd>
                <dt className="text-slate-500">理事長</dt>
                <dd className="text-slate-800">{u.chairman_name || <span className="text-slate-300">—</span>}</dd>
                <dt className="text-slate-500">園長</dt>
                <dd className="text-slate-800">{u.principal_name || <span className="text-slate-300">—</span>}</dd>
              </dl>
            </li>
          ))}
          {data.total > data.items.length && <li className="py-2 text-xs text-slate-500">ほか {data.total - data.items.length}件（先頭 {data.items.length}件を表示）</li>}
        </ul>
      )}
    </Card>
  );
}
