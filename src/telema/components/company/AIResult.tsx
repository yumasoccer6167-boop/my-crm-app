import { useState } from "react";
import type { CallExtraction } from "../../types";
import { api, unwrap } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { useMasters } from "../../lib/masters";
import { Button, ErrorBox } from "../ui";

const LABELS: [keyof CallExtraction, string][] = [
  ["call_result", "結果"],
  ["contact_person", "担当者"],
  ["contact_role", "役職"],
  ["best_time_to_call", "つながりやすい時間"],
  ["pain_point", "課題"],
  ["current_service", "利用中サービス"],
  ["decision_maker", "決裁者"],
  ["decision_timing", "導入時期"],
  ["budget", "予算"],
  ["objection", "懸念・断り"],
];
const INTEREST: Record<string, string> = { high: "高", mid: "中", low: "低", unknown: "不明" };

/** AIの整理結果。表示するだけで、反映は利用者がボタンで選ぶ */
export function AIResult({ companyId, extraction, nextCallAt, onApplied }: { companyId: number; extraction: CallExtraction; nextCallAt: string | null; onApplied: () => void }) {
  const { statuses } = useMasters();
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const status = statuses.find((s) => s.label === extraction.suggested_status);

  async function apply(key: string, json: Record<string, unknown>) {
    setError(null);
    try {
      await unwrap(api.companies[":id"].$patch({ param: { id: String(companyId) }, json }));
      setApplied({ ...applied, [key]: true });
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const rows = LABELS.filter(([k]) => extraction[k]);
  return (
    <div className="space-y-3 rounded-md bg-indigo-50/60 p-3 text-sm ring-1 ring-indigo-100">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-indigo-800">AIの整理結果（提案）</span>
        <span className="text-xs text-slate-500">興味度：{INTEREST[extraction.interest_level] ?? "不明"}</span>
      </div>
      <p className="text-slate-900">{extraction.summary}</p>
      {rows.length > 0 && (
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs">
          {rows.map(([k, label]) => (
            <div key={k} className="contents">
              <dt className="text-slate-500">{label}</dt>
              <dd className="text-slate-800">{String(extraction[k])}</dd>
            </div>
          ))}
        </dl>
      )}
      {(extraction.next_action || nextCallAt || status) && (
        <div className="space-y-2 border-t border-indigo-100 pt-2">
          {(extraction.next_action || nextCallAt) && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-slate-800">
                次回：{nextCallAt ? fmtDateTime(nextCallAt) : "日時未定"}
                {extraction.next_action && ` / ${extraction.next_action}`}
              </span>
              <Button
                size="sm"
                variant={applied.next ? "ghost" : "primary"}
                disabled={applied.next}
                onClick={() => apply("next", { ...(nextCallAt && { next_call_at: nextCallAt }), ...(extraction.next_action && { next_action: extraction.next_action }) })}
              >
                {applied.next ? "採用済み" : "次回予定に採用"}
              </Button>
            </div>
          )}
          {status && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-slate-800">ステータス候補：{status.label}</span>
              <Button size="sm" variant={applied.status ? "ghost" : "secondary"} disabled={applied.status} onClick={() => apply("status", { status_id: status.id })}>
                {applied.status ? "採用済み" : "ステータスに採用"}
              </Button>
            </div>
          )}
        </div>
      )}
      {error && <ErrorBox message={error} />}
    </div>
  );
}
