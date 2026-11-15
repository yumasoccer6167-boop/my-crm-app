import { useState } from "react";
import type { Contact, PreResult } from "../../types";
import { api, unwrap } from "../../lib/api";
import { fromLocalInput } from "../../lib/format";
import { PRE_RESULTS } from "../../lib/record-kind";
import { Button, ErrorBox, inputCls } from "../ui";

/** 事前対応のフラグ（訪問前連絡・リスケ・詰め直しNG・リスケ未定）を1つ選ぶ。もう一度押すと外れる。入力・編集の両方で使う */
export function PreFlagPicker({ value, onChange }: { value: PreResult | ""; onChange: (v: PreResult | "") => void }) {
  return (
    <div>
      <div className="mb-1 text-xs text-slate-500">事前対応（フラグを選んでください）</div>
      <div className="flex flex-wrap gap-1.5">
        {PRE_RESULTS.map((r) => {
          const on = value === r.value;
          return (
            <button
              key={r.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? "" : r.value)}
              className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset transition-colors ${on ? r.on : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
            >
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 事前対応の入力。訪問の前後の対応を、フラグ（訪問前連絡・リスケ・詰め直しNG・リスケ未定）とメモで記録する。
 * 施設のステータス・次回架電・架電件数、各集計（架電・訪問・営業）には影響しない。
 */
export function PreEntry({ companyId, contacts, onSaved }: { companyId: number; contacts: Contact[]; onSaved: () => void }) {
  const [flag, setFlag] = useState<PreResult | "">("");
  const [note, setNote] = useState("");
  const [contactId, setContactId] = useState<number | null>(null);
  const [recordedAt, setRecordedAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const futureAt = recordedAt !== "" && new Date(recordedAt).getTime() > Date.now() + 60_000;
  const canSave = flag !== "" && !futureAt;

  async function save() {
    if (flag === "") return;
    setSaving(true);
    setError(null);
    try {
      await unwrap(
        api.companies[":id"].calls.$post({
          param: { id: String(companyId) },
          json: {
            record_type: "pre",
            pre_result: flag,
            raw_note: note,
            called_at: recordedAt ? (fromLocalInput(recordedAt) ?? undefined) : new Date().toISOString(),
            contact_id: contactId,
          },
        }),
      );
      setNote("");
      setFlag("");
      setRecordedAt("");
      setSavedMsg("保存しました");
      setTimeout(() => setSavedMsg(null), 2500);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <PreFlagPicker value={flag} onChange={setFlag} />

      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="例）明日の訪問について、前日の連絡を入れた。" className={`${inputCls} resize-y leading-relaxed`} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs text-slate-500">対応日時（空なら保存した時刻）</div>
          <input type="datetime-local" value={recordedAt} onChange={(e) => setRecordedAt(e.target.value)} className={inputCls} />
          {futureAt && <p className="mt-1 text-xs text-rose-600">未来の日時は記録できません</p>}
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
        <Button variant="primary" disabled={!canSave || saving} onClick={save}>
          {saving ? "保存中…" : "事前対応を保存"}
        </Button>
      </div>
    </div>
  );
}
