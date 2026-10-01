import { useState } from "react";
import type { CallLog } from "../../types";
import { api, unwrap } from "../../lib/api";
import { fmtDateTime, isOverdue } from "../../lib/format";
import { useMasters } from "../../lib/masters";
import { Button, Card, Empty, StatusBadge } from "../ui";

export function Timeline({ calls, nextCallAt, nextAction, onChanged }: { calls: CallLog[]; nextCallAt: string | null; nextAction: string | null; onChanged: () => void }) {
  const { me, aiAvailable } = useMasters();
  const [running, setRunning] = useState<number | null>(null);

  async function analyze(id: number) {
    setRunning(id);
    try {
      await unwrap(api.calls[":id"].analyze.$post({ param: { id: String(id) } }));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
      onChanged();
    }
  }

  async function deactivate(id: number) {
    if (!confirm("この架電履歴を無効化しますか？（データは残り、一覧から非表示になります）")) return;
    try {
      await unwrap(api.calls[":id"].deactivate.$post({ param: { id: String(id) } }));
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card title={`タイムライン（${calls.length}件）`}>
      <ol className="relative space-y-5 border-l-2 border-slate-200 pl-5">
        {nextCallAt && (
          <li className="relative">
            <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-white ${isOverdue(nextCallAt) ? "bg-rose-500" : "bg-indigo-500"}`} />
            <div className="text-sm font-semibold text-indigo-800">
              {fmtDateTime(nextCallAt)} 次回架電予定{isOverdue(nextCallAt) && <span className="ml-2 text-xs text-rose-600">期限超過</span>}
            </div>
            {nextAction && <p className="mt-0.5 text-sm text-slate-700">{nextAction}</p>}
          </li>
        )}
        {calls.map((cl) => (
          <li key={cl.id} className="group relative">
            <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-slate-400 ring-4 ring-white" />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium tabular-nums text-slate-800">{fmtDateTime(cl.called_at)}</span>
              {cl.result_label && <StatusBadge label={cl.result_label} category={cl.result_category} />}
              <span className="text-xs text-slate-500">
                {cl.user_name ?? "—"}
                {cl.contact_name && ` → ${cl.contact_name}`}
              </span>
              {(me.role !== "sales" || cl.user_id === me.id) && (
                <Button size="sm" variant="ghost" className="ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => deactivate(cl.id)}>
                  無効化
                </Button>
              )}
            </div>
            {cl.ai_summary && <p className="mt-1 rounded bg-indigo-50 px-2 py-1 text-sm text-indigo-900">AI要約：{cl.ai_summary}</p>}
            {cl.raw_note && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{cl.raw_note}</p>}
            {cl.ai_status === "failed" && <p className="mt-1 text-xs text-amber-700">AI整理に失敗しました（メモは保存済み）{cl.ai_error && `：${cl.ai_error}`}</p>}
            {aiAvailable && cl.raw_note.trim() && cl.ai_status !== "done" && (me.role !== "sales" || cl.user_id === me.id) && (
              <Button size="sm" variant="ghost" className="mt-1 text-indigo-700" disabled={running === cl.id} onClick={() => analyze(cl.id)}>
                {running === cl.id ? "AIで整理中…" : cl.ai_status === "failed" ? "AIで再整理" : "AIで整理"}
              </Button>
            )}
          </li>
        ))}
        {calls.length === 0 && !nextCallAt && (
          <li>
            <Empty>まだ架電履歴がありません</Empty>
          </li>
        )}
      </ol>
    </Card>
  );
}
