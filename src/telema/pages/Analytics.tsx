import { useEffect, useState } from "react";
import type { AnalyticsPace } from "../types";
import { api, unwrap } from "../lib/api";
import { todayJst } from "../lib/format";
import { useMasters } from "../lib/masters";
import { fmtP, pToYen, yenToP } from "../lib/points";
import { useApi } from "../lib/useApi";
import { Button, Card, Empty, ErrorBox, inputCls, Loading, selectCls } from "../components/ui";

const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const prevMonth = (iso: string) => {
  const prevEnd = addDays(monthStart(iso), -1);
  return { from: monthStart(prevEnd), to: prevEnd };
};
const yen = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n).toLocaleString()}円`);
const pct = (n: number | null | undefined) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

/** 数値分析：目標に対する今週・今日のペースと、期間の実績（訪問・受注・単価・商材別の粗利・テレアポ） */
export function Analytics() {
  const { me, users } = useMasters();
  const today = todayJst();
  const [paceUser, setPaceUser] = useState<number>(me.id);
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [who, setWho] = useState(me.role === "sales" ? String(me.id) : "all");
  const isSales = me.role === "sales";
  const members = users.filter((u) => u.is_active);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">目標に対する今週・今日のペースと、期間の実績です。{isSales ? "自分の分を表示しています。" : "担当者を選んで見られます。"}</p>

      <Card
        title="今週のペース"
        action={
          !isSales && (
            <select value={paceUser} onChange={(e) => setPaceUser(Number(e.target.value))} className={selectCls} aria-label="ペースを見る担当者">
              {members.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )
        }
      >
        <Pace userId={paceUser} canEdit={me.role === "admin" || paceUser === me.id} />
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-slate-500">実績の期間</span>
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={selectCls} aria-label="期間の始まり" />
          <span className="text-slate-400">〜</span>
          <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className={selectCls} aria-label="期間の終わり" />
          {(
            [
              ["今月", monthStart(today), today],
              ["先月", prevMonth(today).from, prevMonth(today).to],
              ["直近30日", addDays(today, -29), today],
            ] as [string, string, string][]
          ).map(([label, f, t]) => (
            <button
              key={label}
              type="button"
              className="rounded px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50"
              onClick={() => {
                setFrom(f);
                setTo(t);
              }}
            >
              {label}
            </button>
          ))}
          {!isSales && (
            <>
              <span className="ml-2 text-xs text-slate-500">担当者</span>
              <select value={who} onChange={(e) => setWho(e.target.value)} className={selectCls} aria-label="実績の担当者">
                <option value="all">全員</option>
                {members.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </Card>
      <Results from={from} to={to} who={who} />
    </div>
  );
}

function Stat({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "alert" }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-inset ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${tone === "alert" ? "text-rose-700" : "text-slate-900"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function Pace({ userId, canEdit }: { userId: number; canEdit: boolean }) {
  const { data, error, loading, reload } = useApi(() => unwrap(api.analytics.pace.$get({ query: { user_id: userId } })), [userId]);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <TargetForm key={`${data.user_id}-${data.month}`} pace={data} canEdit={canEdit} onSaved={reload} />
      {!data.target ? (
        <Empty>{data.month} の目標が未設定です。{canEdit ? "上で目標を設定すると、ペースが出ます。" : "管理者が目標を設定すると、ペースが出ます。"}</Empty>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="今月の残り（粗利）" value={fmtP(data.month_remaining?.gross_profit)} sub={`目標 ${fmtP(data.target.gross_profit)} ／ 実績 ${fmtP(data.month_actual.gross_profit)}`} />
            <Stat label="今月の残り（台数）" value={`${data.month_remaining?.units ?? 0}台`} sub={`目標 ${data.target.units}台 ／ 実績 ${data.month_actual.units}台`} />
            <Stat label="今週の必要粗利" value={fmtP(data.week_need?.gross_profit)} sub={`今週の残り稼働日 ${data.week_workdays_left}日（月末まで ${data.month_workdays_left}日）`} />
            <Stat label="今週の必要台数" value={`${data.week_need?.units ?? 0}台`} />
          </div>
          {data.week_visits_need != null ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="今週の必要訪問件数" value={`${data.week_visits_need}件`} />
              <Stat label="今日の必要訪問件数" value={`${data.today_visits_need}件`} sub={`今日これまで ${data.visits_done_today}件`} />
              <Stat label="今日あと" value={`${data.today_visits_left}件`} tone={data.today_visits_left ? "alert" : "default"} />
            </div>
          ) : (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              直近{data.basis.days}日の訪問と受注の実績がまだ足りないため、必要な訪問件数は出せません（訪問 {data.basis.visits}件・粗利 {fmtP(data.basis.gross_profit)}）。
            </p>
          )}
          <p className="text-xs text-slate-400">
            今週の必要粗利・台数は、今月の残りを残りの稼働日で割って、今週の残り稼働日の分にしたものです（稼働日は平日）。
            必要な訪問件数は、直近{data.basis.days}日の1訪問あたりの粗利（{fmtP(data.basis.gross_profit_per_visit)}）で割り戻しています。
          </p>
        </>
      )}
    </div>
  );
}

function TargetForm({ pace, canEdit, onSaved }: { pace: AnalyticsPace; canEdit: boolean; onSaved: () => void }) {
  const [gp, setGp] = useState(pace.target ? yenToP(pace.target.gross_profit) : "");
  const [units, setUnits] = useState(pace.target ? String(pace.target.units) : "");
  // マイページの週間・月間の達成率に使う件数の目標
  const [counts, setCounts] = useState({ deals: pace.target ? String(pace.target.deals) : "", first_visits: pace.target ? String(pace.target.first_visits) : "", scheduled: pace.target ? String(pace.target.scheduled) : "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await unwrap(
        api.targets[":user_id"][":month"].$put({
          param: { user_id: String(pace.user_id), month: pace.month },
          json: {
            gross_profit: pToYen(gp) ?? 0,
            units: Math.max(0, Math.round(Number(units) || 0)),
            deals: Math.max(0, Math.round(Number(counts.deals) || 0)),
            first_visits: Math.max(0, Math.round(Number(counts.first_visits) || 0)),
            scheduled: Math.max(0, Math.round(Number(counts.scheduled) || 0)),
          },
        }),
      );
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="text-sm font-medium text-slate-700">{pace.month} の目標</div>
      <label className="block">
        <div className="mb-1 text-xs text-slate-500">粗利（P）</div>
        <input type="number" min={0} step="any" inputMode="decimal" value={gp} disabled={!canEdit} onChange={(e) => setGp(e.target.value)} placeholder="例：300（1万円＝1P）" className={`${inputCls} w-40`} />
      </label>
      <label className="block">
        <div className="mb-1 text-xs text-slate-500">台数</div>
        <input type="number" min={0} step={1} inputMode="numeric" value={units} disabled={!canEdit} onChange={(e) => setUnits(e.target.value)} placeholder="例：30" className={`${inputCls} w-28`} />
      </label>
      {(
        [
          ["deals", "商談数"],
          ["first_visits", "初回訪問件数"],
          ["scheduled", "時間設定件数"],
        ] as const
      ).map(([k, label]) => (
        <label key={k} className="block">
          <div className="mb-1 text-xs text-slate-500">{label}</div>
          <input type="number" min={0} step={1} inputMode="numeric" value={counts[k]} disabled={!canEdit} onChange={(e) => setCounts({ ...counts, [k]: e.target.value })} className={`${inputCls} w-28`} />
        </label>
      ))}
      {canEdit && (
        <Button size="sm" variant="primary" disabled={saving} onClick={save}>
          {saving ? "保存中…" : "目標を保存"}
        </Button>
      )}
      {saved && <span className="text-xs text-emerald-700">保存しました</span>}
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}

function Results({ from, to, who }: { from: string; to: string; who: string }) {
  const { data, error, loading, reload } = useApi(() => unwrap(api.analytics.$get({ query: { date_from: from, date_to: to, user_id: who } })), [from, to, who]);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const { visits: v, orders: o, products } = data;
  return (
    <>
      <Card title="訪問">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="初回訪問件数" value={`${v.first_visits}件`} sub={`営業時間設定 ${v.first_scheduled} ／ 見込みなし ${v.first_no_prospect}`} />
          <Stat label="ユーザー訪問件数" value={`${v.user_visits}件`} />
          <Stat label="営業件数" value={`${v.sales_visits}件`} sub={`即決受注 ${v.won} ／ 返事待ち ${v.waiting} ／ 再営業 ${v.resales} ／ NG ${v.ng}`} />
          <Stat label="返事待ち対応" value={`${v.reply_won + v.reply_ng + v.reply_resales}件`} sub={`受注 ${v.reply_won} ／ NG ${v.reply_ng} ／ 再営業 ${v.reply_resales}`} />
          <Stat label="営業落ち率" value={pct(v.fall_rate)} sub="NG（返事待ち対応を含む）÷ 営業件数" />
        </div>
      </Card>

      <Card title="受注（契約情報の契約日）">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="受注件数" value={`${o.orders}件`} sub={`${o.corporations}法人`} />
          <Stat label="受注金額" value={yen(o.amount)} />
          <Stat label="粗利" value={fmtP(o.gross_profit)} />
          <Stat label="台数" value={`${o.units}台`} />
          <Stat label="1台あたり受注単価" value={yen(o.unit_price)} sub="受注金額 ÷ 台数" />
          <Stat label="1法人あたり受注単価" value={yen(o.corporation_price)} sub="受注金額 ÷ 受注した法人数" />
        </div>
        <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-800">商材別の平均受注粗利</h3>
        {products.length === 0 ? (
          <Empty>この期間の受注がありません</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-right text-sm">
              <thead className="text-xs text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-2 py-2 text-left font-medium">商材</th>
                  <th className="px-2 py-2 font-medium">件数</th>
                  <th className="px-2 py-2 font-medium">台数</th>
                  <th className="px-2 py-2 font-medium">粗利合計</th>
                  <th className="px-2 py-2 font-medium">平均受注粗利</th>
                  <th className="px-2 py-2 font-medium">平均受注金額</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.product_name} className="border-b border-slate-100 tabular-nums">
                    <td className="px-2 py-2 text-left">{p.product_name}</td>
                    <td className="px-2 py-2">{p.orders}</td>
                    <td className="px-2 py-2">{p.units}</td>
                    <td className="px-2 py-2">{fmtP(p.gross_profit)}</td>
                    <td className="px-2 py-2 font-medium">{fmtP(p.avg_gross_profit)}</td>
                    <td className="px-2 py-2">{yen(p.avg_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
