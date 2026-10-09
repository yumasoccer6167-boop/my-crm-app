import { createContext, useContext, type ReactNode } from "react";
import type { AppointmentTemplate } from "./appointment-format";

/** 事例管理（CRM本体の「事例管理」ページ）の事例。カルテとは telemaCompanyId で紐づく */
export type SuccessCase = {
  id: number;
  telemaCompanyId?: number | null;
  industry: string;
  area: string;
  name?: string;
  measure?: string;
  headline: string;
  period?: string;
  problem?: string;
  goals?: string[];
};

/** カルテの情報を反映した事例の追加フォームを、事例管理で開くための初期値 */
export type SuccessCasePrefill = {
  telemaCompanyId: number;
  telemaCompanyName: string;
  name: string;
  industry: string;
  area: string;
  url: string;
  /** 契約情報の商材から決めた、制作内容（絞り込み用の分類）と施策名 */
  tags?: string[];
  measure?: string;
};

// CRM本体（src/App.jsx）から渡されるもの：設定・管理の登録用フォーマット、事例管理の事例、ページ間の移動
type Host = {
  appointmentTemplates: AppointmentTemplate[];
  successCases: SuccessCase[];
  openSuccessCase: (id: number) => void;
  createSuccessCase: (prefill: SuccessCasePrefill) => void;
};
const Ctx = createContext<Host>({ appointmentTemplates: [], successCases: [], openSuccessCase: () => {}, createSuccessCase: () => {} });

export function HostProvider({ value, children }: { value: Host; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAppointmentTemplates = () => useContext(Ctx).appointmentTemplates;
export const useHost = () => useContext(Ctx);
