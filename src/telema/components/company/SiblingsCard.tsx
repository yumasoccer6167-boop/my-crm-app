import { useState } from "react";
import { Link } from "react-router";
import type { CompanyListItem, Sibling } from "../../types";
import { api, unwrap } from "../../lib/api";
import { CompanyPicker } from "../CompanyPicker";
import { Button, Card, ErrorBox, inputCls, StatusBadge } from "../ui";

/** 法人と姉妹園（同じ法人の施設）。表記の違いなどで自動でまとまらなかった施設を、手動でまとめる／外す。施設（カルテ）は別々のまま残る */
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
  // どちらにも法人が無いときだけ、法人名を入力してもらう
  const needsName = !organization && !!picked && !picked.organization_name;

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
      await unwrap(api.companies[":id"].siblings.$post({ param: { id: String(companyId) }, json: { company_id: picked.id, organization_name: needsName ? orgName.trim() || null : null, force } }));
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

  async function leave(id: number, name: string) {
    if (!confirm(`「${name}」を、この法人の姉妹園から外しますか？（施設・カルテは残ります）`)) return;
    try {
      await unwrap(api.companies[":id"]["leave-organization"].$post({ param: { id: String(id) } }));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card
      title="法人・姉妹園"
      action={
        editable &&
        !adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            ＋姉妹園を追加
          </Button>
        )
      }
    >
      <div className="space-y-3 text-sm">
        {organization ? (
          <div>
            <div className="font-medium">{String(organization.name)}</div>
            <div className="text-xs text-slate-500">
              {[organization.corporation_type, organization.phone, organization.representative_name && `代表 ${organization.representative_name}`].filter(Boolean).join(" · ")}
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-400">法人が登録されていません。姉妹園を追加すると、法人としてまとまります。</p>
        )}

        {siblings.length > 0 && (
          <div>
            <div className="mb-1 text-xs text-slate-500">姉妹園（{siblings.length}）</div>
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
                        外す
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
            <div className="text-xs text-slate-600">同じ法人の施設（姉妹園）を選ぶと、この施設と同じ法人にまとめます。</div>
            {picked ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-slate-900">{picked.company_name}</span>
                {picked.organization_name && <span className="text-xs text-slate-500">（法人: {picked.organization_name}）</span>}
                <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setPicked(null)}>
                  選び直す
                </button>
              </div>
            ) : (
              <CompanyPicker placeholder="姉妹園を名前・電話・住所で探す" exclude={[companyId, ...siblings.map((s) => s.id)]} autoFocus onPick={setPicked} onError={setError} />
            )}
            {needsName && (
              <label className="block text-xs text-slate-600">
                法人名（どちらの施設にも法人が登録されていないため、入力してください）
                <input className={`${inputCls} mt-1`} value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="例：学校法人○○学園" />
              </label>
            )}
            {error && <ErrorBox message={error} />}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" disabled={busy} onClick={close}>
                取消
              </Button>
              <Button size="sm" variant="primary" disabled={busy || !picked || (needsName && !orgName.trim())} onClick={() => link()}>
                {busy ? "まとめています…" : "まとめる"}
              </Button>
            </div>
          </div>
        )}
        {!adding && error && <ErrorBox message={error} />}
      </div>
    </Card>
  );
}
