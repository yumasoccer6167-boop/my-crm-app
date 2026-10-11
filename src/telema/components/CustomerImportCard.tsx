import { useState } from "react";
import type { CustomerImportBatch, CustomerImportSummary } from "../types";
import { api, unwrap } from "../lib/api";
import { useMasters } from "../lib/masters";
import { useApi } from "../lib/useApi";
import { Button, Card, ErrorBox } from "./ui";

type Total = Omit<CustomerImportBatch, "next_after_id" | "done" | "remaining" | "applied">;
const ZERO: Total = { processed: 0, created: 0, merged: 0, calls: 0, visits: 0, contracts: 0, skipped_records: 0, relations: 0, review: [], unknown_assignees: {} };

/** CRM本体の顧客リストを、テレマリストの施設・架電訪問の履歴・契約情報として取り込む（管理者のみ）。顧客リスト側は変えない */
export function CustomerImportCard() {
  const { me } = useMasters();
  const summary = useApi(() => unwrap(api.admin["customer-import"].$get()), []);
  const [running, setRunning] = useState<null | { apply: boolean; left: number | null }>(null);
  const [result, setResult] = useState<{ apply: boolean; total: Total } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (me.role !== "admin") return null;
  const s: CustomerImportSummary | null = summary.data;

  /** 数十件ずつ、最後まで繰り返す。apply=false は確認だけ（何も保存しない） */
  async function run(apply: boolean) {
    setError(null);
    setResult(null);
    setRunning({ apply, left: null });
    const total: Total = { ...ZERO, review: [], unknown_assignees: {} };
    try {
      let after: number | null = null;
      for (;;) {
        const r: CustomerImportBatch = await unwrap(api.admin["customer-import"].$post({ json: { apply, after_id: after, limit: 100 } }));
        for (const k of ["processed", "created", "merged", "calls", "visits", "contracts", "skipped_records", "relations"] as const) total[k] += r[k];
        total.review.push(...r.review);
        for (const [name, n] of Object.entries(r.unknown_assignees)) total.unknown_assignees[name] = (total.unknown_assignees[name] ?? 0) + n;
        after = r.next_after_id;
        setRunning({ apply, left: r.remaining });
        if (r.done) break;
      }
      setResult({ apply, total });
      if (apply) void summary.reload();
    } catch (e) {
      setError(`途中で止まりました：${e instanceof Error ? e.message : String(e)}（ここまでに取り込んだ分は保存されています。もう一度実行すると続きから取り込みます）`);
    } finally {
      setRunning(null);
    }
  }

  const t = result?.total;
  const unknown = t ? Object.entries(t.unknown_assignees).sort((a, b) => b[1] - a[1]) : [];
  return (
    <Card title="顧客リストから取り込む（管理者）">
      <div className="space-y-3 text-sm text-slate-700">
        <p>
          CRM本体の「顧客リスト」の顧客を、テレマリストの施設として取り込みます。法人名・園名・住所・電話・メール・理事長・園長・協会（加盟協会）・担当者・ユーザー（受注済み）のほか、
          記録（テレアポ・訪問・受注）はタイムラインと契約情報になります。<b>顧客リストのデータは変わりません。</b>
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
          <li>すでにある施設は、電話番号か住所が同じで名前も似ているときだけ同じ施設とみなし、空欄だけを補います（既存の値は上書きしません）。名前が違えば別の施設として作ります。</li>
          <li>候補が複数あって決められない顧客は「要確認」にして、取り込みません。</li>
          <li>何度実行しても二重には取り込みません。顧客リストに記録が増えたあとに実行すると、増えた記録だけが追加されます。</li>
        </ul>
        {s && (
          <p className="text-xs text-slate-500">
            顧客 {s.customers.toLocaleString()}件（取り込み済み {s.imported_customers.toLocaleString()}件）／記録 {s.records.toLocaleString()}件（取り込み済み {s.imported_records.toLocaleString()}件）
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!!running || !s} onClick={() => run(false)}>
            確認する（取り込まない）
          </Button>
          {result && !result.apply && (
            <Button
              variant="primary"
              disabled={!!running}
              onClick={() => {
                if (confirm(`確認した内容で取り込みます（新しい施設 ${result.total.created}件、既存の施設に追加 ${result.total.merged}件）。よろしいですか？`)) void run(true);
              }}
            >
              この内容で取り込む
            </Button>
          )}
          {running && (
            <span className="text-xs text-slate-500">
              {running.apply ? "取り込み中" : "確認中"}…{running.left != null && `（残り ${running.left.toLocaleString()}件）`}
            </span>
          )}
        </div>
        {error && <ErrorBox message={error} />}
        {t && (
          <div className="space-y-2 rounded-md bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
            <div className="font-medium text-slate-900">{result.apply ? "取り込みました" : "確認結果（まだ取り込んでいません）"}</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs sm:grid-cols-4">
              <span>新しい施設 <b className="tabular-nums">{t.created}</b>件</span>
              <span>既存の施設に追加 <b className="tabular-nums">{t.merged}</b>件</span>
              <span>架電の履歴 <b className="tabular-nums">{t.calls}</b>件</span>
              <span>訪問の履歴 <b className="tabular-nums">{t.visits}</b>件</span>
              <span>契約情報 <b className="tabular-nums">{t.contracts}</b>件</span>
              <span>つながり <b className="tabular-nums">{t.relations}</b>本</span>
              <span>日付が読めず除外 <b className="tabular-nums">{t.skipped_records}</b>件</span>
              <span>要確認 <b className="tabular-nums">{t.review.length}</b>件</span>
            </div>
            {unknown.length > 0 && (
              <p className="text-xs text-amber-800">
                担当者がメンバーと一致せず、担当なしで取り込んだもの: {unknown.slice(0, 8).map(([n, c]) => `${n} ${c}件`).join("、")}
                {unknown.length > 8 && " ほか"}
              </p>
            )}
            {t.review.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-slate-700">要確認（取り込んでいません）</div>
                <ul className="max-h-48 space-y-0.5 overflow-y-auto text-xs text-slate-600">
                  {t.review.map((r) => (
                    <li key={r.crm_id}>
                      <b className="text-slate-800">{r.name}</b>：{r.reason}
                      {r.candidates.length > 0 && <span className="text-slate-400">（候補: {r.candidates.map((c) => c.name).join("、")}）</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
