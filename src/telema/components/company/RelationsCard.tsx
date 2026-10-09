import { useState } from "react";
import { Link } from "react-router";
import type { CompanyListItem, Contact } from "../../types";
import { api, unwrap } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { CompanyPicker } from "../CompanyPicker";
import { Button, Card, Empty, ErrorBox, inputCls, StatusBadge } from "../ui";

type Draft = { other: CompanyListItem | null; otherContacts: Contact[]; contactId: string; otherContactId: string; label: string; notes: string };
const empty: Draft = { other: null, otherContacts: [], contactId: "", otherContactId: "", label: "", notes: "" };

/** 施設どうしの知り合い関係。相関図（/network）の線になる */
export function RelationsCard({ companyId, contacts, editable }: { companyId: number; contacts: Contact[]; editable: boolean }) {
  const id = String(companyId);
  const list = useApi(() => unwrap(api.companies[":id"].relations.$get({ param: { id } })), [id]);
  // 同じ加盟協会の施設は、登録しなくても自動でつながる（協会名が詳細になる）
  const peers = useApi(() => unwrap(api.companies[":id"]["association-peers"].$get({ param: { id } })), [id]);
  const [openPeers, setOpenPeers] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(empty);
  const [error, setError] = useState<string | null>(null);

  async function pick(other: CompanyListItem) {
    setDraft({ ...draft, other, otherContacts: [], otherContactId: "" });
    try {
      const d = await unwrap(api.companies[":id"].$get({ param: { id: String(other.id) } }));
      setDraft((cur) => (cur.other?.id === other.id ? { ...cur, otherContacts: d.contacts } : cur));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function close() {
    setAdding(false);
    setDraft(empty);
    setError(null);
  }

  async function save() {
    if (!draft.other) return;
    try {
      await unwrap(
        api.companies[":id"].relations.$post({
          param: { id },
          json: {
            other_company_id: draft.other.id,
            contact_id: draft.contactId ? Number(draft.contactId) : null,
            other_contact_id: draft.otherContactId ? Number(draft.otherContactId) : null,
            label: draft.label.trim() || null,
            notes: draft.notes.trim() || null,
          },
        }),
      );
      close();
      void list.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deactivate(relId: number) {
    if (!confirm("このつながりを外しますか？（履歴は残ります）")) return;
    try {
      await unwrap(api.relations[":id"].$patch({ param: { id: String(relId) }, json: { is_active: false } }));
      void list.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const named = (cs: Contact[]) => cs.filter((c) => c.name);
  const form = (
    <div className="space-y-2 rounded-md bg-slate-50 p-3">
      {draft.other ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium text-slate-900">{draft.other.company_name}</span>
          <Button size="sm" variant="ghost" onClick={() => setDraft(empty)}>
            変更
          </Button>
        </div>
      ) : (
        <CompanyPicker placeholder="相手の施設名・電話・担当者名で検索" autoFocus exclude={[companyId]} onPick={pick} onError={setError} />
      )}
      {draft.other && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-500">
            こちらの担当者
            <select className={`${inputCls} mt-0.5`} value={draft.contactId} onChange={(e) => setDraft({ ...draft, contactId: e.target.value })}>
              <option value="">指定なし</option>
              {named(contacts).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.role ? `（${c.role}）` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            相手の担当者
            <select className={`${inputCls} mt-0.5`} value={draft.otherContactId} onChange={(e) => setDraft({ ...draft, otherContactId: e.target.value })}>
              <option value="">指定なし</option>
              {named(draft.otherContacts).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.role ? `（${c.role}）` : ""}
                </option>
              ))}
            </select>
          </label>
          <input className={`${inputCls} col-span-2`} placeholder="関係（例：園長会で知り合い・紹介元）" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          <textarea className={`${inputCls} col-span-2`} rows={2} placeholder="メモ" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
        </div>
      )}
      {error && <ErrorBox message={error} />}
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={close}>
          取消
        </Button>
        <Button size="sm" variant="primary" disabled={!draft.other} onClick={save}>
          つなぐ
        </Button>
      </div>
    </div>
  );

  const items = list.data ?? [];
  return (
    <Card
      title={
        <>
          つながり{items.length > 0 && <span className="ml-1 font-normal text-slate-500">{items.length}</span>}
          <Link to={`/network?focus=${companyId}`} className="ml-2 text-xs font-normal text-indigo-700 hover:underline">
            相関図
          </Link>
        </>
      }
      action={
        editable &&
        !adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            ＋つなぐ
          </Button>
        )
      }
    >
      <div className="space-y-3">
        {adding && form}
        {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
        {!list.error && items.length === 0 && !adding && <Empty>知り合いの施設はまだ登録されていません</Empty>}
        {items.map((r) => (
          <div key={r.id} className="group text-sm">
            <div className="flex items-center gap-2">
              <Link to={`/companies/${r.other_company_id}`} className="truncate font-medium text-indigo-700 hover:underline">
                {r.other_company_name}
              </Link>
              {!!r.other_is_user && (
                <span className="rounded bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">ユーザー</span>
              )}
              {r.other_status_label && <StatusBadge label={r.other_status_label} category={r.other_status_category} />}
              {editable && (
                <span className="ml-auto opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <Button size="sm" variant="ghost" onClick={() => deactivate(r.id)}>
                    外す
                  </Button>
                </span>
              )}
            </div>
            <div className="text-xs text-slate-600">
              {(r.my_contact_name || r.other_contact_name) && (
                <span>
                  {r.my_contact_name ?? "—"} ⇔ {r.other_contact_name ?? "—"}
                </span>
              )}
              {r.label && <span className="ml-2 rounded bg-indigo-50 px-1.5 text-[11px] text-indigo-700">{r.label}</span>}
            </div>
            {r.other_address && <div className="text-xs text-slate-400">{r.other_address}</div>}
            {r.notes && <div className="mt-0.5 whitespace-pre-wrap text-xs text-slate-600">{r.notes}</div>}
          </div>
        ))}
        {(peers.data ?? []).map((g) => (
          <div key={g.association_id} className="rounded-md bg-slate-50 p-2 text-sm ring-1 ring-inset ring-slate-200">
            <button type="button" className="block w-full text-left" onClick={() => setOpenPeers(openPeers === g.association_id ? null : g.association_id)} aria-expanded={openPeers === g.association_id}>
              <span className="flex items-center justify-between gap-2 text-xs text-slate-600">
                <span>同じ加盟協会の園 {g.total}件（自動でつながっています）</span>
                <span className="shrink-0 text-slate-400">{openPeers === g.association_id ? "閉じる" : "開く"}</span>
              </span>
              <span className="mt-1 inline-block break-words rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-700">{g.association_name}</span>
            </button>
            {openPeers === g.association_id && (
              <ul className="mt-2 space-y-1">
                {g.peers.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <Link to={`/companies/${p.id}`} className="truncate font-medium text-indigo-700 hover:underline">
                      {p.company_name}
                    </Link>
                    {!!p.is_user && <span className="rounded bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">ユーザー</span>}
                    {p.status_label && <StatusBadge label={p.status_label} category={p.status_category} />}
                  </li>
                ))}
                {g.total > g.peers.length && <li className="text-xs text-slate-500">ほか {g.total - g.peers.length}件（先頭 {g.peers.length}件を表示）</li>}
                {!g.in_graph && <li className="text-xs text-amber-700">会員数が多いため、相関図には線を引いていません</li>}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
