import { useEffect, useState } from "react";
import type { Contact } from "../types";
import { api, ApiRequestError, unwrap } from "../lib/api";
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
 * 相関図から施設どうしをつなぐ。ユーザー（受注）・ユーザー以外を問わず、施設 1 と相手の施設（複数可）を選ぶ。
 * 相手を2つ以上選んだときは「選んだ施設どうしもつなぐ」で全員を知り合いにできる（園長会の仲間など）。
 * 知り合いの園がまだ登録されていなければ、その場で新規登録してつなぐ。
 * 登録は会社カルテと同じ POST /companies/:id/relations を組ごとに呼ぶ（既につながっている組は飛ばす）
 */
export function ConnectForm({ initial, onSaved, onClose }: { initial?: PickedCompany; onSaved: (aId: number) => void; onClose: () => void }) {
  const [a, setA] = useState<Side>({ ...emptySide, company: initial ?? null });
  const [others, setOthers] = useState<Side[]>([]);
  // 相手を追加する欄で、見つからなかった園を新規登録している途中（入力した園名）
  const [adding, setAdding] = useState<string | null>(null);
  const [mesh, setMesh] = useState(false);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const aId = a.company?.id;
  const picked = [aId, ...others.map((o) => o.company?.id)].filter((x): x is number => x != null);

  // 選んだ施設の担当者を読み込む（どの担当者どうしが知り合いかを選べるように）
  useEffect(() => (a.isNew ? undefined : loadContacts(aId, setA)), [aId]);

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

  const updateOther = (id: number, f: (s: Side) => Side) => setOthers((list) => list.map((o) => (o.company?.id === id ? f(o) : o)));
  function addOther(s: Side) {
    setAdding(null);
    setOthers((list) => [...list, s]);
    if (!s.isNew && s.company) loadContacts(s.company.id, (f) => updateOther(s.company!.id, f));
  }

  async function save() {
    if (!a.company || others.length === 0) return;
    const sides = others.filter((o) => o.company);
    const pairs: [Side, Side][] = sides.map((o) => [a, o]);
    if (mesh) for (let i = 0; i < sides.length; i++) for (let j = i + 1; j < sides.length; j++) pairs.push([sides[i]!, sides[j]!]);
    const name = (x: Side) => x.company!.company_name;
    let created = 0;
    let existed = 0;
    const failed: string[] = [];
    setError(null);
    setProgress({ done: 0, total: pairs.length });
    for (const [x, y] of pairs) {
      try {
        await unwrap(
          api.companies[":id"].relations.$post({
            param: { id: String(x.company!.id) },
            json: {
              other_company_id: y.company!.id,
              contact_id: x.contactId ? Number(x.contactId) : null,
              other_contact_id: y.contactId ? Number(y.contactId) : null,
              label: label.trim() || null,
              notes: notes.trim() || null,
            },
          }),
        );
        created++;
      } catch (e) {
        if (e instanceof ApiRequestError && e.code === "conflict") existed++;
        else failed.push(`${name(x)} ⇔ ${name(y)}：${e instanceof Error ? e.message : String(e)}`);
      }
      setProgress((p) => p && { ...p, done: p.done + 1 });
    }
    setProgress(null);
    if (failed.length === 0) {
      onSaved(a.company.id);
      return;
    }
    // 失敗した組だけ残して知らせる（成功した組・既存の組は登録し直しても「既につながっています」になるだけ）
    setError(
      `${created}組をつなぎました${existed ? `（既につながっていた ${existed}組はそのまま）` : ""}。つなげなかった組：\n${failed.join("\n")}`,
    );
  }

  const contactSelect = (s: Side, set: (s: Side) => void) => (
    <select className={inputCls} value={s.contactId} onChange={(e) => set({ ...s, contactId: e.target.value })}>
      <option value="">担当者：指定なし</option>
      {s.contacts.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
          {c.role ? `（${c.role}）` : ""}
        </option>
      ))}
    </select>
  );

  const companyLine = (s: Side, action: { label: string; onClick: () => void }) => (
    <div className="flex items-center gap-1.5 text-sm">
      <span className="min-w-0 truncate font-medium text-slate-900">{s.company!.company_name}</span>
      <UserTag category={s.company!.status_category} />
      {s.isNew && (
        <span className="shrink-0 rounded bg-indigo-50 px-1.5 text-[11px] font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">新規登録</span>
      )}
      <Button size="sm" variant="ghost" className="ml-auto shrink-0 whitespace-nowrap" onClick={action.onClick}>
        {action.label}
      </Button>
    </div>
  );

  const pairCount = others.length + (mesh ? (others.length * (others.length - 1)) / 2 : 0);
  const saving = progress != null;

  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1">
        <div className="text-xs text-slate-500">施設 1</div>
        {a.company ? (
          <>
            {companyLine(a, { label: "変更", onClick: () => setA(emptySide) })}
            {contactSelect(a, setA)}
          </>
        ) : a.creating != null ? (
          <NewCompanyForm name={a.creating} onCreated={setA} onCancel={() => setA(emptySide)} />
        ) : (
          <CompanyPicker
            placeholder="施設名・電話・担当者名で検索"
            exclude={picked}
            onPick={(c) => setA({ company: c, contacts: [], contactId: "" })}
            onCreate={(name) => setA({ ...emptySide, creating: name })}
            onError={setError}
          />
        )}
      </div>
      <div className="text-center text-xs text-slate-400">⇕ 知り合い</div>
      <div className="space-y-1">
        <div className="text-xs text-slate-500">相手の施設（複数選べます{others.length ? `・${others.length}件` : ""}）</div>
        {others.map((o) => (
          <div key={o.company!.id} className="space-y-1 rounded-md p-1.5 ring-1 ring-slate-200">
            {companyLine(o, { label: "外す", onClick: () => setOthers((list) => list.filter((x) => x !== o)) })}
            {contactSelect(o, (next) => updateOther(o.company!.id, () => next))}
          </div>
        ))}
        {adding != null ? (
          <NewCompanyForm name={adding} onCreated={addOther} onCancel={() => setAdding(null)} />
        ) : (
          // 選ぶたびに検索欄を作り直して空にする
          <CompanyPicker
            key={others.length}
            placeholder={others.length ? "さらに追加：施設名・電話・担当者名で検索" : "施設名・電話・担当者名で検索"}
            exclude={picked}
            onPick={(c) => addOther({ company: c, contacts: [], contactId: "" })}
            onCreate={setAdding}
            onError={setError}
          />
        )}
      </div>
      {others.length >= 2 && (
        <label className="flex items-start gap-2 rounded-md bg-slate-50 p-2 text-xs text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={mesh} onChange={(e) => setMesh(e.target.checked)} />
          <span>
            選んだ相手の施設どうしもつなぐ（全員が知り合い）
            <span className="block text-slate-500">園長会の仲間など、全員がお互いを知っている場合</span>
          </span>
        </label>
      )}
      <input className={inputCls} placeholder="関係（例：園長会で知り合い・紹介元）" value={label} onChange={(e) => setLabel(e.target.value)} />
      <textarea className={inputCls} rows={2} placeholder="メモ" value={notes} onChange={(e) => setNotes(e.target.value)} />
      {error && <ErrorBox message={error} />}
      <div className="flex items-center justify-end gap-1">
        {progress && (
          <span className="mr-auto text-xs text-slate-500">
            つないでいます… {progress.done}/{progress.total}
          </span>
        )}
        <Button size="sm" variant="ghost" disabled={saving} onClick={onClose}>
          取消
        </Button>
        <Button size="sm" variant="primary" disabled={!a.company || others.length === 0 || saving} onClick={save}>
          {pairCount > 1 ? `${pairCount}組をつなぐ` : "つなぐ"}
        </Button>
      </div>
    </div>
  );
}
