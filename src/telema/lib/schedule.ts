import type { ScheduleKind } from "../types";
import { api, unwrap } from "./api";

export const SCHEDULE_LABEL: Record<ScheduleKind, string> = { visit: "訪問予定", precheck: "訪問前連絡予定", recall: "再コール" };

/** 予定を対応済みにする（1件でも、まとめてでも）。訪問・訪問前連絡は記録に済みの印を付け、再コールは次回架電を空にする */
export async function markScheduleDone(items: { kind: ScheduleKind; id: number }[]) {
  return unwrap(api.schedule.done.$post({ json: { items } }));
}
