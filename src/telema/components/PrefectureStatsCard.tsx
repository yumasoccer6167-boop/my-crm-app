import { api, unwrap } from "../lib/api";
import { useApi } from "../lib/useApi";
import { PREFECTURES } from "../shared/prefectures";
import { Card, Empty, ErrorBox, Loading } from "./ui";

const ORDER = new Map<string, number>(PREFECTURES.map((p, i) => [p, i]));
const pct = (users: number, total: number) => (total ? `${((users / total) * 100).toFixed(1)}%` : "-");

/** 都道府県別の幼稚園・保育園の総数（テレマリストの登録施設数）と、そのうちユーザー（ステータス区分が受注）の件数・割合 */
export function PrefectureStatsCard() {
  const { data, error, loading, reload } = useApi(() => unwrap(api["prefecture-stats"].$get()), []);

  // JIS順に並べ、都道府県が入っていない施設は「不明」として最後に置く
  const rows = [...(data ?? [])].sort((a, b) => (ORDER.get(a.prefecture) ?? 99) - (ORDER.get(b.prefecture) ?? 99));
  const total = rows.reduce((n, r) => n + r.total, 0);
  const users = rows.reduce((n, r) => n + r.users, 0);

  return (
    <Card title="都道府県別のユーザー割合">
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : !data || (loading && !data) ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>登録されている施設はありません</Empty>
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-500">総数＝テレマリストに登録されている幼稚園・保育園の数。ユーザー＝ステータスの区分が「受注」の施設。</p>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="sticky top-0 bg-white text-xs text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="py-1.5 text-left font-medium">都道府県</th>
                  <th className="py-1.5 text-right font-medium">総数</th>
                  <th className="py-1.5 text-right font-medium">ユーザー</th>
                  <th className="py-1.5 pl-3 text-right font-medium">ユーザー割合</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.prefecture}>
                    <td className="py-1.5">{r.prefecture}</td>
                    <td className="py-1.5 text-right">{r.total.toLocaleString()}</td>
                    <td className="py-1.5 text-right">{r.users.toLocaleString()}</td>
                    <td className="py-1.5 pl-3">
                      <div className="flex items-center justify-end gap-2">
                        <span className="h-1.5 w-16 overflow-hidden rounded bg-slate-100">
                          <span className="block h-full bg-indigo-500" style={{ width: `${r.total ? (r.users / r.total) * 100 : 0}%` }} />
                        </span>
                        <span className="w-12 text-right">{pct(r.users, r.total)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-white font-semibold">
                <tr className="border-t border-slate-200">
                  <td className="py-1.5">合計</td>
                  <td className="py-1.5 text-right">{total.toLocaleString()}</td>
                  <td className="py-1.5 text-right">{users.toLocaleString()}</td>
                  <td className="py-1.5 pl-3 text-right">{pct(users, total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
