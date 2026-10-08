import { useState } from "react";
import type { CallLog, Company, Contact } from "../../types";
import { appointmentValues, fillAppointmentTemplate } from "../../lib/appointment-format";
import { useMasters } from "../../lib/masters";
import { useAppointmentTemplates } from "../../lib/templates";
import { Button, selectCls } from "../ui";

/** クリップボードへ。https でない環境などで navigator.clipboard が使えないときは、選択してコピーする方法に切り替える */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
  }
}

/** 「時間設定」の記録を、カレンダー・アジェンダ登録用のフォーマットに当てはめて、コピーできるようにする */
export function AppointmentCopy({
  call,
  company,
  organization,
  contacts,
  onClose,
}: {
  call: CallLog;
  company: Company;
  organization: Record<string, unknown> | null;
  contacts: Contact[];
  onClose?: () => void;
}) {
  const templates = useAppointmentTemplates();
  const { users } = useMasters();
  const [templateId, setTemplateId] = useState<number | null>(templates[0]?.id ?? null);
  const [copied, setCopied] = useState<"ok" | "ng" | null>(null);
  const template = templates.find((t) => t.id === templateId) ?? templates[0];
  const text = template ? fillAppointmentTemplate(template.body, appointmentValues(call, company, organization, contacts, users.find((u) => u.id === company.assigned_user_id)?.name ?? "")) : "";

  async function copy() {
    setCopied((await copyText(text)) ? "ok" : "ng");
    setTimeout(() => setCopied(null), 2500);
  }

  return (
    <div className="space-y-2 rounded-md bg-indigo-50/60 p-3 ring-1 ring-inset ring-indigo-100">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-800">カレンダー・アジェンダ登録用</span>
        {templates.length > 1 && (
          <select value={template?.id ?? ""} onChange={(e) => setTemplateId(Number(e.target.value))} className={selectCls} aria-label="フォーマット">
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        {onClose && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>
            閉じる
          </Button>
        )}
      </div>
      {template ? (
        <>
          <textarea readOnly value={text} rows={Math.min(14, text.split("\n").length + 1)} onFocus={(e) => e.currentTarget.select()} className="w-full resize-y rounded-md border-0 bg-white px-2.5 py-2 text-sm leading-relaxed text-slate-800 ring-1 ring-inset ring-slate-300" />
          <div className="flex items-center justify-end gap-2">
            {copied === "ok" && <span className="text-sm text-emerald-700">コピーしました</span>}
            {copied === "ng" && <span className="text-sm text-rose-600">コピーできませんでした（文面を選択してコピーしてください）</span>}
            <Button size="sm" variant="primary" onClick={copy}>
              コピー
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-600">登録用のフォーマットがまだありません。「設定・管理」→「報告フォーマット」で追加してください。</p>
      )}
    </div>
  );
}
