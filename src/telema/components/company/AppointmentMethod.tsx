import type { VisitMethod } from "../../types";
import { VISIT_METHODS } from "../../lib/record-kind";
import { inputCls } from "../ui";

/** 営業予定の方法（訪問／Zoom）。日報の翌アポに「場所 or zoom」として出る。未選択は訪問（場所）として出る */
export function AppointmentMethod({ value, onChange }: { value: VisitMethod | ""; onChange: (v: VisitMethod | "") => void }) {
  return (
    <div>
      <div className="mb-1 text-xs text-slate-500">方法（日報の翌アポに出ます）</div>
      <select value={value} onChange={(e) => onChange(e.target.value as VisitMethod | "")} className={inputCls} aria-label="営業予定の方法">
        <option value="">未設定</option>
        {VISIT_METHODS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
