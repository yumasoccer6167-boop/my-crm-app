import { useState } from "react";
import type { CallLog, Contact } from "../../types";
import { api, unwrap } from "../../lib/api";
import { fmtDateTime, fromLocalInput, isOverdue, toLocalInput } from "../../lib/format";
import { useMasters } from "../../lib/masters";
import { Button, Card, CATEGORY_STYLE, Empty, ErrorBox, inputCls, StatusBadge } from "../ui";

/** 過去の架電履歴を直すフォーム。会社の現在のステータス・次回架電は、ここでは変わらない */
function CallEditForm({ call, contacts, onSaved, onCancel }: { call: CallLog; contacts: Contact[]; onSaved: () => void; onCancel: () => void }) {
  const { statuses } = useMasters();
  const [calledAt, setCalledAt] = useState(toLocalInput(call.called_at));
  const [statusId, setStatusId] = useState<number | null>(call.result_status_id);
  const [contactId, setContactId] = useState<number | null>(call.contact_id);
  const [note, setNote] = useState(call.raw_note);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 無効になったステータスでも、この履歴が今そのステータスなら選べるように残す
  const options = statuses.filter((s) => (s.is_active && s.category !== "not_started") || s.id === call.result_status_id);
  const noteChanged = note !== call.raw_note;
  const hasAI = call.ai_status === "done" || !!call.ai_summary;

  async function save() {
    const iso = fromLocalInput(calledAt);
    if (!iso) {
      setError("日時を入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await unwrap(
        api.calls[":id"].$patch({
          param: { id: String(call.id) },
          json: { raw_note: note, called_at: iso, result_status_id: statusId, contact_id: contactId },
        }),
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 space-y-3 rounded-md bg-slate-50 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs text-slate-500">架電日時</div>
          <input type="datetime-local" value={calledAt} onChange={(e) => setCalledAt(e.target.value)} className={inputCls} />
        </div>
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
      </div>

      <div>
        <div className="mb-1 text-xs text-slate-500">結果</div>
        <div className="flex flex-wrap gap-1.5">
          {options.map((s) => (
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

      <div>
        <div className="mb-1 text-xs text-slate-500">メモ</div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} className={`${inputCls} resize-y leading-relaxed`} />
        {noteChanged && hasAI && <p className="mt-1 text-xs text-amber-700">メモを変えると、この履歴のAI要約は消えます（保存後に「AIで整理」し直せます）。</p>}
      </div>

      <p className="text-xs text-slate-500">ここで直しても、施設のステータス・次回架電はそのままです（最終架電日時だけ再計算されます）。</p>
      {error && <ErrorBox message={`保存できませんでした：${error}`} />}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          取消
        </Button>
        <Button size="sm" variant="primary" disabled={saving} onClick={save}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  );
}

export function Timeline({
  calls,
  contacts,
  nextCallAt,
  nextAction,
  onChanged,
}: {
  calls: CallLog[];
  contacts: Contact[];
  nextCallAt: string | null;
  nextAction: string | null;
  onChanged: () => void;
}) {
  const { me, aiAvailable } = useMasters();
  const [running, setRunning] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

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
        {calls.map((cl) => {
          const canModify = me.role !== "sales" || cl.user_id === me.id;
          return (
            <li key={cl.id} className="group relative">
              <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-slate-400 ring-4 ring-white" />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium tabular-nums text-slate-800">{fmtDateTime(cl.called_at)}</span>
                {cl.result_label && <StatusBadge label={cl.result_label} category={cl.result_category} />}
                <span className="text-xs text-slate-500">
                  {cl.user_name ?? "—"}
                  {cl.contact_name && ` → ${cl.contact_name}`}
                </span>
                {canModify && editingId !== cl.id && (
                  <span className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(cl.id)}>
                      編集
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deactivate(cl.id)}>
                      無効化
                    </Button>
                  </span>
                )}
              </div>
              {editingId === cl.id ? (
                <CallEditForm
                  call={cl}
                  contacts={contacts}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => {
                    setEditingId(null);
                    onChanged();
                  }}
                />
              ) : (
                <>
                  {cl.ai_summary && <p className="mt-1 rounded bg-indigo-50 px-2 py-1 text-sm text-indigo-900">AI要約：{cl.ai_summary}</p>}
                  {cl.raw_note && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{cl.raw_note}</p>}
                  {cl.ai_status === "failed" && <p className="mt-1 text-xs text-amber-700">AI整理に失敗しました（メモは保存済み）{cl.ai_error && `：${cl.ai_error}`}</p>}
                  {aiAvailable && cl.raw_note.trim() && cl.ai_status !== "done" && canModify && (
                    <Button size="sm" variant="ghost" className="mt-1 text-indigo-700" disabled={running === cl.id} onClick={() => analyze(cl.id)}>
                      {running === cl.id ? "AIで整理中…" : cl.ai_status === "failed" ? "AIで再整理" : "AIで整理"}
                    </Button>
                  )}
                </>
              )}
            </li>
          );
        })}
        {calls.length === 0 && !nextCallAt && (
          <li>
            <Empty>まだ架電履歴がありません</Empty>
          </li>
        )}
      </ol>
    </Card>
  );
}
