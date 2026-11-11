import { useState } from "react";
import { Link } from "react-router";
import type { FirstResult, SalesResult, SalesResultItem, SalesScoreRow } from "../types";
import { api, unwrap } from "../lib/api";
import { fmtDateTime, todayJst } from "../lib/format";
import { useMasters } from "../lib/masters";
import { fmtP } from "../lib/points";
import { FIRST_RESULTS, firstResultLabel, paymentParts, SALES_RESULTS, salesResultLabel } from "../lib/record-kind";
import { useApi } from "../lib/useApi";
import { Card, Empty, ErrorBox, Loading, selectCls } from "../components/ui";

type Tab = "sales" | "first" | "scorecard";
const TABS: { value: Tab; label: string }[] = [
  { value: "sales", label: "営業結果管理" },
  { value: "first", label: "初回訪問結果管理" },
  { value: "scorecard", label: "営業成績表" },
];

const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const prevMonth = (iso: string) => {
  const prevEnd = addDays(monthStart(iso), -1);
  return { from: monthStart(prevEnd), to: prevEnd };
};
const yen = (n: number | null) => (n == null ? "—" : `${n.toLocaleString()}円`);
const rate = (num: number, den: number) => (den === 0 ? "0.0%" : `${((num / den) * 100).toFixed(1)}%`);

const RESULT_BADGE: Record<SalesResult, string> = {
  won: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  waiting: "bg-amber-50 text-amber-800 ring-amber-200",
  ng: "bg-rose-50 text-rose-800 ring-rose-200",
  resales: "bg-indigo-50 text-indigo-800 ring-indigo-200",
};

/** 営業結果：訪問記録を登録すると、営業結果管理・初回訪問結果管理・営業成績表に自動で反映される（ここでは登録しない） */
export function SalesResults() {
  const { me, users } = useMasters();
  const today = todayJst();
  const [tab, setTab] = useState<Tab>("sales");
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [userId, setUserId] = useState("");
  const [result, setResult] = useState<string>("");

  const setRange = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
  };
  const common = { date_from: from, date_to: to, user_id: me.role === "sales" ? undefined : userId || undefined };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        訪問記録を登録すると、自動でここに反映されます。{me.role === "sales" ? "自分の記録だけを表示しています。" : "全員分を表示しています。"}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={tab === t.value}
            onClick={() => {
              setTab(t.value);
              setResult("");
            }}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ring-1 ring-inset ${tab === t.value ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-slate-500">期間</span>
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={selectCls} aria-label="期間の始まり" />
          <span className="text-slate-400">〜</span>
          <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className={selectCls} aria-label="期間の終わり" />
          {([
            ["今月", monthStart(today), today],
            ["先月", prevMonth(today).from, prevMonth(today).to],
            ["直近30日", addDays(today, -29), today],
          ] as [string, string, string][]).map(([label, f, t]) => (
            <button key={label} type="button" className="rounded px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50" onClick={() => setRange(f, t)}>
              {label}
            </button>
          ))}
          {me.role !== "sales" && (
            <>
              <span className="ml-2 text-xs text-slate-500">担当者</span>
              <select value={userId} onChange={(e) => setUserId(e.target.value)} className={selectCls} aria-label="担当者">
                <option value="">全員</option>
                {users.filter((u) => u.is_active).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        {tab !== "scorecard" && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-slate-500">結果</span>
            {([["", "すべて"], ...(tab === "sales" ? SALES_RESULTS : FIRST_RESULTS).map((r) => [r.value, r.label]), ["none", "結果なし"]] as [string, string][]).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={result === v}
                onClick={() => setResult(v)}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${result === v ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </Card>

      {tab === "scorecard" ? <Scorecard query={common} /> : <ResultList key={tab} kind={tab} query={{ ...common, result: result || undefined }} />}
    </div>
  );
}

function ResultList({ kind, query }: { kind: "sales" | "first"; query: { date_from: string; date_to: string; user_id?: string; result?: string } }) {
  const { data, error, loading, reload } = useApi(() => unwrap(api["sales-results"].$get({ query: { kind, ...query } })), [kind, query.date_from, query.date_to, query.user_id, query.result]);
  const items = data?.items ?? [];
  const isSales = kind === "sales";
  return (
    <Card title={`${isSales ? "営業結果管理" : "初回訪問結果管理"}${data ? `（${items.length}${data.truncated ? "件以上" : "件"}）` : ""}`}>
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty>この期間・条件に当てはまる記録がありません</Empty>
      ) : (
        <>
          {data?.truncated && <p className="mb-2 text-xs text-amber-700">新しい順に一部だけ表示しています。期間や担当者を絞り込んでください。</p>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-2 py-2 font-medium">訪問日時</th>
                  <th className="px-2 py-2 font-medium">施設</th>
                  <th className="px-2 py-2 font-medium">担当</th>
                  {isSales ? (
                    <>
                      <th className="px-2 py-2 font-medium">商材</th>
                      <th className="px-2 py-2 font-medium">結果</th>
                      <th className="px-2 py-2 text-right font-medium">受注金額</th>
                      <th className="px-2 py-2 text-right font-medium">粗利</th>
                      <th className="px-2 py-2 text-right font-medium">台数</th>
                    </>
                  ) : (
                    <>
                      <th className="px-2 py-2 font-medium">結果</th>
                      <th className="px-2 py-2 font-medium">その後</th>
                    </>
                  )}
                  <th className="px-2 py-2 font-medium">メモ</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 align-top">
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-700">{fmtDateTime(r.called_at)}</td>
                    <td className="px-2 py-2">
                      <Link to={`/companies/${r.company_id}`} className="font-medium text-indigo-700 hover:underline">
                        {r.company_name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-700">{r.user_name ?? "—"}</td>
                    {isSales ? <SalesCells r={r} /> : <FirstCell r={r} />}
                    <td className="max-w-xs px-2 py-2 text-xs text-slate-600">
                      <span className="line-clamp-2 whitespace-pre-wrap">{r.raw_note}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function SalesCells({ r }: { r: SalesResultItem }) {
  const reply = r.record_type === "reply";
  return (
    <>
      <td className="px-2 py-2 text-slate-700">
        {r.sales_product ?? "—"}
        {paymentParts({ productMonthly: r.sales_product_monthly, productTerm: r.sales_product_term, serverMonthly: r.sales_server_monthly, serverTerm: r.sales_server_term, cashback: r.sales_cashback }).map((t) => (
          <div key={t} className="text-xs text-slate-400">
            {t}
          </div>
        ))}
      </td>
      <td className="whitespace-nowrap px-2 py-2">
        {r.sales_result ? (
          <>
            {reply && <span className="mr-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800 ring-1 ring-inset ring-amber-200">返事待ち対応</span>}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${RESULT_BADGE[r.sales_result]}`}>{salesResultLabel(r.sales_result, reply)}</span>
            {r.sales_followup_at && <div className="mt-0.5 text-xs text-slate-500">{fmtDateTime(r.sales_followup_at)}</div>}
            {r.sales_result === "waiting" && r.replied_result && <div className="mt-0.5 text-xs text-amber-700">→ 対応済み（{salesResultLabel(r.replied_result, true)}）</div>}
          </>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{yen(r.sales_amount)}</td>
      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{fmtP(r.sales_gross_profit)}</td>
      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{r.sales_units ?? "—"}</td>
    </>
  );
}

const FIRST_BADGE: Record<FirstResult, string> = {
  scheduled: "bg-sky-50 text-sky-800 ring-sky-200",
  no_prospect: "bg-slate-100 text-slate-700 ring-slate-300",
};

function FirstCell({ r }: { r: SalesResultItem }) {
  return (
    <>
      <td className="whitespace-nowrap px-2 py-2">
        {r.first_result ? (
          <>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${FIRST_BADGE[r.first_result]}`}>{firstResultLabel(r.first_result)}</span>
            {r.first_followup_at && <div className="mt-0.5 text-xs text-slate-500">営業 {fmtDateTime(r.first_followup_at)}</div>}
          </>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
    <td className="whitespace-nowrap px-2 py-2">
      {r.later_won ? (
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">受注済み（営業{r.later_sales_visits}回）</span>
      ) : r.later_sales_visits > 0 ? (
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-800 ring-1 ring-inset ring-indigo-200">営業{r.later_sales_visits}回</span>
      ) : (
        <span className="text-xs text-slate-400">まだ営業なし</span>
      )}
    </td>
    </>
  );
}

function Scorecard({ query }: { query: { date_from: string; date_to: string; user_id?: string } }) {
  const { data, error, loading, reload } = useApi(() => unwrap(api["sales-scorecard"].$get({ query })), [query.date_from, query.date_to, query.user_id]);
  const rows = data?.items ?? [];
  const total = rows.reduce<SalesScoreRow>(
    (t, r) => ({
      ...t,
      first_visits: t.first_visits + r.first_visits,
      user_visits: t.user_visits + r.user_visits,
      sales_visits: t.sales_visits + r.sales_visits,
      reply_won: t.reply_won + r.reply_won,
      reply_ng: t.reply_ng + r.reply_ng,
      reply_resales: t.reply_resales + r.reply_resales,
      first_scheduled: t.first_scheduled + r.first_scheduled,
      first_no_prospect: t.first_no_prospect + r.first_no_prospect,
      won: t.won + r.won,
      waiting: t.waiting + r.waiting,
      ng: t.ng + r.ng,
      resales: t.resales + r.resales,
      amount: t.amount + r.amount,
      gross_profit: t.gross_profit + r.gross_profit,
      units: t.units + r.units,
    }),
    { user_id: null, user_name: "合計", first_visits: 0, user_visits: 0, sales_visits: 0, reply_won: 0, reply_ng: 0, reply_resales: 0, first_scheduled: 0, first_no_prospect: 0, won: 0, waiting: 0, ng: 0, resales: 0, amount: 0, gross_profit: 0, units: 0 },
  );
  const cols: { label: string; get: (r: SalesScoreRow) => string }[] = [
    { label: "初回訪問", get: (r) => String(r.first_visits) },
    { label: "ユーザー訪問", get: (r) => String(r.user_visits) },
    { label: "営業時間設定", get: (r) => String(r.first_scheduled) },
    { label: "見込みなし", get: (r) => String(r.first_no_prospect) },
    { label: "営業", get: (r) => String(r.sales_visits) },
    { label: "即決受注", get: (r) => String(r.won) },
    { label: "返事待ち", get: (r) => String(r.waiting) },
    { label: "返事待ち後の受注", get: (r) => String(r.reply_won) },
    { label: "NG", get: (r) => String(r.ng + r.reply_ng) },
    { label: "再営業", get: (r) => String(r.resales + r.reply_resales) },
    { label: "受注率", get: (r) => rate(r.won + r.reply_won, r.sales_visits) },
    { label: "受注金額", get: (r) => yen(r.amount) },
    { label: "粗利", get: (r) => fmtP(r.gross_profit) },
    { label: "台数", get: (r) => String(r.units) },
  ];
  return (
    <Card title="営業成績表（営業担当ごと）">
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>この期間・条件に当てはまる記録がありません</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[72rem] text-right text-sm">
            <thead className="text-xs text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="px-2 py-2 text-left font-medium">担当</th>
                {cols.map((c) => (
                  <th key={c.label} className="whitespace-nowrap px-2 py-2 font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...rows, total].map((r, i) => (
                <tr key={r.user_id ?? `x${i}`} className={`border-b border-slate-100 tabular-nums ${i === rows.length ? "bg-slate-50 font-semibold" : ""}`}>
                  <td className="whitespace-nowrap px-2 py-2 text-left">{r.user_name}</td>
                  {cols.map((c) => (
                    <td key={c.label} className="whitespace-nowrap px-2 py-2">
                      {c.get(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-left text-xs text-slate-400">受注率＝（即決受注＋返事待ち後の受注）÷ 営業の件数。NG・再営業は、返事待ち対応の結果も含みます。受注金額・粗利・台数は、受注の記録の合計です。</p>
        </div>
      )}
    </Card>
  );
}
