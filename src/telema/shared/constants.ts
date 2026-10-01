export const TEMPERATURES = [
  { value: "unrated", label: "未評価" },
  { value: "low", label: "低" },
  { value: "mid", label: "中" },
  { value: "high", label: "高" },
] as const;
export type Temperature = (typeof TEMPERATURES)[number]["value"];

export const STATUS_CATEGORIES = [
  { value: "not_started", label: "未着手" },
  { value: "in_progress", label: "進行中" },
  { value: "appointment", label: "アポ獲得" },
  { value: "won", label: "受注" },
  { value: "lost", label: "失注・NG" },
  { value: "excluded", label: "対象外" },
] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number]["value"];

export const INFO_SOURCES = ["excel", "csv", "web", "manual", "call", "ai", "verified"] as const;
export type InfoSource = (typeof INFO_SOURCES)[number];

// 架電で直接確認した情報はAI推定より優先する
export const SOURCE_PRIORITY: Record<InfoSource, number> = {
  verified: 6,
  call: 5,
  manual: 4,
  excel: 3,
  csv: 3,
  web: 2,
  ai: 1,
};

export const ROLES = ["admin", "manager", "sales"] as const;
export type Role = (typeof ROLES)[number];
