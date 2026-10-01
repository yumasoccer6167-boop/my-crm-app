import { useState } from "react";
import type { Contact } from "../../types";
import type { CallExtraction } from "../../types";
import { AIResult } from "./AIResult";
import { api, unwrap } from "../../lib/api";
import { fromLocalInput, quickDate, toLocalInput } from "../../lib/format";
import { useMasters } from "../../lib/masters";
import { Button, Card, CATEGORY_STYLE, ErrorBox, inputCls } from "../ui";

const QUICK = [
  { kind: "today15", label: "今日15時" },
  { kind: "tomorrow", label: "明日" },
  { kind: "days3", label: "3日後" },
  { kind: "week", label: "1週間後" },
  { kind: "month", label: "1か月後" },
] as const;

/**
 * 架電結果の入力。メモだけでも保存できる。
 * 保存はAIの成否と無関係に先に行う（AI整理はSTEP 10で保存後に実行）。
 */
export function CallEntry({ companyId, phone, contacts, onSaved }: { companyId: number; phone: string | null; contacts: Contact[]; onSaved: () => void }) {
  const { statuses, aiAvailable } = useMasters();
  const [note, setNote] = useState("");
  const [statusId, setStatusId] = useState<number | null>(null);
  const [nextCall, setNextCall] = useState("");
  const [contactId, setContactId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [aiState, setAiState] = useState<{ callId: number; running: boolean; error?: string; result?: { extraction: CallExtraction; next_call_at: string | null } } | null>(null);

  async function runAI(callId: number) {
    setAiState({ callId, running: true });
    try {
      const r = await unwrap(api.calls[":id"].analyze.$post({ param: { id: String(callId) } }));
      setAiState({ callId, running: false, result: r });
    } catch (e) {
      setAiState({ callId, running: false, error: e instanceof Error ? e.message : String(e) });
    }
    onSaved();
  }

  const active = statuses.filter((s) => s.is_active && s.category !== "not_started");
  const canSave = note.trim() !== "" || statusId !== null;

  async function save(withAI = false) {
    setSaving(true);
    setError(null);
    setAiState(null);
    try {
      const saved = await unwrap(
        api.companies[":id"].calls.$post({
          param: { id: String(companyId) },
          json: {
            raw_note: note,
            result_status_id: statusId ?? undefined,
            contact_id: contactId,
            phone_number: phone,
            next_call_at: nextCall ? fromLocalInput(nextCall) : undefined,
          },
        }),
      );
      setNote("");
      setStatusId(null);
      setNextCall("");
      setSavedMsg("保存しました");
      setTimeout(() => setSavedMsg(null), 2500);
      onSaved();
      // 保存が確定してからAIを呼ぶ（AIが失敗しても履歴は残る）
      if (withAI && note.trim()) void runAI(saved.id);
    } catch (e) {
      // 入力内容は消さずに残す
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="架電結果を入力">
      <div className="space-y-3">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          placeholder="例）担当者不在。受付の方から15時以降ならつながりやすいと言われた。"
          className={`${inputCls} resize-y leading-relaxed`}
        />

        <div>
          <div className="mb-1 text-xs text-slate-500">結果</div>
          <div className="flex flex-wrap gap-1.5">
            {active.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStatusId(statusId === s.id ? null : s.id)}
                className={`rounded px-2 py-1 text-xs font-medium ring-1 ring-inset ${statusId === s.id ? "bg-indigo-600 text-white ring-indigo-600" : CATEGORY_STYLE[s.category]}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-slate-500">次回架電</div>
            <div className="mb-1.5 flex flex-wrap gap-1">
              {QUICK.map((q) => (
                <Button key={q.kind} size="sm" onClick={() => setNextCall(toLocalInput(quickDate(q.kind)))}>
                  {q.label}
                </Button>
              ))}
            </div>
            <input type="datetime-local" value={nextCall} onChange={(e) => setNextCall(e.target.value)} className={inputCls} />
          </div>
          {contacts.length > 0 && (
            <div>
              <div className="mb-1 text-xs text-slate-500">話した相手</div>
              <select value={contactId ?? ""} onChange={(e) => setContactId(e.target.value ? Number(e.target.value) : null)} className={inputCls}>
                <option value="">（未選択・受付など）</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? "氏名不明"} {c.role && `（${c.role}）`}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {error && <ErrorBox message={`保存できませんでした：${error}（入力内容は残っています）`} />}

        <div className="flex items-center justify-end gap-2">
          {savedMsg && <span className="text-sm text-emerald-700">{savedMsg}</span>}
          <Button disabled={!canSave || saving} onClick={() => save(false)}>
            保存のみ
          </Button>
          <Button
            variant="primary"
            disabled={!note.trim() || saving || !aiAvailable}
            title={aiAvailable ? undefined : "AIが設定されていません（管理者がAPIキーを登録すると使えます）"}
            onClick={() => save(true)}
          >
            {saving ? "保存中…" : "保存してAIで整理"}
          </Button>
        </div>

        {aiState?.running && <div className="text-sm text-indigo-700">AIで整理しています…（メモは保存済みです）</div>}
        {aiState?.error && (
          <ErrorBox message={`メモは保存済みです。AIの整理に失敗しました：${aiState.error}`} onRetry={() => runAI(aiState.callId)} />
        )}
        {aiState?.result && (
          <AIResult companyId={companyId} extraction={aiState.result.extraction} nextCallAt={aiState.result.next_call_at} onApplied={onSaved} />
        )}
      </div>
    </Card>
  );
}
