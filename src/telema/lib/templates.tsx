import { createContext, useContext, type ReactNode } from "react";
import type { AppointmentTemplate } from "./appointment-format";

// CRM本体（src/App.jsx）の「設定・管理 → 報告フォーマット」で管理している、カレンダー・アジェンダ登録用のフォーマット
const Ctx = createContext<AppointmentTemplate[]>([]);

export function TemplatesProvider({ appointmentTemplates, children }: { appointmentTemplates: AppointmentTemplate[]; children: ReactNode }) {
  return <Ctx.Provider value={appointmentTemplates}>{children}</Ctx.Provider>;
}

export const useAppointmentTemplates = () => useContext(Ctx);
