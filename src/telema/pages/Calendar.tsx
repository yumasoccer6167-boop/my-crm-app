import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { AgendaItem, AgendaKind, CalendarData, CalendarDay } from "../types";
import { api, unwrap } from "../lib/api";
import { todayJst } from "../lib/format";
import { useMasters } from "../lib/masters";
import { useApi } from "../lib/useApi";
import { Button, Card, Empty, ErrorBox, Loading, selectCls } from "../components/ui";

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
const KIND_STYLE: Record<AgendaKind, string> = {
  first_visit: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  visit: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  followup: "bg-amber-50 text-amber-900 ring-amber-200",
  precheck: "bg-sky-50 text-sky-800 ring-sky-200",
};
const KIND_LABEL: Record<AgendaKind, string> = { first_visit: "初回訪問予定", visit: "営業予定", followup: "営業フォロー", precheck: "訪問前連絡" };
const KINDS = Object.keys(KIND_LABEL) as AgendaKind[];

const hm = (iso: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const dayOf = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 10);
const shiftMonth = (month: string, n: number) => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const addDays = (day: string, n: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const weekStart = (day: string) => addDays(day, -new Date(`${day}T00:00:00Z`).getUTCDay());
const md = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;

type View = "month" | "week" | "day";
const VIEW_LABEL: Record<View, string> = { month: "月", week: "週", day: "日" };
const VIEWS = Object.keys(VIEW_LABEL) as View[];
const KIND_OFF = "bg-white text-slate-400 ring-slate-200 line-through";
const jaDay = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日（${WEEK[new Date(`${day}T00:00:00Z`).getUTCDay()]}）`;

function Chip({ item }: { item: AgendaItem }) {
  return (
    <div className={`truncate rounded px-1 py-0.5 text-[11px] leading-tight ring-1 ring-inset ${KIND_STYLE[item.kind]} ${item.done ? "opacity-50 line-through" : ""}`} title={`${item.label} ${item.company_name}`}>
      <span className="tabular-nums">{hm(item.at)}</span> {item.company_name}
    </div>
  );
}

/** カレンダー：訪問予定・初回訪問予定などを、記録から自動で表示する。日ごとに稼働日／休みを設定できる（数値分析の残り稼働日に使う） */
export function Calendar() {
  const { me, users } = useMasters();
  const today = todayJst();
  const [params, setParams] = useSearchParams();
  const initMonth = params.get("month") ?? today.slice(0, 7);
  const [who, setWho] = useState(params.get("user_id") ?? String(me.id));
  const [selected, setSelected] = useState(today.startsWith(initMonth) ? today : `${initMonth}-01`);
  const [view, setView] = useState<View>("month");
  const [shown, setShown] = useState<AgendaKind[]>(KINDS);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const isSales = me.role === "sales";
  const members = users.filter((u) => u.is_active);
  const month = selected.slice(0, 7);
  const first = view === "week" ? weekStart(selected) : selected;
  const last = view === "week" ? addDays(first, 6) : selected;
  // 表示する範囲（月＝その月、週＝日〜土、日＝その日）。週が月をまたぐときは両方の月を取る
  const months = view === "month" ? [month] : [...new Set([first.slice(0, 7), last.slice(0, 7)])];
  const { data, error, loading, reload } = useApi<CalendarData>(async () => {
    const rs = await Promise.all(months.map((m) => unwrap(api.calendar.$get({ query: { month: m, user_id: isSales ? undefined : who } }))));
    const head = rs[0]!;
    return { month: head.month, user_id: head.user_id, days: rs.flatMap((r) => r.days), items: rs.flatMap((r) => r.items) };
  }, [months.join(), who]);

  const go = (day: string) => {
    setSelected(day);
    setParams({}, { replace: true });
  };
  const move = (n: number) => {
    if (view === "month") {
      const m = shiftMonth(month, n);
      go(today.startsWith(m) ? today : `${m}-01`);
    } else go(addDays(selected, view === "week" ? 7 * n : n));
  };
  const toggleKind = (k: AgendaKind) => setShown((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : KINDS.filter((x) => x === k || cur.includes(x))));

  const dayInfo = new Map<string, CalendarDay>((data?.days ?? []).map((d) => [d.day, d]));
  const byDay = new Map<string, AgendaItem[]>();
  for (const i of data?.items ?? []) {
    if (!shown.includes(i.kind)) continue;
    const k = dayOf(i.at);
    byDay.set(k, [...(byDay.get(k) ?? []), i]);
  }
  const lead = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);

  const owner = data?.user_id ?? null;
  const canSet = owner != null && (me.role === "admin" || owner === me.id);
  const sel = dayInfo.get(selected);
  const isWork = (d: string) => dayInfo.get(d)?.is_workday ?? (owner == null && ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));

  async function setWorkday(value: boolean | null) {
    if (owner == null) return;
    setBusy(true);
    setMessage(null);
    try {
      await unwrap(api.workdays[":user_id"][":day"].$put({ param: { user_id: String(owner), day: selected }, json: { is_workday: value } }));
      await reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const items = byDay.get(selected) ?? [];
  const workdayCount = (data?.days ?? []).filter((d) => d.is_workday && d.day >= (view === "month" ? `${month}-01` : first) && d.day <= (view === "month" ? `${month}-31` : last)).length;
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(first, i));
  const title = view === "month" ? `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月` : view === "week" ? `${first.slice(0, 4)}年${md(first)}〜${md(last)}` : `${selected.slice(0, 4)}年${jaDay(selected)}`;
  const unit = { month: "月", week: "週", day: "日" }[view];
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        予定は、カルテに入れた日時から自動で出ます（初回訪問予定・営業予定・営業フォロー・訪問前連絡）。再コールは「再コール」ページで見られます。日を選ぶと、稼働日／休みを設定できます（数値分析の残り稼働日に使います）。訪問の時間帯（訪問の日時から60分）には、再コールを入れられません。
      </p>
      <Card
        title={
          <span className="flex items-center gap-2">
            <button type="button" className="rounded px-2 py-0.5 text-slate-600 hover:bg-slate-100" onClick={() => move(-1)} aria-label={`前の${unit}`}>
              ‹
            </button>
            <span className="tabular-nums">{title}</span>
            <button type="button" className="rounded px-2 py-0.5 text-slate-600 hover:bg-slate-100" onClick={() => move(1)} aria-label={`次の${unit}`}>
              ›
            </button>
            <button type="button" className="rounded px-2 py-0.5 text-xs font-normal text-indigo-700 hover:bg-indigo-50" onClick={() => go(today)}>
              今日
            </button>
          </span>
        }
        action={
          <span className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-flex overflow-hidden rounded-md ring-1 ring-slate-300" role="group" aria-label="表示の切り替え">
              {VIEWS.map((v) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`px-2.5 py-1 text-xs ${view === v ? "bg-indigo-600 font-semibold text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                  {VIEW_LABEL[v]}
                </button>
              ))}
            </span>
            {data && owner != null && view !== "day" && <span className="tabular-nums">稼働日 {workdayCount}日</span>}
            {!isSales && (
              <select value={who} onChange={(e) => setWho(e.target.value)} className={selectCls} aria-label="予定を見る担当者">
                <option value="all">全員</option>
                {members.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            )}
          </span>
        }
      >
        {error ? (
          <ErrorBox message={error} onRetry={reload} />
        ) : loading && !data ? (
          <Loading />
        ) : (
          <>
            <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
              <span className="py-0.5 text-slate-500">表示する予定：</span>
              {KINDS.map((k) => (
                <button key={k} type="button" aria-pressed={shown.includes(k)} onClick={() => toggleKind(k)} className={`rounded px-1.5 py-0.5 ring-1 ring-inset ${shown.includes(k) ? KIND_STYLE[k] : KIND_OFF}`}>
                  {KIND_LABEL[k]}
                </button>
              ))}
              {shown.length < KINDS.length && (
                <button type="button" className="rounded px-1.5 py-0.5 text-indigo-700 hover:bg-indigo-50" onClick={() => setShown(KINDS)}>
                  すべて表示
                </button>
              )}
              <span className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-600">休み</span>
            </div>
            {view === "week" && (
              <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md bg-slate-200 ring-1 ring-slate-200">
                {weekDays.map((day, i) => {
                  const list = byDay.get(day) ?? [];
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setSelected(day)}
                      className={`min-h-40 p-1 text-left align-top hover:bg-indigo-50/40 ${isWork(day) ? "bg-white" : "bg-slate-100"} ${selected === day ? "outline outline-2 -outline-offset-2 outline-indigo-500" : ""}`}
                      aria-label={`${jaDay(day)}${isWork(day) ? "" : "（休み）"} ${list.length}件`}
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <span className={`text-xs ${i === 0 ? "text-rose-600" : i === 6 ? "text-sky-600" : "text-slate-600"}`}>
                          <span className={`tabular-nums ${day === today ? "rounded-full bg-indigo-600 px-1.5 font-semibold text-white" : ""}`}>{Number(day.slice(8, 10))}</span> {WEEK[i]}
                        </span>
                        {!isWork(day) && <span className="rounded bg-slate-200 px-1 text-[10px] text-slate-600">休</span>}
                      </div>
                      <div className="space-y-0.5">
                        {list.map((it) => (
                          <Chip key={`${it.kind}${it.id}`} item={it} />
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {view === "day" && <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">この日の予定は、下の一覧に時間順で出ます。‹ › で前後の日に移れます。</p>}
            {view === "month" && (
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md bg-slate-200 ring-1 ring-slate-200">
              {WEEK.map((w, i) => (
                <div key={w} className={`bg-slate-50 py-1 text-center text-xs font-medium ${i === 0 ? "text-rose-600" : i === 6 ? "text-sky-600" : "text-slate-500"}`}>
                  {w}
                </div>
              ))}
              {cells.map((day, idx) =>
                day == null ? (
                  <div key={`b${idx}`} className="min-h-20 bg-slate-50/60" />
                ) : (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setSelected(day)}
                    className={`min-h-20 p-1 text-left align-top hover:bg-indigo-50/40 ${isWork(day) ? "bg-white" : "bg-slate-100"} ${selected === day ? "outline outline-2 -outline-offset-2 outline-indigo-500" : ""}`}
                    aria-label={`${jaDay(day)}${isWork(day) ? "" : "（休み）"} ${byDay.get(day)?.length ?? 0}件`}
                  >
                    <div className="mb-0.5 flex items-center justify-between">
                      <span className={`text-xs tabular-nums ${day === today ? "rounded-full bg-indigo-600 px-1.5 font-semibold text-white" : "text-slate-700"}`}>{Number(day.slice(8, 10))}</span>
                      {!isWork(day) && <span className="rounded bg-slate-200 px-1 text-[10px] text-slate-600">休</span>}
                    </div>
                    <div className="space-y-0.5">
                      {(byDay.get(day) ?? []).slice(0, 3).map((i) => (
                        <Chip key={`${i.kind}${i.id}`} item={i} />
                      ))}
                      {(byDay.get(day)?.length ?? 0) > 3 && <div className="text-[11px] text-slate-500">ほか{(byDay.get(day)?.length ?? 0) - 3}件</div>}
                    </div>
                  </button>
                ),
              )}
            </div>
            )}
          </>
        )}
      </Card>

      <Card
        title={jaDay(selected)}
        action={
          <span className="flex flex-wrap items-center gap-2">
            {sel && (
              <span className={`rounded px-1.5 py-0.5 text-xs ${sel.is_workday ? "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200" : "bg-slate-200 text-slate-600"}`}>
                {sel.is_workday ? "稼働日" : "休み"}
                {sel.custom && "（設定済み）"}
              </span>
            )}
            {canSet && sel && (
              <>
                <Button size="sm" disabled={busy} onClick={() => setWorkday(!sel.is_workday)}>
                  {sel.is_workday ? "休みにする" : "稼働日にする"}
                </Button>
                {sel.custom && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setWorkday(null)}>
                    平日の設定に戻す
                  </Button>
                )}
              </>
            )}
          </span>
        }
      >
        {message && <div className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">{message}</div>}
        {items.length === 0 ? (
          <Empty>この日の予定はありません</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((i) => (
              <li key={`${i.kind}${i.id}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm">
                <span className="w-12 font-semibold tabular-nums text-slate-900">{hm(i.at)}</span>
                <span className={`rounded px-1.5 text-[11px] ring-1 ring-inset ${KIND_STYLE[i.kind]}`}>
                  {i.label}
                  {i.detail ? `（${i.detail}）` : ""}
                </span>
                <Link to={`/companies/${i.company_id}`} className="font-medium text-indigo-700 hover:underline">
                  {i.company_name}
                </Link>
                {i.user_name && owner == null && <span className="text-xs text-slate-500">{i.user_name}</span>}
                {i.done && <span className="text-xs text-slate-400">対応済み</span>}
                {i.note && <span className="min-w-0 truncate text-xs text-slate-500">{i.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
