import { useState } from "react";
import type { TeleapptGranularity, TeleapptMetrics } from "../types";
import { api, unwrap } from "../lib/api";
import { todayJst } from "../lib/format";
import { useMasters } from "../lib/masters";
import { useApi } from "../lib/useApi";
import { Card, ErrorBox, Loading, selectCls } from "../components/ui";

const GRAN_LABEL: Record<TeleapptGranularity, string> = { day: "日", week: "週", month: "月" };
const GRANS = Object.keys(GRAN_LABEL) as TeleapptGranularity[];

const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const shiftMonth = (iso: string, n: number) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 10);
const md = (iso: string) => `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
const perHour = (n: number | null) => (n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 1 }));

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-inset ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

/** 代表宛・担当宛・宛先未選択の内訳（宛先未選択は、あるときだけ） */
const split = (rep: number, staff: number, unknown: number) => `代表宛 ${rep}件 ／ 担当宛 ${staff}件${unknown ? ` ／ 宛先未選択 ${unknown}件` : ""}`;

/** テレアポ（架電）の集計：日・週・月で、コール数・接触数・スケジューリング数・時間設定件数（代表宛／担当宛）・1時間あたりコール数を見る */
export function Teleappt() {
  const { me, users } = useMasters();
  const [gran, setGran] = useState<TeleapptGranularity>("month");
  const [date, setDate] = useState(todayJst());
  const [who, setWho] = useState("all");
  const isSales = me.role === "sales";
  const members = users.filter((u) => u.is_active);
  const { data, error, loading, reload } = useApi(
    () => unwrap(api.teleappt.$get({ query: { granularity: gran, date, user_id: isSales ? undefined : who } })),
    [gran, date, who],
  );

  const move = (n: number) => setDate(gran === "day" ? addDays(date, n) : gran === "week" ? addDays(date, 7 * n) : shiftMonth(date, n));
  const title = !data
    ? ""
    : gran === "day"
      ? `${data.date_from.slice(0, 4)}年${md(data.date_from)}`
      : gran === "week"
        ? `${data.date_from.slice(0, 4)}年${md(data.date_from)}〜${md(data.date_to)}`
        : `${data.date_from.slice(0, 4)}年${Number(data.date_from.slice(5, 7))}月`;
  const t = data?.totals;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        テレアポ（架電）の集計です。日・週（月曜〜日曜）・月で切り替えられます。スケジューリング数は結果が「初回訪問時間設定」、時間設定件数は結果が「アポ獲得」区分（時間設定が成立したもの）の架電で、それぞれ代表（決裁者）宛・担当宛に分けて数えます。
        {isSales ? "自分の分を表示しています。" : "担当者を選んで見られます（初期は全員）。"}
      </p>
      <Card>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex overflow-hidden rounded-md ring-1 ring-slate-300" role="group" aria-label="集計の期間">
            {GRANS.map((g) => (
              <button key={g} type="button" aria-pressed={gran === g} onClick={() => setGran(g)} className={`px-3 py-1 text-xs ${gran === g ? "bg-indigo-600 font-semibold text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                {GRAN_LABEL[g]}
              </button>
            ))}
          </span>
          <button type="button" className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100" onClick={() => move(-1)} aria-label={`前の${GRAN_LABEL[gran]}`}>
            ‹
          </button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={selectCls} aria-label="集計の基準日" />
          <button type="button" className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100" onClick={() => move(1)} aria-label={`次の${GRAN_LABEL[gran]}`}>
            ›
          </button>
          <button type="button" className="rounded px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50" onClick={() => setDate(todayJst())}>
            今日
          </button>
          {!isSales && (
            <select value={who} onChange={(e) => setWho(e.target.value)} className={selectCls} aria-label="集計する担当者">
              <option value="all">全員</option>
              {members.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )}
          {title && <span className="ml-auto font-semibold text-slate-800">{title}</span>}
        </div>
      </Card>

      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        data &&
        t && (
          <>
            <Card title="テレアポ（架電）">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="コール数" value={`${t.calls}件`} />
                <Stat label="1時間あたりコール数" value={perHour(t.calls_per_hour)} sub={`架電した時間 ${t.active_hours}時間（1件でも架電のあった1時間の区切り）`} />
                <Stat label="代表接触数" value={`${t.rep_contacts}件`} sub="話した相手が決裁者" />
                <Stat label="担当接触数" value={`${t.staff_contacts}件`} sub={`話した相手が決裁者以外${t.no_contact ? `（相手未選択 ${t.no_contact}件）` : ""}`} />
                <Stat label="スケジューリング数" value={`${t.scheduling}件`} sub={split(t.scheduling_rep, t.scheduling_staff, t.scheduling_unknown)} />
                <Stat label="時間設定件数" value={`${t.appointments}件`} sub={split(t.appointments_rep, t.appointments_staff, t.appointments_unknown)} />
              </div>
            </Card>
            <Card title={gran === "day" ? "時間帯ごと" : "日ごと"}>
              <BreakdownTable rows={data.rows} unit={gran === "day" ? "時間帯" : "日"} />
            </Card>
          </>
        )
      )}
    </div>
  );
}

function BreakdownTable({ rows, unit }: { rows: (TeleapptMetrics & { key: string; label: string })[]; unit: string }) {
  if (rows.length === 0) return <div className="py-6 text-center text-sm text-slate-400">この期間の架電はありません</div>;
  const head = ["コール数", "1時間あたり", "代表接触", "担当接触", "スケジューリング 代表宛", "スケジューリング 担当宛", "時間設定 代表宛", "時間設定 担当宛"];
  return (
    <div className="overflow-x-auto rounded-md ring-1 ring-slate-200">
      <table className="w-full min-w-[820px] text-sm tabular-nums">
        <thead className="bg-slate-50 text-xs text-slate-600">
          <tr>
            <th className="px-3 py-2 text-left font-medium">{unit}</th>
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 text-right font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={`border-t border-slate-100 ${r.calls === 0 ? "text-slate-300" : "text-slate-800"}`}>
              <td className="whitespace-nowrap px-3 py-1.5">{r.label}</td>
              <td className="px-3 py-1.5 text-right">{r.calls}</td>
              <td className="px-3 py-1.5 text-right">{perHour(r.calls_per_hour)}</td>
              <td className="px-3 py-1.5 text-right">{r.rep_contacts}</td>
              <td className="px-3 py-1.5 text-right">{r.staff_contacts}</td>
              <td className="px-3 py-1.5 text-right">{r.scheduling_rep}</td>
              <td className="px-3 py-1.5 text-right">{r.scheduling_staff}</td>
              <td className="px-3 py-1.5 text-right">{r.appointments_rep}</td>
              <td className="px-3 py-1.5 text-right">{r.appointments_staff}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
