import { useState } from "react";
import type { RegionAnalysisData, RegionAreaRow } from "../types";
import { api, unwrap } from "../lib/api";
import { todayJst } from "../lib/format";
import { fmtP } from "../lib/points";
import { useApi } from "../lib/useApi";
import { Button, Card, Empty, ErrorBox, Loading, selectCls } from "../components/ui";

const num = (n: number) => n.toLocaleString();
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const ROW_LIMIT = 30;

const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const prevMonth = (iso: string) => {
  const d = new Date(`${monthStart(iso)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  const from = d.toISOString().slice(0, 10);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return { from, to: last };
};

/** 割合の棒つきの数字 */
function Bar({ ratio, tone = "bg-indigo-400" }: { ratio: number; tone?: string }) {
  return (
    <span className="inline-block h-1.5 w-16 rounded-full bg-slate-100 align-middle">
      <span className={`block h-1.5 rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }} />
    </span>
  );
}

const th = "whitespace-nowrap px-3 py-2 text-right font-medium";
const td = "px-3 py-1.5 text-right tabular-nums";

/** 地域分析：都道府県・市区町村・業種で絞り込んで、業種別の事業所数・地域別の営業活動・地域別のリスト状況（未開拓エリア）を見る。担当に関係なく全体の数 */
export function RegionAnalysis() {
  const today = todayJst();
  const [pref, setPref] = useState("");
  const [city, setCity] = useState("");
  const [industry, setIndustry] = useState("");
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const { data, error, loading, reload } = useApi(
    () => unwrap(api["region-analysis"].$get({ query: { prefecture: pref, city, industry, from, to } })),
    [pref, city, industry, from, to],
  );

  const area = [pref, city].filter(Boolean).join(" ") || "全国";
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        都道府県・市区町村・業種で絞り込んで、登録施設の業種別の数、地域ごとの営業活動、リストの状況（未開拓エリア）を見られます。担当に関係なく全体の数です。
      </p>
      <Card title="絞り込み">
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="block">
            <div className="mb-1 text-xs text-slate-500">都道府県</div>
            <select
              value={pref}
              onChange={(e) => {
                setPref(e.target.value);
                setCity("");
              }}
              className={selectCls}
              aria-label="都道府県"
            >
              <option value="">すべて</option>
              {(data?.options.prefectures ?? []).map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}（{num(p.total)}）
                </option>
              ))}
              {pref && !data?.options.prefectures.some((p) => p.name === pref) && <option value={pref}>{pref}</option>}
            </select>
          </label>
          <label className="block">
            <div className="mb-1 text-xs text-slate-500">市区町村</div>
            <select value={city} onChange={(e) => setCity(e.target.value)} disabled={!pref} className={selectCls} aria-label="市区町村">
              <option value="">{pref ? "すべて" : "都道府県を選んでください"}</option>
              {(data?.options.cities ?? []).map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}（{num(c.total)}）
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <div className="mb-1 text-xs text-slate-500">業種</div>
            <select value={industry} onChange={(e) => setIndustry(e.target.value)} className={`${selectCls} max-w-xs`} aria-label="業種">
              <option value="">すべて</option>
              {(data?.industries ?? []).map((i) => (
                <option key={i.industry} value={i.industry}>
                  {i.industry}（{num(i.total)}）
                </option>
              ))}
              {industry && !data?.industries.some((i) => i.industry === industry) && <option value={industry}>{industry}</option>}
            </select>
          </label>
          <div className="block">
            <div className="mb-1 text-xs text-slate-500">営業活動の期間</div>
            <div className="flex items-center gap-1.5">
              <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className={selectCls} aria-label="期間の開始日" />
              <span className="text-slate-400">〜</span>
              <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} className={selectCls} aria-label="期間の終了日" />
            </div>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => (setFrom(monthStart(today)), setTo(today))}>
              今月
            </Button>
            <Button size="sm" onClick={() => (setFrom(prevMonth(today).from), setTo(prevMonth(today).to))}>
              先月
            </Button>
            <Button size="sm" onClick={() => (setFrom("2000-01-01"), setTo(today))}>
              全期間
            </Button>
          </div>
          {(pref || city || industry) && (
            <Button
              size="sm"
              onClick={() => {
                setPref("");
                setCity("");
                setIndustry("");
              }}
            >
              絞り込みを外す
            </Button>
          )}
        </div>
      </Card>
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : !data || (loading && !data) ? (
        <Loading />
      ) : (
        <div className={loading ? "space-y-4 opacity-60" : "space-y-4"}>
          <Industries data={data} area={area} />
          <Activity data={data} onPick={(name) => (data.level === "prefecture" ? (setPref(name), setCity("")) : setCity(name))} />
          <Listing data={data} onPick={(name) => (data.level === "prefecture" ? (setPref(name), setCity("")) : setCity(name))} />
        </div>
      )}
    </div>
  );
}

/** ① 業種別の事業所数（地域だけで絞る。業種の絞り込みでは減らさない） */
function Industries({ data, area }: { data: RegionAnalysisData; area: string }) {
  const total = data.industries.reduce((s, r) => s + r.total, 0);
  const called = data.industries.reduce((s, r) => s + r.called, 0);
  const users = data.industries.reduce((s, r) => s + r.users, 0);
  const max = Math.max(1, ...data.industries.map((r) => r.total));
  return (
    <Card title={`① ${area}の業種別の事業所数`}>
      {data.industries.length === 0 ? (
        <Empty>この地域に登録された施設はありません</Empty>
      ) : (
        <div className="overflow-x-auto rounded-md ring-1 ring-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">業種</th>
                <th className={th}>事業所数</th>
                <th className={th}>割合</th>
                <th className={th}>架電済み</th>
                <th className={th}>架電済み率</th>
                <th className={th}>ユーザー</th>
                <th className={th}>ユーザー化率</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.industries.map((r) => (
                <tr key={r.industry}>
                  <td className="px-3 py-1.5">{r.industry}</td>
                  <td className={td}>
                    <Bar ratio={r.total / max} /> <span className="ml-1 font-medium">{num(r.total)}</span>
                  </td>
                  <td className={td}>{pct(r.total, total)}</td>
                  <td className={td}>{num(r.called)}</td>
                  <td className={td}>{pct(r.called, r.total)}</td>
                  <td className={td}>{num(r.users)}</td>
                  <td className={td}>{pct(r.users, r.total)}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-medium">
                <td className="px-3 py-1.5">合計</td>
                <td className={td}>{num(total)}</td>
                <td className={td}>100%</td>
                <td className={td}>{num(called)}</td>
                <td className={td}>{pct(called, total)}</td>
                <td className={td}>{num(users)}</td>
                <td className={td}>{pct(users, total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const levelLabel = (d: RegionAnalysisData) => (d.level === "prefecture" ? "都道府県" : "市区町村");
const filterNote = (d: RegionAnalysisData) => (d.filters.industry ? `（業種：${d.filters.industry}）` : "");

function AreaName({ name, onPick }: { name: string; onPick: (n: string) => void }) {
  return name === "不明" ? (
    <span className="text-slate-400">{name}</span>
  ) : (
    <button type="button" onClick={() => onPick(name)} className="text-indigo-700 hover:underline">
      {name}
    </button>
  );
}

/** 表の行数が多いときは、先頭だけ出す */
function useLimit(rows: RegionAreaRow[]) {
  const [all, setAll] = useState(false);
  return { shown: all ? rows : rows.slice(0, ROW_LIMIT), more: rows.length > ROW_LIMIT, all, toggle: () => setAll((v) => !v), count: rows.length };
}

/** ② 地域別の営業活動（期間内） */
function Activity({ data, onPick }: { data: RegionAnalysisData; onPick: (n: string) => void }) {
  const rows = [...data.areas].sort((a, b) => b.calls - a.calls || b.contracts - a.contracts || b.total - a.total);
  const lim = useLimit(rows);
  const t = data.totals;
  return (
    <Card title={`② ${levelLabel(data)}別の営業活動${filterNote(data)}`}>
      <p className="mb-3 text-xs text-slate-500">
        {data.from}〜{data.to} の数です。時間設定件数は結果が「時間設定成立」の架電、初回訪問・営業は訪問記録の内容、受注・粗利・台数は契約情報の契約日で数えます。地域名を押すと、その地域に絞り込めます。
      </p>
      <div className="overflow-x-auto rounded-md ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{levelLabel(data)}</th>
              <th className={th}>架電数</th>
              <th className={th}>時間設定件数</th>
              <th className={th}>初回訪問</th>
              <th className={th}>営業</th>
              <th className={th}>受注件数</th>
              <th className={th}>粗利</th>
              <th className={th}>台数</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lim.shown.map((r) => (
              <tr key={r.area}>
                <td className="px-3 py-1.5">
                  <AreaName name={r.area} onPick={onPick} />
                </td>
                <td className={td}>{num(r.calls)}</td>
                <td className={td}>{num(r.scheduled)}</td>
                <td className={td}>{num(r.first_visits)}</td>
                <td className={td}>{num(r.sales)}</td>
                <td className={td}>{num(r.contracts)}</td>
                <td className={td}>{fmtP(r.gross_profit)}</td>
                <td className={td}>{num(r.units)}</td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-medium">
              <td className="px-3 py-1.5">合計</td>
              <td className={td}>{num(t.calls)}</td>
              <td className={td}>{num(t.scheduled)}</td>
              <td className={td}>{num(t.first_visits)}</td>
              <td className={td}>{num(t.sales)}</td>
              <td className={td}>{num(t.contracts)}</td>
              <td className={td}>{fmtP(t.gross_profit)}</td>
              <td className={td}>{num(t.units)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {lim.more && (
        <button type="button" onClick={lim.toggle} className="mt-2 text-xs text-indigo-700 hover:underline">
          {lim.all ? "先頭だけ表示する" : `すべて表示する（${num(lim.count)}件）`}
        </button>
      )}
    </Card>
  );
}

type ListSort = "uncalled" | "rate" | "total";

/** ③ 地域別のリスト状況（未開拓エリアを探す） */
function Listing({ data, onPick }: { data: RegionAnalysisData; onPick: (n: string) => void }) {
  const [sort, setSort] = useState<ListSort>("uncalled");
  const rows = [...data.areas].sort((a, b) => {
    const ua = a.total - a.called;
    const ub = b.total - b.called;
    if (sort === "total") return b.total - a.total;
    if (sort === "rate") return (a.called / (a.total || 1)) - (b.called / (b.total || 1)) || b.total - a.total;
    return ub - ua || b.total - a.total;
  });
  const lim = useLimit(rows);
  const t = data.totals;
  return (
    <Card
      title={`③ ${levelLabel(data)}別のリスト状況（未開拓エリア）${filterNote(data)}`}
      action={
        <select value={sort} onChange={(e) => setSort(e.target.value as ListSort)} className={selectCls} aria-label="並び順">
          <option value="uncalled">未架電が多い順</option>
          <option value="rate">架電済み率が低い順</option>
          <option value="total">登録施設が多い順</option>
        </select>
      }
    >
      <p className="mb-3 text-xs text-slate-500">未架電は、まだ一度も架電していない施設です。「未着手」は、登録があるのに1件も架電していない地域です。</p>
      <div className="overflow-x-auto rounded-md ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{levelLabel(data)}</th>
              <th className={th}>登録施設</th>
              <th className={th}>架電済み</th>
              <th className={th}>未架電</th>
              <th className={th}>架電済み率</th>
              <th className={th}>ユーザー</th>
              <th className={th}>ユーザー化率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lim.shown.map((r) => (
              <tr key={r.area}>
                <td className="px-3 py-1.5">
                  <AreaName name={r.area} onPick={onPick} />
                  {r.total > 0 && r.called === 0 && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">未着手</span>}
                </td>
                <td className={td}>{num(r.total)}</td>
                <td className={td}>{num(r.called)}</td>
                <td className={`${td} font-medium`}>{num(r.total - r.called)}</td>
                <td className={td}>
                  <Bar ratio={r.total ? r.called / r.total : 0} tone="bg-emerald-400" /> <span className="ml-1">{pct(r.called, r.total)}</span>
                </td>
                <td className={td}>{num(r.users)}</td>
                <td className={td}>{pct(r.users, r.total)}</td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-medium">
              <td className="px-3 py-1.5">合計</td>
              <td className={td}>{num(t.total)}</td>
              <td className={td}>{num(t.called)}</td>
              <td className={td}>{num(t.total - t.called)}</td>
              <td className={td}>{pct(t.called, t.total)}</td>
              <td className={td}>{num(t.users)}</td>
              <td className={td}>{pct(t.users, t.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {lim.more && (
        <button type="button" onClick={lim.toggle} className="mt-2 text-xs text-indigo-700 hover:underline">
          {lim.all ? "先頭だけ表示する" : `すべて表示する（${num(lim.count)}件）`}
        </button>
      )}
    </Card>
  );
}
