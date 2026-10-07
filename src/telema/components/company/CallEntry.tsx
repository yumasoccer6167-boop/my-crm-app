import { useState } from "react";
import type { Contact, RecordType, VisitMethod } from "../../types";
import type { CallExtraction } from "../../types";
import { AIResult } from "./AIResult";
import { api, unwrap } from "../../lib/api";
import { fromLocalInput, quickDate, toLocalInput } from "../../lib/format";
import { useMasters } from "../../lib/masters";
import { VISIT_METHODS } from "../../lib/record-kind";
import { defaultSection, saveLastSection } from "../../lib/section-pref";
import { Button, Card, CATEGORY_STYLE, ErrorBox, inputCls } from "../ui";

const QUICK = [
  { kind: "today15", label: "今日15時" },
  { kind: "tomorrow", label: "明日" },
  { kind: "days3", label: "3日後" },
  { kind: "week", label: "1週間後" },
  { kind: "month", label: "1か月後" },
] as const;

const KINDS: { value: RecordType; label: string }[] = [
  { value: "call", label: "架電結果" },
  { value: "visit", label: "訪問記録" },
];

/**
 * 架電結果・訪問記録の入力。メモだけでも保存できる。
 * 保存はAIの成否と無関係に先に行う（AI整理はSTEP 10で保存後に実行）。
 * 訪問記録は「訪問／Zoom」の方法と日時を記録する。施設のステータス・次回架電・架電件数は変えない。
 */
export function CallEntry({
  companyId,
  phone,
  contacts,
  isUser,
  onSaved,
}: {
  companyId: number;
  phone: string | null;
  contacts: Contact[];
  /** ユーザー（導入済み）の施設なら、記録に部署（営業部・制作部・CS など）を付けられる */
  isUser: boolean;
  onSaved: () => void;
}) {
  const { statuses, sections, aiAvailable } = useMasters();
  const [sectionId, setSectionId] = useState<number | null>(() => defaultSection(sections));
  const [kind, setKind] = useState<RecordType>("call");
  const [visitMethod, setVisitMethod] = useState<VisitMethod>("visit");
  const [visitedAt, setVisitedAt] = useState(() => toLocalInput(new Date().toISOString()));
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
  const isVisit = kind === "visit";
  const canSave = isVisit ? note.trim() !== "" && !!fromLocalInput(visitedAt) : note.trim() !== "" || statusId !== null;

  async function save(withAI = false) {
    setSaving(true);
    setError(null);
    setAiState(null);
    try {
      const common = {
        raw_note: note,
        contact_id: contactId,
        // 部署はユーザーの施設だけ。それ以外は未分類のまま（後で施設がユーザーになったとき、未分類として見られる）
        section_id: isUser ? sectionId : undefined,
      };
      const saved = await unwrap(
        api.companies[":id"].calls.$post({
          param: { id: String(companyId) },
          json: isVisit
            ? { ...common, record_type: "visit", visit_method: visitMethod, called_at: fromLocalInput(visitedAt) ?? undefined }
            : { ...common, result_status_id: statusId ?? undefined, phone_number: phone, next_call_at: nextCall ? fromLocalInput(nextCall) : undefined },
        }),
      );
      if (isUser) saveLastSection(sectionId);
      setNote("");
      setStatusId(null);
      setNextCall("");
      setVisitedAt(toLocalInput(new Date().toISOString()));
      setSavedMsg("保存しました");
      setTimeout(() => setSavedMsg(null), 2500);
      onSaved();
      // 保存が確定してからAIを呼ぶ（AIが失敗しても履歴は残る）
      if (withAI && !isVisit && note.trim()) void runAI(saved.id);
    } catch (e) {
      // 入力内容は消さずに残す
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title={isVisit ? "訪問記録を入力" : "架電結果を入力"}>
      <div className="space-y-3">
        <div role="tablist" aria-label="記録の種類" className="inline-flex rounded-md bg-slate-100 p-0.5">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              role="tab"
              aria-selected={kind === k.value}
              onClick={() => setKind(k.value)}
              className={`rounded px-3 py-1 text-sm font-medium ${kind === k.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              {k.label}
            </button>
          ))}
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          placeholder={isVisit ? "例）園長と面談。来月のイベントでの活用を提案した。" : "例）担当者不在。受付の方から15時以降ならつながりやすいと言われた。"}
          className={`${inputCls} resize-y leading-relaxed`}
        />

        {isUser && (
          <div>
            <div className="mb-1 text-xs text-slate-500">部署（この記録をどの部署として残すか）</div>
            <div className="flex flex-wrap gap-1.5">
              {sections
                .filter((s) => s.is_active)
                .map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSectionId(sectionId === s.id ? null : s.id)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${sectionId === s.id ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
                  >
                    {s.name}
                  </button>
                ))}
              {sections.every((s) => !s.is_active) && <span className="text-xs text-slate-400">部署が未登録です（「設定」で追加できます）</span>}
            </div>
          </div>
        )}

        {isVisit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-xs text-slate-500">訪問の方法</div>
              <div className="flex gap-1.5">
                {VISIT_METHODS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setVisitMethod(m.value)}
                    className={`rounded px-3 py-1 text-sm font-medium ring-1 ring-inset ${visitMethod === m.value ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs text-slate-500">訪問日時</div>
              <input type="datetime-local" value={visitedAt} onChange={(e) => setVisitedAt(e.target.value)} className={inputCls} />
            </div>
          </div>
        )}

        {!isVisit && (
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
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {!isVisit && (
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
          )}
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
          {isVisit ? (
            <Button variant="primary" disabled={!canSave || saving} onClick={() => save(false)}>
              {saving ? "保存中…" : "訪問を保存"}
            </Button>
          ) : (
            <>
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
            </>
          )}
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
