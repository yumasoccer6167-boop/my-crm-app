import { useState } from "react";
import { Link } from "react-router";
import type { ScheduleItem, ScheduleKind } from "../types";
import { api, unwrap } from "../lib/api";
import { fmtShort } from "../lib/format";
import { markScheduleDone, SCHEDULE_LABEL } from "../lib/schedule";
import { useApi } from "../lib/useApi";
import { Button, Card, Empty, ErrorBox } from "./ui";

const KINDS: ScheduleKind[] = ["visit", "precheck", "recall"];

/** マイページの「今日の予定」：訪問予定・訪問前連絡予定・再コールの3つ。対応済みにすると消える（選んでまとめても押せる） */
export function TodaySchedule({ onChanged }: { onChanged?: () => void }) {
  const { data, error, reload } = useApi(() => unwrap(api.schedule.today.$get()), []);
  const [kind, setKind] = useState<ScheduleKind>("visit");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const items: ScheduleItem[] = data?.[kind] ?? [];
  const chosen = items.filter((i) => selected.has(i.id));

  function changeKind(k: ScheduleKind) {
    setKind(k);
    setSelected(new Set());
    setMessage(null);
  }

  async function done(targets: ScheduleItem[]) {
    if (targets.length === 0) return;
    if (targets.length > 1 && !confirm(`${targets.length}件を対応済みにします。表示から消えます。よろしいですか？`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await markScheduleDone(targets.map((t) => ({ kind, id: t.id })));
      if (r.skipped > 0) setMessage(`${r.done}件を対応済みにしました（${r.skipped}件は、担当外などのため変更できませんでした）`);
      setSelected(new Set());
      await reload();
      onChanged?.();      // 下の「今日の架電予定」や件数も読み直す
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: number) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <Card title="今日の予定（自分）">
      <div className="space-y-3">
        <div role="tablist" aria-label="予定の種類" className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => changeKind(k)}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${kind === k ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
            >
              {SCHEDULE_LABEL[k]}
              <span className={`ml-1 tabular-nums ${kind === k ? "text-slate-300" : "text-slate-400"}`}>{data?.[k].length ?? 0}</span>
            </button>
          ))}
        </div>

        {error && <ErrorBox message={error} onRetry={reload} />}
        {message && <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">{message}</div>}

        {items.length === 0 ? (
          <Empty>{data ? `今日の${SCHEDULE_LABEL[kind]}はありません` : "読み込み中…"}</Empty>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1.5 text-slate-600">
                <input type="checkbox" checked={chosen.length === items.length} onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} />
                すべて選択
              </label>
              <Button size="sm" variant="primary" disabled={chosen.length === 0 || busy} onClick={() => done(chosen)}>
                選んだ{chosen.length}件を対応済みにする
              </Button>
            </div>
            <ul className="divide-y divide-slate-100">
              {items.map((i) => (
                <li key={i.id} className="flex items-start gap-2 py-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={selected.has(i.id)} onChange={() => toggle(i.id)} aria-label={`${i.company_name}を選択`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className={`tabular-nums font-semibold ${i.overdue ? "text-rose-600" : "text-slate-900"}`}>{fmtShort(i.at)}</span>
                      {i.overdue && <span className="rounded bg-rose-50 px-1.5 text-[11px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200">期限超過</span>}
                      <Link to={`/companies/${i.company_id}`} className="font-medium text-indigo-700 hover:underline">
                        {i.company_name}
                      </Link>
                      {!!i.is_user && <span className="rounded bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">ユーザー</span>}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {[i.contact_name, i.phone].filter(Boolean).join(" ／ ")}
                      {i.raw_note && <span className="ml-2 text-slate-600">{i.raw_note.split("\n").filter(Boolean).slice(-1)[0]}</span>}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => done([i])}>
                    対応済み
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}
