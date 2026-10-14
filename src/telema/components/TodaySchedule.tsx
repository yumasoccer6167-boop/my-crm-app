import { useState } from "react";
import { Link } from "react-router";
import type { ScheduleItem, ScheduleKind } from "../types";
import { api, unwrap } from "../lib/api";
import { fmtShort } from "../lib/format";
import { markScheduleDone, SCHEDULE_LABEL } from "../lib/schedule";
import { useApi } from "../lib/useApi";
import { Button, Card, Empty, ErrorBox } from "./ui";

const KINDS: ScheduleKind[] = ["visit", "precheck", "recall"];

/** 1つの種類の予定のボックス。対応済みにすると消える（チェックを付けて、まとめても押せる） */
function ScheduleBox({ kind, items, loaded, onChanged }: { kind: ScheduleKind; items: ScheduleItem[]; loaded: boolean; onChanged: () => Promise<void> | void }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const chosen = items.filter((i) => selected.has(i.id));
  const label = SCHEDULE_LABEL[kind];

  async function done(targets: ScheduleItem[]) {
    if (targets.length === 0) return;
    if (targets.length > 1 && !confirm(`${label}を${targets.length}件、対応済みにします。表示から消えます。よろしいですか？`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await markScheduleDone(targets.map((t) => ({ kind, id: t.id })));
      if (r.skipped > 0) setMessage(`${r.done}件を対応済みにしました（${r.skipped}件は、担当外などのため変更できませんでした）`);
      setSelected(new Set());
      await onChanged();
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
    <Card
      title={
        <>
          {label}
          <span className="ml-1.5 font-normal tabular-nums text-slate-500">{items.length}件</span>
        </>
      }
    >
      <div className="space-y-2">
        {message && <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">{message}</div>}
        {items.length === 0 ? (
          <Empty>{loaded ? `今日の${label}はありません` : "読み込み中…"}</Empty>
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
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {items.map((i) => (
                <li key={i.id} className="flex items-start gap-2 py-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={selected.has(i.id)} onChange={() => toggle(i.id)} aria-label={`${i.company_name}を選択`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className={`font-semibold tabular-nums ${i.overdue ? "text-rose-600" : "text-slate-900"}`}>{fmtShort(i.at)}</span>
                      {i.overdue && <span className="rounded bg-rose-50 px-1.5 text-[11px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200">期限超過</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2">
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

/** マイページの「今日の予定（自分）」：訪問予定・訪問前連絡予定・再コールを、それぞれ別のボックスで並べる */
export function TodaySchedule({ onChanged }: { onChanged?: () => void }) {
  const { data, error, reload } = useApi(() => unwrap(api.schedule.today.$get()), []);
  const changed = async () => {
    await reload();
    onChanged?.(); // 下の「今日の架電予定」や件数も読み直す
  };
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-800">今日の予定（自分）</h2>
      {error && <ErrorBox message={error} onRetry={reload} />}
      <div className="grid gap-4 xl:grid-cols-3">
        {KINDS.map((k) => (
          <ScheduleBox key={k} kind={k} items={data?.[k] ?? []} loaded={!!data} onChanged={changed} />
        ))}
      </div>
    </div>
  );
}
