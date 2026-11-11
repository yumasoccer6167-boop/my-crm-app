import { useEffect, useState } from "react";
import type { MyAnalysis, MyPageData, MyPageMetric, MyPageProgress } from "../types";
import { api, unwrap } from "../lib/api";
import { fmtP, pToYen, yenToP } from "../lib/points";
import { useApi } from "../lib/useApi";
import { Donut, HBars, topSlices } from "../components/charts";
import { Button, Card, Empty, ErrorBox, inputCls, Loading } from "../components/ui";

const num = (n: number) => n.toLocaleString();
const dec = (n: number | null | undefined, unit: string) => (n == null ? "—" : `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}`);
const mmdd = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

/** 指標ごとの名前と数の出し方（粗利は円で持っていて、1万円＝1P で出す） */
const METRICS: { key: MyPageMetric; label: string; fmt: (n: number) => string }[] = [
  { key: "gross_profit", label: "粗利", fmt: (n) => fmtP(n) },
  { key: "units", label: "台数", fmt: (n) => `${num(n)}台` },
  { key: "deals", label: "商談数", fmt: (n) => `${num(n)}件` },
  { key: "first_visits", label: "初回訪問件数", fmt: (n) => `${num(n)}件` },
  { key: "scheduled", label: "時間設定件数", fmt: (n) => `${num(n)}件` },
];

/** マイページ：1ページ「数字の自己認識」と、2ページ「自己分析」 */
export function MyPage() {
  const [page, setPage] = useState<"numbers" | "analysis">("numbers");
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="マイページの表示" className="inline-flex rounded-lg bg-slate-100 p-0.5 text-sm">
        {(
          [
            ["numbers", "数字の自己認識"],
            ["analysis", "自己分析"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={page === k}
            onClick={() => setPage(k)}
            className={`rounded-md px-4 py-1.5 font-medium ${page === k ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {page === "numbers" ? <Numbers /> : <Analysis />}
    </div>
  );
}

// ---------- 1ページ：数字の自己認識 ----------
function Numbers() {
  const { data, error, loading, reload } = useApi(() => unwrap(api.mypage.$get()), []);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data || (loading && !data)) return <Loading />;
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        {mmdd(data.today)} の数字（営業成績ダッシュボードと同じ数え方です）。目標は、数値分析・営業成績の「月間目標」で設定します。
      </p>
      <Commit data={data} onSaved={reload} />
      <TodayNeeds data={data} />
      <ProgressCard title={`週間目標に対する達成率（${mmdd(data.week.from)}〜${mmdd(data.week.to)}）`} note="週間の目標は、月間目標 × その週の稼働日数 ÷ その月の稼働日数です。" personal={data.week.personal} team={data.week.team} teamName={data.team_name} teamSize={data.team_size} />
      <ProgressCard title={`月間目標に対する達成率（${Number(data.month.month.slice(5))}月）`} note="実績は今日までの数です。" personal={data.month.personal} team={data.month.team} teamName={data.team_name} teamSize={data.team_size} />
    </div>
  );
}

/** ① 今日のコミット：定量（粗利・台数・商談件数）と定性（ひとことコメント） */
function Commit({ data, onSaved }: { data: MyPageData; onSaved: () => void }) {
  const c = data.commit;
  const [gp, setGp] = useState(yenToP(c?.commit_gp));
  const [units, setUnits] = useState(c?.commit_units == null ? "" : String(c.commit_units));
  const [deals, setDeals] = useState(c?.commit_deals == null ? "" : String(c.commit_deals));
  const [comment, setComment] = useState(c?.comment ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (!message?.ok) return;
    const t = setTimeout(() => setMessage(null), 2500);
    return () => clearTimeout(t);
  }, [message]);

  const count = (s: string) => (s.trim() === "" ? null : Math.max(0, Math.round(Number(s) || 0)));
  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await unwrap(api.mypage.commit.$put({ json: { commit_gp: pToYen(gp), commit_units: count(units), commit_deals: count(deals), comment: comment.trim() } }));
      setMessage({ text: "保存しました", ok: true });
      onSaved();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="① 今日のコミット">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div>
          <h3 className="mb-2 text-xs font-medium text-slate-500">定量</h3>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block w-40">
              <div className="mb-1 text-xs text-slate-500">粗利（P）</div>
              <input type="number" min={0} step="any" inputMode="decimal" value={gp} onChange={(e) => setGp(e.target.value)} placeholder="例：30（1万円＝1P）" className={inputCls} />
            </label>
            <label className="block w-24">
              <div className="mb-1 text-xs text-slate-500">台数</div>
              <input type="number" min={0} step={1} inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} className={inputCls} />
            </label>
            <label className="block w-24">
              <div className="mb-1 text-xs text-slate-500">商談件数</div>
              <input type="number" min={0} step={1} inputMode="numeric" value={deals} onChange={(e) => setDeals(e.target.value)} className={inputCls} />
            </label>
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-medium text-slate-500">定性</h3>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={1000} placeholder="今日どう動くか・何を意識するか" className={inputCls} aria-label="定性のコミット" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" size="sm" disabled={saving} onClick={save}>
          {saving ? "保存中…" : "コミットを保存"}
        </Button>
        {message && <span className={`text-xs ${message.ok ? "text-emerald-700" : "text-rose-600"}`}>{message.text}</span>}
        {!message && c && <span className="text-xs text-slate-400">保存済み</span>}
      </div>
    </Card>
  );
}

/** ② 今日の必要数字：粗利・台数・商談件数 */
function TodayNeeds({ data }: { data: MyPageData }) {
  const items: { key: "gross_profit" | "units" | "deals"; label: string; fmt: (n: number) => string; commit: number | null | undefined }[] = [
    { key: "gross_profit", label: "粗利", fmt: (n) => fmtP(n), commit: data.commit?.commit_gp },
    { key: "units", label: "台数", fmt: (n) => `${num(n)}台`, commit: data.commit?.commit_units },
    { key: "deals", label: "商談件数", fmt: (n) => `${num(n)}件`, commit: data.commit?.commit_deals },
  ];
  const fmtCommit = (k: (typeof items)[number]) => (k.commit == null ? null : k.fmt(k.commit));
  return (
    <Card title="② 今日の必要数字">
      <p className="mb-3 text-xs text-slate-500">
        （月間目標 − 今日より前の今月の実績）÷ 今日以降の残り稼働日（{data.workdays_left}日{data.today_workday ? "、今日を含む" : "。今日は稼働日ではありません"}）で出しています。
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {items.map((it) => {
          const v = data.daily[it.key];
          return (
            <div key={it.key} className="rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-inset ring-slate-200">
              <div className="text-xs text-slate-500">{it.label}</div>
              {v ? (
                <>
                  <div className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">{it.fmt(v.need)}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    今日の実績 {it.fmt(v.done)} ／ 残り <span className={v.left > 0 ? "font-medium text-rose-700" : "font-medium text-emerald-700"}>{it.fmt(v.left)}</span>
                  </div>
                </>
              ) : (
                <div className="mt-1 text-sm text-slate-400">月間目標が未設定です</div>
              )}
              {fmtCommit(it) && <div className="mt-1 text-xs text-indigo-700">コミット {fmtCommit(it)}</div>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** ③④ 目標に対する達成率と残数。マネージャー以上は、チームと個人をそれぞれ表示 */
function ProgressCard({ title, note, personal, team, teamName, teamSize }: { title: string; note: string; personal: MyPageProgress; team?: MyPageProgress; teamName: string | null; teamSize: number | null }) {
  return (
    <Card title={title}>
      <p className="mb-3 text-xs text-slate-500">{note}</p>
      <div className={team ? "grid gap-6 xl:grid-cols-2" : ""}>
        {team && <ProgressTable heading={`チーム（${teamName}・${teamSize}人）`} progress={team} />}
        <ProgressTable heading={team ? "個人（自分）" : undefined} progress={personal} />
      </div>
    </Card>
  );
}

function ProgressTable({ heading, progress }: { heading?: string; progress: MyPageProgress }) {
  return (
    <div>
      {heading && <h3 className="mb-2 text-sm font-medium text-slate-700">{heading}</h3>}
      <div className="overflow-x-auto rounded-md ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">項目</th>
              <th className="px-3 py-2 text-right font-medium">目標</th>
              <th className="px-3 py-2 text-right font-medium">実績</th>
              <th className="px-3 py-2 text-left font-medium">達成率</th>
              <th className="px-3 py-2 text-right font-medium">残数</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => {
              const { target, actual } = progress[m.key];
              const rate = target > 0 ? (actual / target) * 100 : null;
              return (
                <tr key={m.key} className="border-t border-slate-100">
                  <td className="whitespace-nowrap px-3 py-2">{m.label}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{target > 0 ? m.fmt(target) : <span className="text-slate-400">未設定</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{m.fmt(actual)}</td>
                  <td className="min-w-32 px-3 py-2">
                    {rate == null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full ${rate >= 100 ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${Math.min(100, rate)}%` }} />
                        </div>
                        <span className="w-14 text-right text-xs tabular-nums text-slate-700">{rate.toFixed(1)}%</span>
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{target > 0 ? m.fmt(Math.max(0, target - actual)) : <span className="text-slate-400">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- 2ページ：自己分析 ----------
function Analysis() {
  const [scope, setScope] = useState<"closed" | "user">("closed");
  const { data, error, loading, reload } = useApi(() => unwrap(api.mypage.analysis.$get({ query: { scope } })), [scope]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="対象の案件" className="inline-flex rounded-lg bg-slate-100 p-0.5 text-sm">
          {(
            [
              ["closed", "自己クローズ"],
              ["user", "自己ユーザー"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={scope === k}
              onClick={() => setScope(k)}
              className={`rounded-md px-4 py-1.5 font-medium ${scope === k ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500">
          {scope === "closed" ? "営業担当に自分の名前が入っている案件だけ" : "営業担当・台数担当のどちらか（両方でも）に自分の名前が入っている案件すべて"}
        </span>
      </div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : !data || (loading && !data) ? <Loading /> : <AnalysisBody data={data} />}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-inset ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function AnalysisBody({ data }: { data: MyAnalysis }) {
  const s = data.summary;
  if (s.orders === 0)
    return (
      <Card>
        <Empty>{data.scope === "closed" ? "営業担当が自分の契約情報がまだありません" : "営業担当・台数担当が自分の契約情報がまだありません"}</Empty>
      </Card>
    );
  const productSlices = topSlices(data.products.map((p) => ({ label: p.name, value: p.orders })));
  const industrySlices = topSlices(data.industries.map((i) => ({ label: i.name, value: i.orders })));
  const avgRows = [...data.products].sort((a, b) => (b.avg_gross_profit ?? -1) - (a.avg_gross_profit ?? -1) || a.name.localeCompare(b.name, "ja"));
  return (
    <div className="space-y-4">
      <Card title="全体">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Kpi label="受注件数" value={`${num(s.orders)}件`} sub={`契約 ${num(s.deals)}件`} />
          <Kpi label="1件あたり粗利" value={s.avg_gross_profit == null ? "—" : fmtP(s.avg_gross_profit)} sub="粗利が未入力の契約は除く" />
          <Kpi label="1契約あたり台数" value={dec(s.units_per_deal, "台")} sub="同じ施設・同じ日の契約は1契約" />
          <Kpi label="単月平均粗利" value={s.monthly_gross_profit == null ? "—" : fmtP(s.monthly_gross_profit)} sub={`合計 ${fmtP(s.gross_profit)} ÷ ${s.months}か月`} />
          <Kpi label="単月平均台数" value={dec(s.monthly_units, "台")} sub={`合計 ${num(s.units)}台 ÷ ${s.months}か月`} />
        </div>
        <p className="mt-2 text-xs text-slate-500">単月平均は、最初の契約の月から今月までの月数で割っています（契約のない月も1か月として数えます）。</p>
      </Card>

      <Card title="商材別受注件数">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Donut slices={productSlices} unit="件" centerLabel="受注件数" />
          <HBars rows={data.products.map((p) => ({ key: p.name, label: p.name, value: p.orders, note: `${((p.orders / s.orders) * 100).toFixed(1)}%` }))} valueLabel="受注件数" color="#7c3aed" labelWidth="8rem" />
        </div>
      </Card>

      <Card title="商材別平均粗利">
        <HBars rows={avgRows.map((p) => ({ key: p.name, label: p.name, value: p.avg_gross_profit ?? 0, note: `${num(p.orders)}件` }))} valueLabel="平均粗利（1件あたり）" color="#059669" labelWidth="8rem" format={(n) => fmtP(n)} />
      </Card>

      <Card title="業種別受注件数">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Donut slices={industrySlices} unit="件" centerLabel="受注件数" />
          <HBars rows={data.industries.map((i) => ({ key: i.name, label: i.name, value: i.orders, note: `${((i.orders / s.orders) * 100).toFixed(1)}%` }))} valueLabel="受注件数" color="#d97706" labelWidth="8rem" />
        </div>
      </Card>

      <Card title="単月の粗利・台数">
        <HBars
          rows={[...data.months].reverse().map((m) => ({ key: m.month, label: `${m.month.slice(0, 4)}年${Number(m.month.slice(5))}月`, value: m.gross_profit, note: `${num(m.units)}台・${num(m.orders)}件` }))}
          valueLabel="粗利"
          color="#4f46e5"
          labelWidth="7rem"
          format={(n) => fmtP(n)}
        />
      </Card>
    </div>
  );
}
