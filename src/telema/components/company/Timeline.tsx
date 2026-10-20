import { useState } from "react";
import type { Assignment, CallLog, Company, Contact, VisitMethod } from "../../types";
import { fmtAppointmentDate } from "../../lib/appointment-format";
import { markScheduleDone } from "../../lib/schedule";
import { AppointmentCopy } from "./AppointmentCopy";
import { QUICK } from "./CallEntry";
import { api, unwrap } from "../../lib/api";
import { fmtDateTime, fromLocalInput, isOverdue, quickDate, toLocalInput } from "../../lib/format";
import { useMasters } from "../../lib/masters";
import { callsOfKind, KIND_FILTERS, type KindFilter, SALES_PURPOSE_NAME, salesSummary, VISIT_METHODS, visitMethodLabel } from "../../lib/record-kind";
import { SalesDetailFields, salesPayload, type SalesDetail } from "./SalesDetailFields";
import { ALL_TAB, callsInTab, timelineTabs } from "../../lib/timeline-tabs";
import { Button, Card, CATEGORY_STYLE, Empty, ErrorBox, inputCls, StatusBadge } from "../ui";

const KIND_BADGE: Record<string, string> = {
  call: "bg-slate-100 text-slate-600 ring-slate-200",
  visit: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  zoom: "bg-violet-50 text-violet-700 ring-violet-200",
};

/** 記録の種類のバッジ（架電／訪問／Zoom） */
function KindBadge({ call }: { call: CallLog }) {
  const key = call.record_type === "visit" ? (call.visit_method ?? "visit") : "call";
  const label = call.record_type === "visit" ? visitMethodLabel(call.visit_method) || "訪問" : "架電";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${KIND_BADGE[key]}`}>{label}</span>;
}

/** 過去の架電・訪問の記録を直すフォーム。施設の現在のステータスは、最新の結果を直したときだけ変わる。次回架電は、ここで変えたときだけ施設の予定に反映する */
function CallEditForm({
  call,
  contacts,
  isUser,
  nextCallAt,
  onSaved,
  onCancel,
}: {
  call: CallLog;
  contacts: Contact[];
  isUser: boolean;
  /** 施設の今の次回架電（施設全体の予定。ここで直すと施設の予定が変わる） */
  nextCallAt: string | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { statuses, sections, users, visitPurposes } = useMasters();
  const [purposeId, setPurposeId] = useState<number | null>(call.visit_purpose_id);
  const [sales, setSales] = useState<SalesDetail>({ product: call.sales_product ?? "", fee: call.sales_monthly_fee == null ? "" : String(call.sales_monthly_fee), term: call.sales_term ?? "" });
  const isSalesVisit = call.record_type === "visit" && visitPurposes.find((p) => p.id === purposeId)?.name === SALES_PURPOSE_NAME;
  const [userId, setUserId] = useState<number | null>(call.user_id);
  const [calledAt, setCalledAt] = useState(toLocalInput(call.called_at));
  const [statusId, setStatusId] = useState<number | null>(call.result_status_id);
  const [contactId, setContactId] = useState<number | null>(call.contact_id);
  const [sectionId, setSectionId] = useState<number | null>(call.section_id);
  const [visitMethod, setVisitMethod] = useState<VisitMethod>(call.visit_method ?? "visit");
  const [visitAt, setVisitAt] = useState(toLocalInput(call.visit_at));
  const [precheckAt, setPrecheckAt] = useState(toLocalInput(call.precheck_at));
  const [note, setNote] = useState(call.raw_note);
  const [nextCall, setNextCall] = useState(toLocalInput(nextCallAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 無効になったステータスでも、この履歴が今そのステータスなら選べるように残す
  const isVisit = call.record_type === "visit";
  // 結果が「時間設定」のときだけ、訪問する日時・事前確認日時を設定できる
  const isAppointment = !isVisit && statuses.find((s) => s.id === statusId)?.category === "appointment";
  const options = statuses.filter((s) => (s.is_active && s.category !== "not_started") || s.id === call.result_status_id);
  const noteChanged = note !== call.raw_note;
  const hasAI = call.ai_status === "done" || !!call.ai_summary;

  async function save() {
    const iso = fromLocalInput(calledAt);
    if (!iso) {
      setError("日時を入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await unwrap(
        api.calls[":id"].$patch({
          param: { id: String(call.id) },
          json: {
            raw_note: note,
            called_at: iso,
            contact_id: contactId,
            ...(userId != null && userId !== call.user_id ? { user_id: userId } : {}),
            ...(isVisit
              ? { visit_method: visitMethod, ...(purposeId !== call.visit_purpose_id ? { visit_purpose_id: purposeId } : {}), ...(isSalesVisit ? salesPayload(sales) : {}) }
              : { result_status_id: statusId, visit_at: isAppointment ? fromLocalInput(visitAt) : null, precheck_at: isAppointment ? fromLocalInput(precheckAt) : null }),
            ...(isUser ? { section_id: sectionId } : {}),
            ...(!isVisit && nextCall !== toLocalInput(nextCallAt) ? { next_call_at: nextCall ? fromLocalInput(nextCall) : null } : {}),
          },
        }),
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 space-y-3 rounded-md bg-slate-50 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs text-slate-500">{isVisit ? "訪問日時" : "架電日時"}</div>
          <input type="datetime-local" value={calledAt} onChange={(e) => setCalledAt(e.target.value)} className={inputCls} />
        </div>
        <div>
          <div className="mb-1 text-xs text-slate-500">話した相手</div>
          <select value={contactId ?? ""} onChange={(e) => setContactId(e.target.value ? Number(e.target.value) : null)} className={inputCls}>
            <option value="">（未選択・受付など）</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? "氏名不明"} {c.role && `（${c.role}）`}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs text-slate-500">担当者（この記録を誰の{isVisit ? "訪問" : "架電"}にするか）</div>
        <select value={userId ?? ""} onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : null)} className={`${inputCls} sm:max-w-xs`}>
          {call.user_id == null && <option value="">（未設定）</option>}
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      {isUser && (
        <div>
          <div className="mb-1 text-xs text-slate-500">部署</div>
          <div className="flex flex-wrap gap-1.5">
            {sections
              // 無効にした部署でも、この記録が今その部署なら選択肢に残す
              .filter((s) => s.is_active || s.id === call.section_id)
              .map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSectionId(sectionId === s.id ? null : s.id)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${sectionId === s.id ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
                >
                  {s.name}
                  {!s.is_active && "（無効）"}
                </button>
              ))}
          </div>
        </div>
      )}

      {isVisit && (
        <div>
          <div className="mb-1 text-xs text-slate-500">訪問の内容（現場の内容）</div>
          <div className="flex flex-wrap gap-1.5">
            {visitPurposes
              // 無効にした内容でも、この記録が今その内容なら選択肢に残す
              .filter((p) => p.is_active || p.id === call.visit_purpose_id)
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPurposeId(purposeId === p.id ? null : p.id)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${purposeId === p.id ? "bg-emerald-600 text-white ring-emerald-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
                >
                  {p.name}
                  {!p.is_active && "（無効）"}
                </button>
              ))}
          </div>
        </div>
      )}

      {isSalesVisit && <SalesDetailFields value={sales} onChange={setSales} currentProduct={call.sales_product} />}

      {isVisit && (
        <div>
          <div className="mb-1 text-xs text-slate-500">訪問の方法</div>
          <div className="flex gap-1.5">
            {VISIT_METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setVisitMethod(m.value)}
                className={`rounded px-3 py-1 text-xs font-medium ring-1 ring-inset ${visitMethod === m.value ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isVisit && (
      <div>
        <div className="mb-1 text-xs text-slate-500">結果</div>
        <div className="flex flex-wrap gap-1.5">
          {options.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStatusId(statusId === s.id ? null : s.id)}
              className={`rounded px-2 py-1 text-xs font-medium ring-1 ring-inset ${statusId === s.id ? "bg-indigo-600 text-white ring-indigo-600" : CATEGORY_STYLE[s.category]}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      )}

      {isAppointment && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-slate-500">訪問する日時</div>
            <input type="datetime-local" value={visitAt} onChange={(e) => setVisitAt(e.target.value)} className={inputCls} />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">事前確認日時</div>
            <input type="datetime-local" value={precheckAt} onChange={(e) => setPrecheckAt(e.target.value)} className={inputCls} />
          </div>
        </div>
      )}

      {!isVisit && (
        <div>
          <div className="mb-1 text-xs text-slate-500">次回架電（施設の予定。ここで変えると施設の次回架電が変わります）</div>
          <div className="mb-1.5 flex flex-wrap gap-1">
            {QUICK.map((q) => (
              <Button key={q.kind} size="sm" onClick={() => setNextCall(toLocalInput(quickDate(q.kind)))}>
                {q.label}
              </Button>
            ))}
            {nextCall && (
              <Button size="sm" variant="ghost" onClick={() => setNextCall("")}>
                予定を消す
              </Button>
            )}
          </div>
          <input type="datetime-local" value={nextCall} onChange={(e) => setNextCall(e.target.value)} className={`${inputCls} sm:max-w-xs`} />
        </div>
      )}

      <div>
        <div className="mb-1 text-xs text-slate-500">メモ</div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} className={`${inputCls} resize-y leading-relaxed`} />
        {noteChanged && hasAI && !isVisit && <p className="mt-1 text-xs text-amber-700">メモを変えると、この履歴のAI要約は消えます（保存後に「AIで整理」し直せます）。</p>}
      </div>

      <p className="text-xs text-slate-500">
        {isVisit
          ? "訪問の記録は、施設のステータス・次回架電には影響しません。"
          : "結果の付いた記録で一番新しいものの結果を直すと、施設のステータスもその結果に変わります（古い記録なら変わりません）。次回架電は、変えたときだけ施設の予定に反映されます。"}
      </p>
      {error && <ErrorBox message={`保存できませんでした：${error}`} />}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          取消
        </Button>
        <Button size="sm" variant="primary" disabled={saving} onClick={save}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  );
}

/** 「2026年10月19日」の形（日本時間）。リスト割り振りの表示に使う */
function fmtJaDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

type Entry = { t: string; cl: CallLog; a?: undefined } | { t: string; a: Assignment; cl?: undefined };

export function Timeline({
  calls,
  assignments,
  contacts,
  company,
  organization,
  nextCallAt,
  nextAction,
  isUser,
  editable,
  onChanged,
}: {
  calls: CallLog[];
  /** リストを担当者に割り振った記録。「リスト割り振り」として、記録と日時順に並べて出す */
  assignments: Assignment[];
  contacts: Contact[];
  /** 「時間設定」の記録から、カレンダー・アジェンダ登録用の文面を作るのに使う */
  company: Company;
  organization: Record<string, unknown> | null;
  nextCallAt: string | null;
  nextAction: string | null;
  /** ユーザー（導入済み）の施設なら、タイムラインを部署別（営業部・制作部・CS など）に切り替えて見られる */
  isUser: boolean;
  /** この施設を編集できるか（担当している・未割当・管理者）。次回架電予定などを「対応済み」にできる */
  editable: boolean;
  onChanged: () => void;
}) {
  const { me, aiAvailable, sections } = useMasters();
  const [running, setRunning] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [copyingId, setCopyingId] = useState<number | null>(null);
  const [tab, setTab] = useState(ALL_TAB);
  const [kind, setKind] = useState<KindFilter>("all");

  // 部署のタブはユーザーの施設だけ。選んだタブは、保存や編集で一覧を読み直しても維持する
  // （タブが無くなったとき＝部署の記録が無くなった・無効になった等は「全体」に戻す）
  const tabs = isUser ? timelineTabs(calls, sections) : [];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : ALL_TAB;
  const shown = callsOfKind(isUser ? callsInTab(calls, activeTab) : calls, kind);
  // 次回架電予定は施設全体の予定。部署のタブと、訪問だけの表示には出さない
  const showNext = !!nextCallAt && (!isUser || activeTab === ALL_TAB) && kind !== "visit";
  // リスト割り振りは施設全体の出来事。「すべて」の種類の、部署のタブでは「全体」だけに出す
  const shownAssignments = kind === "all" && (!isUser || activeTab === ALL_TAB) ? assignments : [];
  const entries: Entry[] = [...shown.map((cl): Entry => ({ t: cl.called_at, cl })), ...shownAssignments.map((a): Entry => ({ t: a.at, a }))].sort((x, y) => (x.t < y.t ? 1 : x.t > y.t ? -1 : 0));

  async function analyze(id: number) {
    setRunning(id);
    try {
      await unwrap(api.calls[":id"].analyze.$post({ param: { id: String(id) } }));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
      onChanged();
    }
  }

  /** 予定（次回架電・訪問する日時・事前確認日時）を対応済みにする。表示から消える */
  async function markDone(kind: "recall" | "visit" | "precheck", id: number) {
    try {
      const r = await markScheduleDone([{ kind, id }]);
      if (r.done === 0) alert("対応済みにできませんでした（すでに対応済みか、担当外の予定です）");
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function deactivate(id: number) {
    if (!confirm("この記録を無効化しますか？（データは残り、一覧から非表示になります）")) return;
    try {
      await unwrap(api.calls[":id"].deactivate.$post({ param: { id: String(id) } }));
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card title={`タイムライン（${calls.length}件）`}>
      <div role="tablist" aria-label="記録の種類で切り替え" className="-mt-1 mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-slate-500">種類</span>
        {KIND_FILTERS.map((k) => {
          const count = k.value === "all" ? calls.length : calls.filter((c) => c.record_type === k.value).length;
          return (
            <button
              key={k.value}
              type="button"
              role="tab"
              aria-selected={kind === k.value}
              onClick={() => setKind(k.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${kind === k.value ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
            >
              {k.label}
              <span className={`ml-1 tabular-nums ${kind === k.value ? "text-slate-300" : "text-slate-400"}`}>{count}</span>
            </button>
          );
        })}
      </div>
      {isUser && tabs.length > 1 && (
        <div role="tablist" aria-label="部署で切り替え" className="mb-4 flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={t.key === activeTab}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${t.key === activeTab ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
            >
              {t.label}
              <span className={`ml-1 tabular-nums ${t.key === activeTab ? "text-slate-300" : "text-slate-400"}`}>{t.count}</span>
            </button>
          ))}
        </div>
      )}
      <ol className="relative space-y-5 border-l-2 border-slate-200 pl-5">
        {/* 次回架電予定は施設全体の予定で、部署には属さないので「全体」だけに出す */}
        {showNext && (
          <li className="relative">
            <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-white ${isOverdue(nextCallAt) ? "bg-rose-500" : "bg-indigo-500"}`} />
            <div className="text-sm font-semibold text-indigo-800">
              {fmtDateTime(nextCallAt)} 次回架電予定{isOverdue(nextCallAt) && <span className="ml-2 text-xs text-rose-600">期限超過</span>}
              {editable && (
                <Button size="sm" variant="ghost" className="ml-2 text-indigo-700" onClick={() => markDone("recall", company.id)}>
                  対応済み
                </Button>
              )}
            </div>
            {nextAction && <p className="mt-0.5 text-sm text-slate-700">{nextAction}</p>}
          </li>
        )}
        {entries.map((it) => {
          if (it.a) {
            const a = it.a;
            return (
              <li key={`assign-${a.id}`} className="relative">
                <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-emerald-500 ring-4 ring-white" />
                <div className="text-sm font-medium text-emerald-800">
                  {fmtJaDate(a.at)}、リスト割り振り
                  {a.assignee_name && <span className="ml-2 text-xs font-normal text-slate-500">担当：{a.assignee_name}</span>}
                </div>
              </li>
            );
          }
          const cl = it.cl;
          const canModify = me.role !== "sales" || cl.user_id === me.id;
          return (
            <li key={cl.id} className="group relative">
              <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-slate-400 ring-4 ring-white" />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium tabular-nums text-slate-800">{fmtDateTime(cl.called_at)}</span>
                <KindBadge call={cl} />
                {cl.visit_purpose_name && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">{cl.visit_purpose_name}</span>
                )}
                {cl.result_label && <StatusBadge label={cl.result_label} category={cl.result_category} />}
                {/* 「全体」では、どの部署の記録かが分かるよう部署名を出す（部署のタブの中では、タブで分かるので出さない） */}
                {isUser && activeTab === ALL_TAB && cl.section_name && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-inset ring-slate-200">{cl.section_name}</span>
                )}
                <span className="text-xs text-slate-500">
                  {cl.user_name ?? "—"}
                  {cl.contact_name && ` → ${cl.contact_name}`}
                </span>
                {canModify && editingId !== cl.id && (
                  <span className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(cl.id)}>
                      編集
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deactivate(cl.id)}>
                      無効化
                    </Button>
                  </span>
                )}
              </div>
              {editingId === cl.id ? (
                <CallEditForm
                  call={cl}
                  contacts={contacts}
                  isUser={isUser}
                  nextCallAt={nextCallAt}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => {
                    setEditingId(null);
                    onChanged();
                  }}
                />
              ) : (
                <>
                  {cl.ai_summary && <p className="mt-1 rounded bg-indigo-50 px-2 py-1 text-sm text-indigo-900">AI要約：{cl.ai_summary}</p>}
                  {(cl.visit_at || cl.precheck_at) && (
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-amber-800">
                      {([
                        ["visit", "訪問", cl.visit_at, cl.visit_done_at],
                        ["precheck", "事前確認", cl.precheck_at, cl.precheck_done_at],
                      ] as const).map(([kindKey, label, when, doneAt]) =>
                        when ? (
                          <span key={kindKey} className={doneAt ? "text-slate-400 line-through" : ""}>
                            {label} {fmtAppointmentDate(when)}
                            {doneAt ? (
                              <span className="ml-1 no-underline">（対応済み）</span>
                            ) : (
                              (editable || cl.user_id === me.id) && (
                                <button type="button" className="ml-1.5 rounded px-1.5 text-xs text-indigo-700 hover:bg-indigo-50" onClick={() => markDone(kindKey, cl.id)}>
                                  対応済み
                                </button>
                              )
                            )}
                          </span>
                        ) : null,
                      )}
                    </p>
                  )}
                  {salesSummary(cl) && <p className="mt-1 rounded bg-emerald-50 px-2 py-1 text-sm text-emerald-900">営業：{salesSummary(cl)}</p>}
                  {cl.raw_note && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{cl.raw_note}</p>}
                  {cl.result_category === "appointment" && (
                    <div className="mt-1">
                      {copyingId === cl.id ? (
                        <AppointmentCopy call={cl} company={company} organization={organization} contacts={contacts} onClose={() => setCopyingId(null)} />
                      ) : (
                        <Button size="sm" variant="ghost" className="text-indigo-700" onClick={() => setCopyingId(cl.id)}>
                          カレンダー・アジェンダ登録用にコピー
                        </Button>
                      )}
                    </div>
                  )}
                  {cl.ai_status === "failed" && <p className="mt-1 text-xs text-amber-700">AI整理に失敗しました（メモは保存済み）{cl.ai_error && `：${cl.ai_error}`}</p>}
                  {aiAvailable && cl.raw_note.trim() && cl.record_type === "call" && cl.ai_status !== "done" && canModify && (
                    <Button size="sm" variant="ghost" className="mt-1 text-indigo-700" disabled={running === cl.id} onClick={() => analyze(cl.id)}>
                      {running === cl.id ? "AIで整理中…" : cl.ai_status === "failed" ? "AIで再整理" : "AIで整理"}
                    </Button>
                  )}
                </>
              )}
            </li>
          );
        })}
        {shown.length === 0 && !showNext && (
          <li>
            <Empty>{calls.length === 0 ? "まだ記録がありません" : "この条件の記録はまだありません"}</Empty>
          </li>
        )}
      </ol>
    </Card>
  );
}
