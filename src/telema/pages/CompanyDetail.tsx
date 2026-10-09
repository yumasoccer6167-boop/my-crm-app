import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { TEMPERATURES } from "../shared/constants";
import { CallEntry } from "../components/company/CallEntry";
import { ContactsCard } from "../components/company/ContactsCard";
import { ContractsCard } from "../components/company/ContractsCard";
import { FieldsCard } from "../components/company/FieldsCard";
import { RelationsCard } from "../components/company/RelationsCard";
import { SuccessCasesCard } from "../components/company/SuccessCasesCard";
import { SummaryCard } from "../components/company/SummaryCard";
import { TagsRow } from "../components/company/TagsRow";
import { Timeline } from "../components/company/Timeline";
import { Button, Card, ErrorBox, Loading, selectCls, StatusBadge } from "../components/ui";
import { api, unwrap } from "../lib/api";
import { fmtDateTime, fmtShort, isOverdue } from "../lib/format";
import { listHref, saveLastOpened } from "../lib/list-query";
import { useMasters } from "../lib/masters";
import { useApi } from "../lib/useApi";

export function CompanyDetail() {
  const { id = "" } = useParams();
  const { me, statuses, users, aiAvailable, associations: associationMaster, listTypes: listTypeMaster } = useMasters();
  const nav = useNavigate();
  const detail = useApi(() => unwrap(api.companies[":id"].$get({ param: { id } })), [id]);
  const calls = useApi(() => unwrap(api.companies[":id"].calls.$get({ param: { id } })), [id]);
  const [patchError, setPatchError] = useState<string | null>(null);
  // リストに戻ったとき、この施設の行までスクロールして目印を付ける
  useEffect(() => {
    if (Number(id)) saveLastOpened(Number(id));
  }, [id]);

  const reloadAll = () => {
    void detail.reload();
    void calls.reload();
  };

  if (detail.error) return <ErrorBox message={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <Loading />;
  const { company, organization, contacts, contracts, associations, list_types, sources, field_sources, siblings, summary_suggestion } = detail.data;
  const status = statuses.find((s) => s.id === company.status_id);
  const editable = me.role !== "sales" || company.assigned_user_id == null || company.assigned_user_id === me.id;
  const keyContact = contacts[0];
  const extra = company.extra_attributes ? (JSON.parse(company.extra_attributes) as Record<string, unknown>) : null;

  async function patch(json: Record<string, unknown>) {
    setPatchError(null);
    try {
      await unwrap(api.companies[":id"].$patch({ param: { id }, json }));
      void detail.reload();
    } catch (e) {
      setPatchError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove() {
    if (!confirm(`「${company.company_name}」をリストから削除します。架電履歴などの記録は残りますが、一覧には表示されなくなります。よろしいですか？`)) return;
    setPatchError(null);
    try {
      await unwrap(api.companies["bulk-delete"].$post({ json: { company_ids: [company.id] } }));
      nav("/companies");
    } catch (e) {
      setPatchError(e instanceof Error ? e.message : String(e));
    }
  }

  const nextCallAt = company.next_call_at as string | null;
  const phone = company.phone as string | null;

  return (
    <div className="space-y-4">
      {/* ヘッダー：次に何をするか・現在の状態・担当者 */}
      <section className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              to={listHref()}
              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
              title="絞り込み条件・並び順・ページはそのままで戻ります"
            >
              ← リストに戻る
            </Link>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">{company.company_name}</h1>
              {/* ユーザー（導入済み）は営業ステータスとは別に持つ */}
              <label
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${company.is_user ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-50 text-slate-500 ring-slate-200"} ${editable ? "cursor-pointer" : ""}`}
              >
                <input type="checkbox" disabled={!editable} checked={!!company.is_user} onChange={(e) => patch({ is_user: e.target.checked })} />
                ユーザー
              </label>
            </div>
            <div className="text-sm text-slate-500">
              {[organization?.name as string | undefined, company.industry as string | null, company.address as string | null].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {phone && (
              <a href={`tel:${phone}`} className="rounded-md bg-indigo-600 px-4 py-2 text-lg font-semibold tabular-nums text-white hover:bg-indigo-700">
                {phone}
              </a>
            )}
            {editable && (
              <Button variant="danger" size="sm" onClick={remove}>
                削除
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <div className="text-xs text-slate-500">次回架電</div>
            <div className={`font-semibold ${isOverdue(nextCallAt) ? "text-rose-600" : "text-slate-900"}`}>{fmtShort(nextCallAt)}</div>
            {company.next_action ? <div className="text-xs text-slate-600">{String(company.next_action)}</div> : null}
          </div>
          <div>
            <div className="text-xs text-slate-500">ステータス</div>
            <div className="mt-0.5">
              <StatusBadge label={status?.label ?? null} category={status?.category ?? null} />
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">温度感</div>
            <select
              disabled={!editable}
              value={company.temperature}
              onChange={(e) => patch({ temperature: e.target.value })}
              className={`${selectCls} mt-0.5 py-0.5`}
            >
              {TEMPERATURES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            {company.ai_temperature ? <span className="ml-2 text-xs text-slate-400">AI推定: {TEMPERATURES.find((t) => t.value === company.ai_temperature)?.label}</span> : null}
          </div>
          <div>
            <div className="text-xs text-slate-500">担当者</div>
            <div className="font-medium text-slate-900">
              {keyContact ? `${keyContact.name ?? "氏名不明"}${keyContact.role ? `（${keyContact.role}）` : ""}` : <span className="text-slate-400">未判明</span>}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">営業担当</div>
            {me.role === "sales" ? (
              <div className="text-slate-900">{users.find((u) => u.id === company.assigned_user_id)?.name ?? "未割当"}</div>
            ) : (
              <select
                value={company.assigned_user_id ?? ""}
                onChange={(e) => patch({ assigned_user_id: e.target.value ? Number(e.target.value) : null })}
                className={`${selectCls} mt-0.5 py-0.5`}
              >
                <option value="">未割当</option>
                {users
                  .filter((u) => u.is_active || u.id === company.assigned_user_id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            )}
          </div>
        </div>
        {patchError && <div className="mt-3"><ErrorBox message={patchError} /></div>}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {editable ? (
            <CallEntry companyId={company.id} company={company} organization={organization} phone={phone} contacts={contacts} isUser={!!company.is_user} onSaved={reloadAll} />
          ) : (
            <div className="rounded-md bg-slate-100 p-3 text-sm text-slate-600">他の営業担当の企業のため、架電・訪問の登録はできません</div>
          )}
          <SummaryCard
            companyId={company.id}
            summary={(company.summary as string | null) ?? null}
            draft={summary_suggestion}
            callCount={calls.data?.filter((c) => c.record_type === "call").length ?? 0}
            editable={editable}
            aiAvailable={aiAvailable}
            onChanged={() => void detail.reload()}
          />
          {calls.error ? (
            <ErrorBox message={calls.error} onRetry={calls.reload} />
          ) : (
            <Timeline calls={calls.data ?? []} contacts={contacts} company={company} organization={organization} nextCallAt={nextCallAt} nextAction={(company.next_action as string | null) ?? null} isUser={!!company.is_user} onChanged={reloadAll} />
          )}
        </div>

        <div className="space-y-4">
          <FieldsCard
            title="営業情報"
            fields={["interest", "pain_point", "decision_timing", "budget", "current_service", "competitor", "ng_reason", "next_action", "current_note"]}
            company={company}
            sources={field_sources}
            editable={editable}
            onSaved={detail.reload}
          />
          <ContractsCard
            companyId={company.id}
            contracts={contracts}
            companyAssigneeId={company.assigned_user_id}
            editable={editable}
            onSaved={detail.reload}
          />
          <SuccessCasesCard company={company} organization={organization} />
          <ContactsCard companyId={company.id} contacts={contacts} editable={editable} onSaved={detail.reload} />
          <RelationsCard companyId={company.id} contacts={contacts} editable={editable} />
          <FieldsCard
            title="基本情報"
            fields={["company_name", "name_kana", "phone", "phone_alt", "postal_code", "address", "website", "industry", "employee_count", "google_rating", "google_review_count", "map_url", "facility_code", "corporate_number", "notes"]}
            company={company}
            sources={field_sources}
            editable={editable}
            onSaved={detail.reload}
            extraRows={
              <>
                <TagsRow
                  label="リスト種類"
                  selected={list_types}
                  master={listTypeMaster}
                  editable={editable}
                  save={(ids) => unwrap(api.companies[":id"]["list-types"].$patch({ param: { id: String(company.id) }, json: { list_type_ids: ids } }))}
                  onSaved={detail.reload}
                  addHint={(isAdmin) => (isAdmin ? "「設定」画面で追加できます。" : "管理者が「設定」画面で追加します。")}
                />
                <TagsRow
                  label="加盟協会"
                  selected={associations}
                  master={associationMaster}
                  editable={editable}
                  save={(ids) => unwrap(api.companies[":id"].associations.$patch({ param: { id: String(company.id) }, json: { association_ids: ids } }))}
                  onSaved={detail.reload}
                  addHint={(isAdmin) => (isAdmin ? "「設定」画面で追加できます。" : "管理者が「設定」画面で追加します。")}
                />
              </>
            }
          />
          {organization && (
            <Card title="法人">
              <div className="text-sm">
                <div className="font-medium">{String(organization.name)}</div>
                <div className="text-xs text-slate-500">
                  {[organization.corporation_type, organization.phone, organization.representative_name && `代表 ${organization.representative_name}`].filter(Boolean).join(" · ")}
                </div>
                {siblings.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1 text-xs text-slate-500">同じ法人の施設（{siblings.length}）</div>
                    <ul className="space-y-1">
                      {siblings.map((s) => (
                        <li key={s.id} className="flex items-center justify-between gap-2">
                          <Link to={`/companies/${s.id}`} className="truncate text-indigo-700 hover:underline">
                            {s.company_name}
                          </Link>
                          {s.status_label && <span className="shrink-0 text-xs text-slate-500">{s.status_label}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          )}
          <Card title="リスト取得元">
            {sources.length ? (
              <ul className="space-y-1 text-sm">
                {sources.map((s) => (
                  <li key={s.id} className="text-slate-700">
                    {s.source_id ? (
                      <Link to={`/companies?source_id=${s.source_id}`} className="text-indigo-700 hover:underline" title="このリストの企業を一覧表示">
                        {s.name ?? s.file_name}
                      </Link>
                    ) : (
                      (s.name ?? s.file_name ?? "手入力")
                    )}
                    {s.source_row != null && <span className="text-xs text-slate-400"> 行{s.source_row}</span>}
                    <span className="ml-2 text-xs text-slate-400">{fmtDateTime(s.created_at)} 取込</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">手入力で登録</p>
            )}
          </Card>
          {extra && Object.keys(extra).length > 0 && (
            <Card title={`元データのその他項目（${Object.keys(extra).length}）`}>
              <details>
                <summary className="cursor-pointer text-sm text-indigo-700">表示する</summary>
                <dl className="mt-2 space-y-1 text-xs">
                  {Object.entries(extra).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-slate-500">{k}</dt>
                      <dd className="whitespace-pre-wrap text-slate-800">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
