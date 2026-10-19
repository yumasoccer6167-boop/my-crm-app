import { Crown } from "lucide-react";
import { useState } from "react";
import type { Contact } from "../../types";
import { SOURCE_LABELS } from "../../shared/fields";
import { api, unwrap } from "../../lib/api";
import { Button, Card, Empty, ErrorBox, inputCls } from "../ui";

type Draft = { name: string; department: string; role: string; phone: string; email: string; is_decision_maker: boolean; is_association_chair: boolean; is_association_officer: boolean; notes: string };
const empty: Draft = { name: "", department: "", role: "", phone: "", email: "", is_decision_maker: false, is_association_chair: false, is_association_officer: false, notes: "" };
const toJson = (d: Draft) => ({
  name: d.name.trim() || null,
  department: d.department.trim() || null,
  role: d.role.trim() || null,
  phone: d.phone.trim() || null,
  email: d.email.trim() || null,
  is_decision_maker: d.is_decision_maker,
  is_association_chair: d.is_association_chair,
  is_association_officer: d.is_association_officer,
  notes: d.notes.trim() || null,
});

export function ContactsCard({ companyId, contacts, editable, onSaved }: { companyId: number; contacts: Contact[]; editable: boolean; onSaved: () => void }) {
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [error, setError] = useState<string | null>(null);

  function edit(c?: Contact) {
    setError(null);
    setEditingId(c ? c.id : "new");
    setDraft(
      c
        ? { name: c.name ?? "", department: c.department ?? "", role: c.role ?? "", phone: c.phone ?? "", email: c.email ?? "", is_decision_maker: !!c.is_decision_maker, is_association_chair: !!c.is_association_chair, is_association_officer: !!c.is_association_officer, notes: c.notes ?? "" }
        : empty,
    );
  }

  async function save() {
    try {
      if (editingId === "new") {
        await unwrap(api.companies[":id"].contacts.$post({ param: { id: String(companyId) }, json: toJson(draft) }));
      } else if (editingId) {
        await unwrap(api.contacts[":id"].$patch({ param: { id: String(editingId) }, json: toJson(draft) }));
      }
      setEditingId(null);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deactivate(id: number) {
    if (!confirm("この担当者を無効化しますか？（履歴は残ります）")) return;
    try {
      await unwrap(api.contacts[":id"].$patch({ param: { id: String(id) }, json: { is_active: false } }));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const form = (
    <div className="space-y-2 rounded-md bg-slate-50 p-3">
      <div className="grid grid-cols-2 gap-2">
        <input className={inputCls} placeholder="氏名" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input className={inputCls} placeholder="役職" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
        <input className={inputCls} placeholder="部署" value={draft.department} onChange={(e) => setDraft({ ...draft, department: e.target.value })} />
        <input className={inputCls} placeholder="電話" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
        <input className={`${inputCls} col-span-2`} placeholder="メール" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
        <textarea className={`${inputCls} col-span-2`} rows={2} placeholder="メモ" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.is_decision_maker} onChange={(e) => setDraft({ ...draft, is_decision_maker: e.target.checked })} />
          決裁者
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.is_association_chair} onChange={(e) => setDraft({ ...draft, is_association_chair: e.target.checked })} />
          <Crown className="h-3.5 w-3.5 text-amber-500" aria-hidden />
          協会会長
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.is_association_officer} onChange={(e) => setDraft({ ...draft, is_association_officer: e.target.checked })} />
          <Crown className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          協会役員
        </label>
      </div>
      {error && <ErrorBox message={error} />}
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
          取消
        </Button>
        <Button size="sm" variant="primary" onClick={save}>
          保存
        </Button>
      </div>
    </div>
  );

  return (
    <Card
      title="担当者"
      action={
        editable && editingId === null && (
          <Button size="sm" variant="ghost" onClick={() => edit()}>
            ＋追加
          </Button>
        )
      }
    >
      <div className="space-y-3">
        {editingId === "new" && form}
        {contacts.length === 0 && editingId !== "new" && <Empty>担当者は未判明です</Empty>}
        {contacts.map((c) =>
          editingId === c.id ? (
            <div key={c.id}>{form}</div>
          ) : (
            <div key={c.id} className="group text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900">{c.name ?? "氏名不明"}</span>
                {c.role && <span className="text-slate-600">{c.role}</span>}
                {!!c.is_association_chair && (
                  <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-300">
                    <Crown className="h-3 w-3" aria-hidden />
                    協会会長
                  </span>
                )}
                {!!c.is_association_officer && (
                  <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-300">
                    <Crown className="h-3 w-3" aria-hidden />
                    協会役員
                  </span>
                )}
                {!!c.is_decision_maker && <span className="rounded bg-amber-100 px-1.5 text-[11px] font-medium text-amber-800">決裁者</span>}
                {c.company_id == null && <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-600">法人</span>}
                <span className="text-[10px] text-slate-400">{SOURCE_LABELS[c.source] ?? c.source}</span>
                {editable && (
                  <span className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    <Button size="sm" variant="ghost" onClick={() => edit(c)}>
                      編集
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deactivate(c.id)}>
                      無効化
                    </Button>
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500">{[c.department, c.phone, c.email].filter(Boolean).join(" · ")}</div>
              {c.notes && <div className="mt-0.5 whitespace-pre-wrap text-xs text-slate-600">{c.notes}</div>}
            </div>
          ),
        )}
      </div>
    </Card>
  );
}
