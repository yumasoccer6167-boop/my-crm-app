import { useState } from "react";
import type { Contract } from "../../types";
import { api, unwrap } from "../../lib/api";
import { fmtDate, todayJst } from "../../lib/format";
import { useMasters } from "../../lib/masters";
import { useApi } from "../../lib/useApi";
import { Button, Card, Empty, ErrorBox, inputCls } from "../ui";

type Draft = { product_name: string; contract_date: string; assigned_user_id: number | null };

/** 契約情報（商材・契約日・営業担当）。1施設に複数件登録できる */
export function ContractsCard({
  companyId,
  contracts,
  companyAssigneeId,
  editable,
  onSaved,
}: {
  companyId: number;
  contracts: Contract[];
  companyAssigneeId: number | null;
  editable: boolean;
  onSaved: () => void;
}) {
  const { me, users } = useMasters();
  const products = useApi(() => unwrap(api.products.$get()), []);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // sales は営業担当に自分しか選べない（サーバーも同じ決まり）
  const assignees = me.role === "sales" ? users.filter((u) => u.id === me.id) : users.filter((u) => u.is_active);

  function start(c?: Contract) {
    setError(null);
    setEditingId(c ? c.id : "new");
    setDraft(
      c
        ? { product_name: c.product_name, contract_date: c.contract_date, assigned_user_id: c.assigned_user_id }
        : { product_name: "", contract_date: todayJst(), assigned_user_id: me.role === "sales" ? me.id : (companyAssigneeId ?? me.id) },
    );
  }

  function cancel() {
    setEditingId(null);
    setDraft(null);
    setError(null);
  }

  async function save() {
    if (!draft) return;
    const product_name = draft.product_name.trim();
    if (!product_name) return setError("商材を入力してください");
    if (!draft.contract_date) return setError("契約日を入力してください");
    const json = { product_name, contract_date: draft.contract_date, assigned_user_id: draft.assigned_user_id };
    setSaving(true);
    setError(null);
    try {
      if (editingId === "new") {
        await unwrap(api.companies[":id"].contracts.$post({ param: { id: String(companyId) }, json }));
      } else if (editingId) {
        await unwrap(api.contracts[":id"].$patch({ param: { id: String(editingId) }, json }));
      }
      cancel();
      onSaved();
      void products.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Contract) {
    if (!confirm(`契約情報「${c.product_name}（${fmtDate(c.contract_date)}）」を削除しますか？（データは残り、画面から非表示になります）`)) return;
    try {
      await unwrap(api.contracts[":id"].$patch({ param: { id: String(c.id) }, json: { is_active: false } }));
      onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  const form = draft && (
    <div className="space-y-2 rounded-md bg-slate-50 p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 block">
          <div className="mb-1 text-xs text-slate-500">商材</div>
          <input
            className={inputCls}
            list="telema-products"
            placeholder="例）SP-MEO"
            value={draft.product_name}
            onChange={(e) => setDraft({ ...draft, product_name: e.target.value })}
          />
          <datalist id="telema-products">
            {(products.data ?? []).map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <div className="mb-1 text-xs text-slate-500">契約日</div>
          <input type="date" className={inputCls} value={draft.contract_date} onChange={(e) => setDraft({ ...draft, contract_date: e.target.value })} />
        </label>
        <label className="block">
          <div className="mb-1 text-xs text-slate-500">営業担当</div>
          <select
            className={inputCls}
            value={draft.assigned_user_id ?? ""}
            onChange={(e) => setDraft({ ...draft, assigned_user_id: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">未設定</option>
            {assignees.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <ErrorBox message={error} />}
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" disabled={saving} onClick={cancel}>
          取消
        </Button>
        <Button size="sm" variant="primary" disabled={saving} onClick={save}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  );

  return (
    <Card
      title={`契約情報（${contracts.length}件）`}
      action={
        editable && editingId === null && (
          <Button size="sm" variant="ghost" onClick={() => start()}>
            ＋追加
          </Button>
        )
      }
    >
      <div className="space-y-3">
        {editingId === "new" && form}
        {contracts.length === 0 && editingId !== "new" && <Empty>契約情報はまだありません</Empty>}
        {contracts.map((c) =>
          editingId === c.id ? (
            <div key={c.id}>{form}</div>
          ) : (
            <div key={c.id} className="group text-sm">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium text-slate-900">{c.product_name}</span>
                <span className="whitespace-nowrap text-xs tabular-nums text-slate-500">{fmtDate(c.contract_date)}</span>
                {editable && editingId === null && (
                  <span className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    <Button size="sm" variant="ghost" onClick={() => start(c)}>
                      編集
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(c)}>
                      削除
                    </Button>
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500">営業担当：{c.assigned_user_name ?? "未設定"}</div>
            </div>
          ),
        )}
      </div>
    </Card>
  );
}
