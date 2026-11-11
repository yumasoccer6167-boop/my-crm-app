import { useState } from "react";
import type { Contract } from "../../types";
import { api, unwrap } from "../../lib/api";
import { CONTRACT_ISSUES } from "../../shared/constants";
import { fmtDate, todayJst } from "../../lib/format";
import { fmtP, pToYen, yenToP } from "../../lib/points";
import { PAYMENT_TERMS, paymentParts } from "../../lib/record-kind";
import { useMasters } from "../../lib/masters";
import { useApi } from "../../lib/useApi";
import { Button, Card, Empty, ErrorBox, inputCls } from "../ui";

type Draft = { product_name: string; contract_date: string; delivery_date: string; assigned_user_id: number | null; units_user_id: number | null; product_url: string; appointment_user_name: string; issues: string[]; memo: string; amount: string; gross_profit: string; units: string; product_monthly: string; product_term: string; server_monthly: string; server_term: string; cashback: string };

const URL_RE = /^https?:\/\/\S+$/;
const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.round(Number(v))));

/** 契約情報（商材・契約日・納品日・営業担当）。1施設に複数件登録できる */
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

  // 営業担当は、一般（sales）でも他のメンバーを選べる。無効になったメンバーでも、いまその契約の営業担当なら選択肢に残す
  const assignees = users.filter((u) => u.is_active || u.id === draft?.assigned_user_id);
  const unitsAssignees = users.filter((u) => u.is_active || u.id === draft?.units_user_id);

  function start(c?: Contract) {
    setError(null);
    setEditingId(c ? c.id : "new");
    setDraft(
      c
        ? {
            product_name: c.product_name,
            contract_date: c.contract_date,
            delivery_date: c.delivery_date ?? "",
            assigned_user_id: c.assigned_user_id,
            units_user_id: c.units_user_id,
            product_url: c.product_url ?? "",
            appointment_user_name: c.appointment_user_name ?? "",
            issues: c.issues ?? [],
            memo: c.memo ?? "",
            amount: c.amount == null ? "" : String(c.amount),
            gross_profit: yenToP(c.gross_profit),
            units: c.units == null ? "" : String(c.units),
            product_monthly: c.product_monthly == null ? "" : String(c.product_monthly),
            product_term: c.product_term ?? "",
            server_monthly: c.server_monthly == null ? "" : String(c.server_monthly),
            server_term: c.server_term ?? "",
            cashback: c.cashback == null ? "" : String(c.cashback),
          }
        : {
            product_name: "",
            contract_date: todayJst(),
            delivery_date: "",
            assigned_user_id: me.role === "sales" ? me.id : (companyAssigneeId ?? me.id),
            units_user_id: null,
            product_url: "",
            appointment_user_name: "",
            issues: [],
            memo: "",
            amount: "",
            gross_profit: "",
            units: "",
            product_monthly: "",
            product_term: "",
            server_monthly: "",
            server_term: "",
            cashback: "",
          },
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
    const product_url = draft.product_url.trim();
    if (product_url && !URL_RE.test(product_url)) return setError("商材のリンクは http:// または https:// から始まるURLで入力してください");
    const json = {
      product_name,
      contract_date: draft.contract_date,
      delivery_date: draft.delivery_date || null,
      assigned_user_id: draft.assigned_user_id,
      units_user_id: draft.units_user_id,
      product_url: product_url || null,
      appointment_user_name: draft.appointment_user_name.trim() || null,
      issues: draft.issues,
      memo: draft.memo.trim() || null,
      amount: num(draft.amount),
      gross_profit: pToYen(draft.gross_profit),
      units: num(draft.units),
      product_monthly: num(draft.product_monthly),
      product_term: draft.product_term || null,
      server_monthly: num(draft.server_monthly),
      server_term: draft.server_term || null,
      cashback: num(draft.cashback),
    };
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

  // 選択肢は決まった一覧。ただし、その契約に保存済みの課題が一覧に無くなっていても、外せるよう末尾に出す
  const issueChoices = [...CONTRACT_ISSUES, ...(draft?.issues ?? []).filter((x) => !(CONTRACT_ISSUES as readonly string[]).includes(x))];

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
        <label className="col-span-2 block">
          <div className="mb-1 text-xs text-slate-500">商材のリンク</div>
          <input
            className={inputCls}
            type="url"
            placeholder="https://…（任意）"
            value={draft.product_url}
            onChange={(e) => setDraft({ ...draft, product_url: e.target.value })}
          />
        </label>
        <label className="block">
          <div className="mb-1 text-xs text-slate-500">契約日</div>
          <input type="date" className={inputCls} value={draft.contract_date} onChange={(e) => setDraft({ ...draft, contract_date: e.target.value })} />
        </label>
        <label className="block">
          <div className="mb-1 text-xs text-slate-500">納品日</div>
          <input type="date" className={inputCls} value={draft.delivery_date} onChange={(e) => setDraft({ ...draft, delivery_date: e.target.value })} />
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
        <label className="block">
          <div className="mb-1 text-xs text-slate-500">台数担当</div>
          <select
            className={inputCls}
            aria-label="台数担当"
            value={draft.units_user_id ?? ""}
            onChange={(e) => setDraft({ ...draft, units_user_id: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">未設定</option>
            {unitsAssignees.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 block">
          <div className="mb-1 text-xs text-slate-500">アポ担当者名</div>
          <input
            className={inputCls}
            list="telema-appointment-users"
            placeholder="アポを取った人の名前（任意）"
            value={draft.appointment_user_name}
            onChange={(e) => setDraft({ ...draft, appointment_user_name: e.target.value })}
          />
          <datalist id="telema-appointment-users">
            {users.map((u) => (
              <option key={u.id} value={u.name} />
            ))}
          </datalist>
        </label>
        <div className="col-span-2 grid grid-cols-3 gap-2">
          {([["amount", "受注金額（円）"], ["gross_profit", "粗利（P）"], ["units", "台数"]] as const).map(([k, label]) => (
            <label key={k} className="block">
              <div className="mb-1 text-xs text-slate-500">{label}</div>
              <input type="number" min={0} step={k === "gross_profit" ? "any" : 1} inputMode={k === "gross_profit" ? "decimal" : "numeric"} className={inputCls} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="col-span-2 grid grid-cols-2 gap-2">
          {([["product_monthly", "商品の月額（円）"], ["server_monthly", "サーバーの月額（円）"]] as const).map(([k, label]) => (
            <label key={k} className="block">
              <div className="mb-1 text-xs text-slate-500">{label}</div>
              <input type="number" min={0} step={1} inputMode="numeric" className={inputCls} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
            </label>
          ))}
          {([["product_term", "商品の回数"], ["server_term", "サーバーの回数"]] as const).map(([k, label]) => (
            <label key={k} className="block">
              <div className="mb-1 text-xs text-slate-500">{label}</div>
              <select className={inputCls} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}>
                <option value="">（未選択）</option>
                {PAYMENT_TERMS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="col-span-2 block">
            <div className="mb-1 text-xs text-slate-500">CB（キャッシュバック料金・円）</div>
            <input type="number" min={0} step={1} inputMode="numeric" className={inputCls} value={draft.cashback} onChange={(e) => setDraft({ ...draft, cashback: e.target.value })} />
          </label>
        </div>
        <div className="col-span-2">
          <div className="mb-1 text-xs text-slate-500">課題（複数選べます）</div>
          <div className="flex flex-wrap gap-1.5">
            {issueChoices.map((name) => {
              const on = draft.issues.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDraft({ ...draft, issues: on ? draft.issues.filter((x) => x !== name) : [...draft.issues, name] })}
                  className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset transition-colors ${on ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
        <label className="col-span-2 block">
          <div className="mb-1 text-xs text-slate-500">メモ</div>
          <textarea className={inputCls} rows={3} maxLength={2000} placeholder="契約についてのメモ（任意）" value={draft.memo} onChange={(e) => setDraft({ ...draft, memo: e.target.value })} />
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
        {contracts.some((c) => c.company_id !== companyId) && <p className="text-xs text-slate-400">同じ法人の施設の契約情報も、共有して表示しています（施設名の付いたもの）。</p>}
        {editingId === "new" && form}
        {contracts.length === 0 && editingId !== "new" && <Empty>契約情報はまだありません</Empty>}
        {contracts.map((c) =>
          editingId === c.id ? (
            <div key={c.id}>{form}</div>
          ) : (
            <div key={c.id} className="group text-sm">
              <div className="flex flex-wrap items-center gap-x-2">
                {c.product_url && URL_RE.test(c.product_url) ? (
                  <a href={c.product_url} target="_blank" rel="noreferrer noopener" title={c.product_url} className="font-medium text-indigo-700 hover:underline">
                    {c.product_name}
                  </a>
                ) : (
                  <span className="font-medium text-slate-900">{c.product_name}</span>
                )}
                {c.company_id !== companyId && c.company_name && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 ring-1 ring-inset ring-slate-200" title="同じ法人の施設の契約情報（共有）">
                    {c.company_name}
                  </span>
                )}
                <span className="whitespace-nowrap text-xs tabular-nums text-slate-500">契約日 {fmtDate(c.contract_date)}</span>
                <span className={`whitespace-nowrap text-xs tabular-nums ${c.delivery_date ? "text-slate-500" : "text-slate-300"}`}>{c.delivery_date ? `納品日 ${fmtDate(c.delivery_date)}` : "納品日 未設定"}</span>
                {(c.can_edit ?? editable) && editingId === null && (
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
              <div className="text-xs text-slate-500">
                営業担当：{c.assigned_user_name ?? "未設定"}
                {c.units_user_name && <span className="ml-2">台数担当：{c.units_user_name}</span>}
                {c.appointment_user_name && <span className="ml-2">アポ担当：{c.appointment_user_name}</span>}
              </div>
              {(c.amount != null || c.gross_profit != null || c.units != null) && (
                <div className="text-xs text-slate-500">
                  {[c.amount != null ? `受注金額 ${c.amount.toLocaleString()}円` : "", c.gross_profit != null ? `粗利 ${fmtP(c.gross_profit)}` : "", c.units != null ? `${c.units}台` : ""].filter(Boolean).join(" ／ ")}
                </div>
              )}
              {paymentParts({ productMonthly: c.product_monthly, productTerm: c.product_term, serverMonthly: c.server_monthly, serverTerm: c.server_term, cashback: c.cashback }).length > 0 && (
                <div className="text-xs text-slate-500">{paymentParts({ productMonthly: c.product_monthly, productTerm: c.product_term, serverMonthly: c.server_monthly, serverTerm: c.server_term, cashback: c.cashback }).join(" ／ ")}</div>
              )}
              {(c.issues ?? []).length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="text-xs text-slate-500">課題：</span>
                  {c.issues.map((name) => (
                    <span key={name} className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
                      {name}
                    </span>
                  ))}
                </div>
              )}
              {c.memo && <p className="mt-1 whitespace-pre-wrap rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">{c.memo}</p>}
            </div>
          ),
        )}
      </div>
    </Card>
  );
}
