import { useState } from "react";
import type { Contact } from "../../types";
import { api, unwrap } from "../../lib/api";
import { fmtDateTime, fromLocalInput } from "../../lib/format";
import { useApi } from "../../lib/useApi";
import { productNames } from "../../lib/record-kind";
import { Button, ErrorBox, inputCls } from "../ui";
import { emptySales, ReplyFields, replyPayload, type SalesDetail } from "./SalesDetailFields";

/**
 * 返事待ち対応の入力。営業で「返事待ち」にした訪問への、その後の対応を記録する（結果：受注・NG・再営業）。
 * 受注は契約情報にも自動で登録され、営業結果ページ（営業結果管理・営業成績表）に反映される。施設のステータス・次回架電は変えない。
 */
export function ReplyEntry({ companyId, contacts, onSaved }: { companyId: number; contacts: Contact[]; onSaved: () => void }) {
  const calls = useApi(() => unwrap(api.companies[":id"].calls.$get({ param: { id: String(companyId) } })), [companyId]);
  // 対応していない返事待ちの訪問（新しい順）
  const waiting = (calls.data ?? []).filter((c) => c.record_type === "visit" && c.sales_result === "waiting" && !c.replied_result);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [detail, setDetail] = useState<SalesDetail>(emptySales);
  const [note, setNote] = useState("");
  const [contactId, setContactId] = useState<number | null>(null);
  const [recordedAt, setRecordedAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const target = replyTo ?? waiting[0]?.id ?? null;
  const futureAt = recordedAt !== "" && new Date(recordedAt).getTime() > Date.now() + 60_000;
  const canSave = detail.result !== "" && !futureAt;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await unwrap(
        api.companies[":id"].calls.$post({
          param: { id: String(companyId) },
          json: {
            record_type: "reply",
            raw_note: note,
            called_at: recordedAt ? (fromLocalInput(recordedAt) ?? undefined) : new Date().toISOString(),
            contact_id: contactId,
            reply_to_id: target,
            ...replyPayload(detail),
          },
        }),
      );
      setNote("");
      setDetail(emptySales);
      setReplyTo(null);
      setRecordedAt("");
      setSavedMsg("保存しました");
      setTimeout(() => setSavedMsg(null), 2500);
      void calls.reload();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs text-slate-500">対応する返事待ち</div>
        {waiting.length === 0 ? (
          <p className="text-xs text-slate-400">返事待ちの訪問記録はありません（営業の訪問記録で結果を「返事待ち」にすると、ここに出ます）。紐づけなしでも記録できます。</p>
        ) : (
          <select value={target ?? ""} onChange={(e) => setReplyTo(Number(e.target.value))} className={inputCls}>
            {waiting.map((w) => (
              <option key={w.id} value={w.id}>
                {fmtDateTime(w.called_at)} の営業{productNames(w) ? `（${productNames(w)}）` : ""}
                {w.sales_followup_at ? ` ／ 返事の予定 ${fmtDateTime(w.sales_followup_at)}` : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      <ReplyFields value={detail} onChange={setDetail} />

      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="例）電話で返事をもらった。来月から導入したいとのこと。" className={`${inputCls} resize-y leading-relaxed`} />

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
          {saving ? "保存中…" : "返事待ち対応を保存"}
        </Button>
      </div>
    </div>
  );
}
