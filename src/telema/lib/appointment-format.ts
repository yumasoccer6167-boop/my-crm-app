// 「時間設定」の架電結果を、カレンダー・アジェンダに登録するときの文面にする。
// フォーマット本文は CRM 本体の「設定・管理 → 報告フォーマット」で管理する（{{項目名}} の部分に値が自動で入る）
import type { CallLog, Company, Contact } from "../types";

export type AppointmentTemplate = { id: number; name: string; body: string };

/** フォーマットで使える項目（設定画面の説明と同じ並び）。App.jsx の APPOINTMENT_TEMPLATE_VARIABLES と揃えること */
export const APPOINTMENT_VARIABLES = [
  "法人名",
  "園名",
  "住所",
  "TEL",
  "HPリンク",
  "先方担当者",
  "架電者",
  "営業担当",
  "訪問日時",
  "事前確認日時",
  "架電日時",
  "結果",
  "メモ",
] as const;

const wd = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** 登録用の日時表記：2026/10/20(火) 10:00（日本時間） */
export function fmtAppointmentDate(iso: string | null | undefined): string {
  if (!iso) return "未定";
  const p = Object.fromEntries(wd.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}/${p.month}/${p.day}(${p.weekday}) ${p.hour}:${p.minute}`;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function appointmentValues(call: CallLog, company: Company, organization: Record<string, unknown> | null, contacts: Contact[], assignedName: string): Record<string, string> {
  const contact = contacts.find((c) => c.id === call.contact_id);
  return {
    法人名: str(organization?.name),
    園名: company.company_name,
    住所: str(company.address),
    TEL: str(company.phone),
    HPリンク: str(company.website),
    先方担当者: contact ? `${contact.name ?? "氏名不明"}${contact.role ? `（${contact.role}）` : ""}` : (call.contact_name ?? ""),
    架電者: call.user_name ?? "",
    営業担当: assignedName,
    訪問日時: fmtAppointmentDate(call.visit_at),
    事前確認日時: fmtAppointmentDate(call.precheck_at),
    架電日時: fmtAppointmentDate(call.called_at),
    結果: call.result_label ?? "",
    メモ: call.raw_note.trim(),
  };
}

/** {{項目名}} を値に置き換える。知らない項目名はそのまま残す（フォーマットの書き間違いに気づけるように） */
export function fillAppointmentTemplate(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, key: string) => (key in values ? values[key]! : m));
}
