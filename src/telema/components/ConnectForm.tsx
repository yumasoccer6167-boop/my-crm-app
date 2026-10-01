import { useEffect, useState } from "react";
import type { Contact } from "../types";
import { api, unwrap } from "../lib/api";
import { CompanyPicker, UserTag } from "./CompanyPicker";
import { Button, ErrorBox, inputCls } from "./ui";

/** 選んだ施設（検索結果・相関図の点のどちらからでも） */
export type PickedCompany = { id: number; company_name: string; status_category: string | null };
type Side = { company: PickedCompany | null; contacts: Contact[]; contactId: string };
const emptySide: Side = { company: null, contacts: [], contactId: "" };

/**
 * 相関図から施設どうしをつなぐ。ユーザー（受注）・ユーザー以外を問わず2つの施設を選ぶ。
 * 登録は会社カルテと同じ POST /companies/:id/relations（a 側の施設を編集できる人だけ）
 */
export function ConnectForm({ initial, onSaved, onClose }: { initial?: PickedCompany; onSaved: (aId: number) => void; onClose: () => void }) {
  const [a, setA] = useState<Side>({ ...emptySide, company: initial ?? null });
  const [b, setB] = useState<Side>(emptySide);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const aId = a.company?.id;
  const bId = b.company?.id;

  // 選んだ施設の担当者を読み込む（どの担当者どうしが知り合いかを選べるように）
  useEffect(() => loadContacts(aId, setA), [aId]);
  useEffect(() => loadContacts(bId, setB), [bId]);

  function loadContacts(id: number | undefined, set: (f: (s: Side) => Side) => void) {
    if (id == null) return;
    let alive = true;
    unwrap(api.companies[":id"].$get({ param: { id: String(id) } }))
      .then((d) => alive && set((s) => (s.company?.id === id ? { ...s, contacts: d.contacts.filter((c) => c.name) } : s)))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }

  async function save() {
    if (!a.company || !b.company) return;
    setSaving(true);
    try {
      await unwrap(
        api.companies[":id"].relations.$post({
          param: { id: String(a.company.id) },
          json: {
            other_company_id: b.company.id,
            contact_id: a.contactId ? Number(a.contactId) : null,
            other_contact_id: b.contactId ? Number(b.contactId) : null,
            label: label.trim() || null,
            notes: notes.trim() || null,
          },
        }),
      );
      onSaved(a.company.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const side = (title: string, s: Side, set: (s: Side) => void, other: number | undefined) => (
    <div className="space-y-1">
      <div className="text-xs text-slate-500">{title}</div>
      {s.company ? (
        <>
          <div className="flex items-center gap-1.5 text-sm">
            <span className="min-w-0 truncate font-medium text-slate-900">{s.company.company_name}</span>
            <UserTag category={s.company.status_category} />
            <Button size="sm" variant="ghost" className="ml-auto shrink-0 whitespace-nowrap" onClick={() => set(emptySide)}>
              変更
            </Button>
          </div>
          <select className={inputCls} value={s.contactId} onChange={(e) => set({ ...s, contactId: e.target.value })}>
            <option value="">担当者：指定なし</option>
            {s.contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.role ? `（${c.role}）` : ""}
              </option>
            ))}
          </select>
        </>
      ) : (
        <CompanyPicker
          placeholder="施設名・電話・担当者名で検索"
          exclude={other != null ? [other] : []}
          onPick={(c) => set({ company: c, contacts: [], contactId: "" })}
          onError={setError}
        />
      )}
    </div>
  );

  return (
    <div className="space-y-3 text-sm">
      {side("施設 1", a, setA, bId)}
      <div className="text-center text-xs text-slate-400">⇕ 知り合い</div>
      {side("施設 2", b, setB, aId)}
      <input className={inputCls} placeholder="関係（例：園長会で知り合い・紹介元）" value={label} onChange={(e) => setLabel(e.target.value)} />
      <textarea className={inputCls} rows={2} placeholder="メモ" value={notes} onChange={(e) => setNotes(e.target.value)} />
      {error && <ErrorBox message={error} />}
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={onClose}>
          取消
        </Button>
        <Button size="sm" variant="primary" disabled={!a.company || !b.company || saving} onClick={save}>
          つなぐ
        </Button>
      </div>
    </div>
  );
}
