import { useState } from "react";
import type { TeleapptGranularity, TeleapptMetrics } from "../types";
import { api, unwrap } from "../lib/api";
import { todayJst } from "../lib/format";
import { useMasters } from "../lib/masters";
import { useApi } from "../lib/useApi";
import { Card, ErrorBox, Loading, selectCls } from "../components/ui";

const GRANS: TeleapptGranularity[] = ["day", "week", "month"];
const WEEKDAY = "日月火水木金土";

const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const md = (iso: string) => `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
const perHour = (n: number | null) => (n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 1 }));
const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—");

/** 代表宛・担当宛・宛先未選択の内訳（宛先未選択は、あるときだけ） */
const split = (rep: number, staff: number, unknown: number) => `代表宛 ${rep}件 ／ 担当宛 ${staff}件${unknown ? ` ／ 宛先未選択 ${unknown}件` : ""}`;

/** 期間の見出し（日・週・月） */
function periodTitle(g: TeleapptGranularity, from: string, to: string): string {
  if (g === "day") return `日（${md(from)}（${WEEKDAY[new Date(`${from}T00:00:00Z`).getUTCDay()]}））`;
  if (g === "week") return `週（${md(from)}〜${md(to)}）`;
  return `月（${from.slice(0, 4)}年${Number(from.slice(5, 7))}月）`;
}

/** テレアポ（架電）の集計：日・週・月を、それぞれ別の表で縦に並べて見る（マイページの数字の自己認識と同じ表示）。
 *  コール数・コール時間・代表接触数・代表接触率・初回訪問時間設定件数・時間設定件数（代表宛／担当宛の内訳つき） */
export function Teleappt() {
  const { me, users } = useMasters();
  const [date, setDate] = useState(todayJst());
  const [who, setWho] = useState("all");
  const isSales = me.role === "sales";
  const members = users.filter((u) => u.is_active);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        テレアポ（架電）の集計です。選んだ日の「日」、その日を含む「週」（月曜〜日曜）、その日の「月」を、それぞれ別の表で見られます。
        {isSales ? "自分の分を表示しています。" : "担当者を選んで見られます（初期は全員）。"}
      </p>
      <Card>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100" onClick={() => setDate(addDays(date, -1))} aria-label="前の日">
            ‹
          </button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={selectCls} aria-label="集計の基準日" />
          <button type="button" className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100" onClick={() => setDate(addDays(date, 1))} aria-label="次の日">
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
        </div>
      </Card>
      {GRANS.map((g) => (
        <PeriodCard key={g} gran={g} date={date} who={isSales ? undefined : who} />
      ))}
    </div>
  );
}

/** 1つの期間（日・週・月）の集計表 */
function PeriodCard({ gran, date, who }: { gran: TeleapptGranularity; date: string; who: string | undefined }) {
  const { data, error, loading, reload } = useApi(() => unwrap(api.teleappt.$get({ query: { granularity: gran, date, user_id: who } })), [gran, date, who]);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data || (loading && !data)) return <Loading />;
  const t = data.totals;
  const rows: { label: string; value: string; note?: string }[] = [
    { label: "コール数", value: `${t.calls}件` },
    { label: "コール時間", value: `${t.active_hours}時間`, note: "架電が1件でもあった1時間の区切り（9:00〜10:00 など）の数" },
    { label: "1時間あたりコール数", value: perHour(t.calls_per_hour), note: "コール数 ÷ コール時間" },
    { label: "代表接触数", value: `${t.rep_contacts}件`, note: "話した相手が決裁者マークの人" },
    { label: "代表接触率", value: pct(t.rep_contacts, t.calls), note: `代表接触数 ${t.rep_contacts}件 ÷ コール数 ${t.calls}件` },
    { label: "担当接触数", value: `${t.staff_contacts}件`, note: `話した相手が決裁者以外${t.no_contact ? `（相手未選択 ${t.no_contact}件）` : ""}` },
    { label: "初回訪問時間設定件数", value: `${t.scheduling}件`, note: split(t.scheduling_rep, t.scheduling_staff, t.scheduling_unknown) },
    { label: "時間設定件数", value: `${t.appointments}件`, note: split(t.appointments_rep, t.appointments_staff, t.appointments_unknown) },
  ];
  return (
    <Card title={periodTitle(gran, data.date_from, data.date_to)}>
      <div className="overflow-x-auto rounded-md ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">項目</th>
              <th className="px-3 py-2 text-right font-medium">実績</th>
              <th className="px-3 py-2 text-left font-medium">内訳・補足</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-slate-100">
                <td className="whitespace-nowrap px-3 py-2">{r.label}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-base font-semibold tabular-nums text-slate-900">{r.value}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-indigo-700 hover:underline">{gran === "day" ? "時間帯ごとの内訳を見る" : "日ごとの内訳を見る"}</summary>
        <div className="mt-2">
          <BreakdownTable rows={data.rows} unit={gran === "day" ? "時間帯" : "日"} />
        </div>
      </details>
    </Card>
  );
}

function BreakdownTable({ rows, unit }: { rows: (TeleapptMetrics & { key: string; label: string })[]; unit: string }) {
  if (rows.length === 0) return <div className="py-6 text-center text-sm text-slate-400">この期間の架電はありません</div>;
  const head = ["コール数", "1時間あたり", "代表接触", "代表接触率", "担当接触", "初回訪問時間設定 代表宛", "初回訪問時間設定 担当宛", "時間設定 代表宛", "時間設定 担当宛"];
  return (
    <div className="overflow-x-auto rounded-md ring-1 ring-slate-200">
      <table className="w-full min-w-[900px] text-sm tabular-nums">
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
              <td className="px-3 py-1.5 text-right">{pct(r.rep_contacts, r.calls)}</td>
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
