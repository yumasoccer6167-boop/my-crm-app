import { useState } from "react";
import { Link } from "react-router";
import type { CompanyListItem, Sibling } from "../../types";
import { api, unwrap } from "../../lib/api";
import { CompanyPicker } from "../CompanyPicker";
import { Button, Card, ErrorBox, inputCls, StatusBadge } from "../ui";

/** 姉妹園（同じ法人の施設）の連携。既存のカルテどうしを、法人名の入力なしで連携させる／外す。施設（カルテ）は別々のまま残る。法人名は任意で、あとから付けられる */
export function SiblingsCard({
  companyId,
  organization,
  siblings,
  editable,
  onChanged,
}: {
  companyId: number;
  organization: Record<string, unknown> | null;
  siblings: Sibling[];
  editable: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<CompanyListItem | null>(null);
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // どちらにも法人が無いときは、法人名を付けて連携することもできる（任意）
  const canName = !organization && !!picked && !picked.organization_name;
  const orgNameText = organization ? String(organization.name ?? "") : "";
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  function close() {
    setAdding(false);
    setPicked(null);
    setOrgName("");
    setError(null);
  }

  async function link(force = false) {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.companies[":id"].siblings.$post({ param: { id: String(companyId) }, json: { company_id: picked.id, organization_name: canName ? orgName.trim() || null : null, force } }));
      close();
      onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 相手が別の法人に属しているときは、移してよいか確認して、もう一度送る
      if (msg.includes("別の法人") && confirm(msg)) await link(true);
      else if (!msg.includes("別の法人")) setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function saveName() {
    setError(null);
    try {
      await unwrap(api.companies[":id"]["organization-name"].$post({ param: { id: String(companyId) }, json: { name: nameDraft.trim() } }));
      setEditingName(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function leave(id: number, name: string) {
    if (!confirm(`「${name}」との姉妹園の連携を解除しますか？（施設・カルテは残ります）`)) return;
    try {
      await unwrap(api.companies[":id"]["leave-organization"].$post({ param: { id: String(id) } }));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card
      title="姉妹園の連携"
      action={
        editable &&
        !adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            ＋既存のカルテと連携
          </Button>
        )
      }
    >
      <div className="space-y-3 text-sm">
        {organization ? (
          <div>
            {editingName ? (
              <div className="flex items-center gap-2">
                <input className={inputCls} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="例：学校法人○○学園" autoFocus />
                <Button size="sm" variant="primary" disabled={!nameDraft.trim()} onClick={saveName}>
                  保存
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingName(false)}>
                  取消
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="font-medium">{orgNameText || <span className="text-xs font-normal text-slate-400">法人名は未登録（姉妹園として連携しています）</span>}</div>
                {editable && (
                  <button
                    type="button"
                    className="text-xs text-indigo-700 hover:underline"
                    onClick={() => {
                      setNameDraft(orgNameText);
                      setEditingName(true);
                    }}
                  >
                    {orgNameText ? "法人名を直す" : "法人名を付ける"}
                  </button>
                )}
              </div>
            )}
            <div className="text-xs text-slate-500">
              {[organization.corporation_type, organization.phone, organization.representative_name && `代表 ${organization.representative_name}`].filter(Boolean).join(" · ")}
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-400">姉妹園（同じ法人の施設）は、既存のカルテどうしを連携させて登録します。新しい施設を作る必要はありません。</p>
        )}

        {siblings.length > 0 && (
          <div>
            <div className="mb-1 text-xs text-slate-500">連携している姉妹園（{siblings.length}）</div>
            <ul className="space-y-1">
              {siblings.map((s) => (
                <li key={s.id} className="group flex items-center justify-between gap-2">
                  <Link to={`/companies/${s.id}`} className="truncate text-indigo-700 hover:underline">
                    {s.company_name}
                  </Link>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {!!s.is_user && <span className="rounded bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">ユーザー</span>}
                    {s.status_label && <StatusBadge label={s.status_label} category={null} />}
                    {editable && (
                      <button type="button" onClick={() => leave(s.id, s.company_name)} className="text-xs text-slate-400 opacity-0 hover:text-rose-600 group-hover:opacity-100 focus:opacity-100">
                        連携を解除
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {adding && (
          <div className="space-y-2 rounded-md bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
            <div className="text-xs text-slate-600">連携したい既存のカルテ（姉妹園）を選んでください。この施設と同じ法人として連携します。</div>
            {picked ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-slate-900">{picked.company_name}</span>
                {picked.organization_name && <span className="text-xs text-slate-500">（法人: {picked.organization_name}）</span>}
                <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setPicked(null)}>
                  選び直す
                </button>
              </div>
            ) : (
              <CompanyPicker placeholder="連携するカルテを名前・電話・住所で探す" exclude={[companyId, ...siblings.map((s) => s.id)]} autoFocus onPick={setPicked} onError={setError} />
            )}
            {canName && (
              <label className="block text-xs text-slate-600">
                法人名（任意。あとからでも付けられます）
                <input className={`${inputCls} mt-1`} value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="例：学校法人○○学園" />
              </label>
            )}
            {error && <ErrorBox message={error} />}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" disabled={busy} onClick={close}>
                取消
              </Button>
              <Button size="sm" variant="primary" disabled={busy || !picked} onClick={() => link()}>
                {busy ? "連携しています…" : "連携する"}
              </Button>
            </div>
          </div>
        )}
        {!adding && error && <ErrorBox message={error} />}
      </div>
    </Card>
  );
}
