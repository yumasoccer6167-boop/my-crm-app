import { useEffect, useState } from "react";
import type { SummarySuggestion } from "../../types";
import { api, unwrap } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { Button, Card, ErrorBox, inputCls } from "../ui";

const proposedText = (d: SummarySuggestion) => (d.next_action ? `${d.summary}\n\n推奨アクション：${d.next_action}` : d.summary);

/**
 * 施設全体のAIサマリー。「AIで要約」を押したときだけ架電履歴から要約案を作り（AI利用料がかかるため自動では作らない）、
 * 利用者が採用（必要なら修正）したものだけをカルテのサマリーとして表示する
 */
export function SummaryCard({
  companyId,
  summary,
  draft,
  callCount,
  editable,
  aiAvailable,
  onChanged,
}: {
  companyId: number;
  summary: string | null;
  draft: SummarySuggestion | null;
  callCount: number;
  editable: boolean;
  aiAvailable: boolean;
  onChanged: () => void;
}) {
  const [text, setText] = useState(draft ? proposedText(draft) : "");
  const [busy, setBusy] = useState<"run" | "decide" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(draft ? proposedText(draft) : ""), [draft?.id]);

  async function run() {
    setBusy("run");
    setError(null);
    try {
      await unwrap(api.companies[":id"].summarize.$post({ param: { id: String(companyId) } }));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function decide(action: "approve" | "reject") {
    if (!draft) return;
    setBusy("decide");
    setError(null);
    try {
      await unwrap(
        api["ai-suggestions"][":id"].decide.$post({
          param: { id: String(draft.id) },
          json: action === "approve" ? { action, summary: text.trim() || proposedText(draft) } : { action },
        }),
      );
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const canRun = editable && aiAvailable && callCount > 0;
  const hint = !aiAvailable
    ? "AIが設定されていないため要約できません"
    : callCount === 0
      ? "架電を記録すると要約できます"
      : !editable
        ? "他の営業担当の企業のため要約できません"
        : `架電履歴（${callCount}件）からAIが今の状況をまとめます`;

  return (
    <Card
      title="AIサマリー"
      action={
        <Button size="sm" variant={summary || draft ? "secondary" : "primary"} disabled={!canRun || busy != null} onClick={run} title={hint}>
          {busy === "run" ? "要約中…" : summary || draft ? "AIで要約し直す" : "AIで要約"}
        </Button>
      }
    >
      <div className="space-y-3">
        {draft && (
          <div className="space-y-2 rounded-md bg-amber-50 p-3 ring-1 ring-amber-200">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-amber-900">
              <span className="font-semibold">AIの要約案</span>
              <span className="text-amber-700">
                架電{draft.calls}件から・{fmtDateTime(draft.created_at)}
              </span>
            </div>
            <textarea
              className={`${inputCls} bg-white`}
              rows={Math.min(10, Math.max(4, text.split("\n").length + 1))}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={!editable}
            />
            {editable && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-amber-800">内容を確認し、必要なら直してから採用してください</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" disabled={busy != null} onClick={() => decide("reject")}>
                    破棄
                  </Button>
                  <Button size="sm" variant="primary" disabled={busy != null || !text.trim()} onClick={() => decide("approve")}>
                    {summary ? "採用して置き換える" : "採用"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        {summary ? (
          <p className="whitespace-pre-wrap text-sm text-slate-800">{summary}</p>
        ) : (
          !draft && <p className="text-sm text-slate-400">まだAIサマリーはありません。{hint}。</p>
        )}
        {error && <ErrorBox message={error} />}
      </div>
    </Card>
  );
}
