import { Link } from "react-router";
import { CallStatsCard } from "../components/CallStatsCard";
import { CompanyTable } from "../components/CompanyTable";
import { Card, Empty, ErrorBox, Loading } from "../components/ui";
import { api, unwrap } from "../lib/api";
import { useApi } from "../lib/useApi";

function Stat({ label, value, to, tone = "text-slate-900" }: { label: string; value: number; to?: string; tone?: string }) {
  const body = (
    <>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 text-2xl font-semibold tabular-nums ${tone}`}>{value.toLocaleString()}</div>
    </>
  );
  const cls = "block rounded-lg bg-white px-4 py-3 ring-1 ring-slate-200";
  return to ? (
    <Link to={to} className={`${cls} hover:ring-indigo-300`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Dashboard() {
  const { data, error, loading, reload } = useApi(() => unwrap(api.dashboard.$get()), []);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const k = data.counts;

  return (
    <div className="space-y-5">
      {/* 1. 次に何をするか */}
      <Card
        title={
          <>
            今日の架電予定 <span className="ml-1 font-normal text-slate-500">{k.due_today}件</span>
            {k.overdue > 0 && <span className="ml-2 text-xs font-medium text-rose-600">うち期限超過 {k.overdue}件</span>}
          </>
        }
        action={
          <Link to="/companies?next_call=today" className="text-xs text-indigo-700 hover:underline">
            すべて見る
          </Link>
        }
      >
        {data.today.length ? (
          <CompanyTable items={data.today} />
        ) : (
          <Empty>
            今日の架電予定はありません。
            <Link to="/companies?category=not_started" className="text-indigo-700 underline">
              未架電リスト
            </Link>
            から始めましょう
          </Empty>
        )}
      </Card>

      {data.companies_needing_review > 0 && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          AIが確認を推奨している企業が <b>{data.companies_needing_review}</b> 件あります（STEP 11で確認画面を追加予定）
        </div>
      )}

      {/* 2. 現在の状態 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="総企業数（自分の担当）" value={k.mine} to="/companies?assigned=me" />
        <Stat label="未架電" value={k.not_started} to="/companies?category=not_started" />
        <Stat label="進行中" value={k.in_progress} to="/companies?category=in_progress" tone="text-sky-700" />
        <Stat label="アポ獲得" value={k.appointment} to="/companies?category=appointment" tone="text-amber-600" />
        <Stat label="受注" value={k.won} to="/companies?category=won" tone="text-emerald-700" />
        <Stat label="失注・NG" value={k.lost} to="/companies?category=lost" tone="text-rose-600" />
        <Stat label="今日の架電" value={data.calls_today.calls_today} />
      </div>

      {/* 3. 担当ごとの実績 */}
      <CallStatsCard />
    </div>
  );
}
