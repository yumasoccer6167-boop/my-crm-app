import { useEffect, useState } from "react";
import type { Contact } from "../types";
import { api, unwrap } from "../lib/api";
import { CompanyPicker, UserTag } from "./CompanyPicker";
import { Button, ErrorBox, inputCls } from "./ui";

/** 選んだ施設（検索結果・相関図の点のどちらからでも） */
export type PickedCompany = {
  id: number;
  company_name: string;
  status_category: string | null;
};
// creating：見つからなかった園を新しく登録している途中（入力した園名）。isNew：この画面で登録した園
type Side = {
  company: PickedCompany | null;
  contacts: Contact[];
  contactId: string;
  creating?: string;
  isNew?: boolean;
};
const emptySide: Side = { company: null, contacts: [], contactId: "" };

/** まだ登録の無い園を、園名・電話・住所・担当者だけで登録する（つなぐ相手として使う） */
function NewCompanyForm({ name, onCreated, onCancel }: { name: string; onCreated: (s: Side) => void; onCancel: () => void }) {
  const [v, setV] = useState({
    company_name: name,
    phone: "",
    address: "",
    contact: "",
    role: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  async function save() {
    setSaving(true);
    try {
      const row = await unwrap(
        api.companies.$post({
          json: {
            company_name: v.company_name.trim(),
            phone: v.phone.trim() || null,
            address: v.address.trim() || null,
          },
        }),
      );
      const contact = v.contact.trim()
        ? await unwrap(
            api.companies[":id"].contacts.$post({
              param: { id: String(row.id) },
              json: { name: v.contact.trim(), role: v.role.trim() || null },
            }),
          )
        : null;
      onCreated({
        company: {
          id: row.id,
          company_name: row.company_name,
          status_category: null,
        },
        contacts: contact ? [contact] : [],
        contactId: contact ? String(contact.id) : "",
        isNew: true,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1.5 rounded-md bg-indigo-50/50 p-2 ring-1 ring-indigo-100">
      <div className="text-xs font-medium text-indigo-800">新しい園を登録</div>
      <input className={inputCls} placeholder="園名（必須）" value={v.company_name} onChange={set("company_name")} />
      <input className={inputCls} placeholder="電話番号" value={v.phone} onChange={set("phone")} />
      <input className={inputCls} placeholder="住所（都道府県から）" value={v.address} onChange={set("address")} />
      <div className="flex gap-1.5">
        <input className={inputCls} placeholder="知り合いの担当者名" value={v.contact} onChange={set("contact")} />
        <input className={`${inputCls} max-w-28`} placeholder="役職" value={v.role} onChange={set("role")} />
      </div>
      {error && <ErrorBox message={error} />}
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          戻る
        </Button>
        <Button size="sm" variant="primary" disabled={!v.company_name.trim() || saving} onClick={save}>
          登録して選ぶ
        </Button>
      </div>
    </div>
  );
}

/**
 * 相関図から施設どうしをつなぐ。ユーザー（受注）・ユーザー以外を問わず2つの施設を選ぶ。
 * 知り合いの園がまだ登録されていなければ、その場で新規登録してつなぐ。
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
  useEffect(() => (a.isNew ? undefined : loadContacts(aId, setA)), [aId]);
  useEffect(() => (b.isNew ? undefined : loadContacts(bId, setB)), [bId]);

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
            {s.isNew && (
              <span className="shrink-0 rounded bg-indigo-50 px-1.5 text-[11px] font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">新規登録</span>
            )}
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
      ) : s.creating != null ? (
        <NewCompanyForm name={s.creating} onCreated={set} onCancel={() => set(emptySide)} />
      ) : (
        <CompanyPicker
          placeholder="施設名・電話・担当者名で検索"
          exclude={other != null ? [other] : []}
          onPick={(c) => set({ company: c, contacts: [], contactId: "" })}
          onCreate={(name) => set({ ...emptySide, creating: name })}
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
