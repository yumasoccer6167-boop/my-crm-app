// テレマリストAPI（/api/telema/*）のレスポンス型。Python側（telema/*.py）と揃える
import type { Role, STATUS_CATEGORIES } from "./shared/constants";

export type CurrentUser = { id: number; name: string; email: string | null; role: Role };

export type CallStatus = {
  id: number;
  label: string;
  category: (typeof STATUS_CATEGORIES)[number]["value"];
  color: string | null;
  sort_order: number;
  is_active: number;
};
export type UserRow = { id: number; name: string; email: string | null; role: Role; is_active: number };
export type DuplicateCandidate = { id: number; company_name: string; address: string | null; phone: string | null; match: "phone" | "name_address" | "name"; is_user: number };

export type VisitTarget = {
  id: number;
  company_name: string;
  prefecture: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  status_label: string | null;
  last_called_at: string | null;
  assigned_user_id: number | null;
  visited_at: string | null;
};

export type ListSource = { id: number; name: string; source_type: string; description: string | null; created_at: string; company_count: number };

export type CompanyListItem = {
  id: number;
  company_name: string;
  organization_name: string | null;
  phone: string | null;
  city: string | null;
  industry: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  status_id: number | null;
  status_label: string | null;
  status_category: string | null;
  is_user: number;
  temperature: string;
  contact_name: string | null;
  last_called_at: string | null;
  next_call_at: string | null;
  call_count: number;
  assigned_user_id: number | null;
  assigned_user_name: string | null;
  updated_at: string;
  /** 加盟協会・リスト種類の名前（マスタの並び順） */
  associations: string[];
  list_types: string[];
};

export type Company =Record<string, unknown> & {
  id: number;
  organization_id: number | null;
  company_name: string;
  status_id: number | null;
  temperature: string;
  assigned_user_id: number | null;
  extra_attributes: string | null;
};

export type Contact = {
  id: number;
  company_id: number | null;
  organization_id: number | null;
  name: string | null;
  department: string | null;
  role: string | null;
  phone: string | null;
  email: string | null;
  is_decision_maker: number;
  notes: string | null;
  source: string;
  confidence: number | null;
  updated_at: string;
};

export type FieldSource = { field: string; source: string; source_ref: string | null; confidence: number | null; updated_at: string };

export type CallLog = {
  id: number;
  company_id: number;
  contact_id: number | null;
  contact_name: string | null;
  user_id: number | null;
  user_name: string | null;
  called_at: string;
  phone_number: string | null;
  result_status_id: number | null;
  result_label: string | null;
  result_category: string | null;
  /** どの部署の記録か（営業部・制作部・CS など）。null は未分類 */
  section_id: number | null;
  section_name: string | null;
  raw_note: string;
  input_method: string;
  ai_status: string;
  ai_error: string | null;
  ai_summary: string | null;
  ai_extracted_json: string | null;
  ai_next_action: string | null;
  ai_next_call_at: string | null;
  is_active: number;
  created_at: string;
};

/** 契約情報（商材・契約日・営業担当）。契約日は暦の日付 YYYY-MM-DD */
export type Contract = {
  id: number;
  company_id: number;
  product_name: string;
  contract_date: string;
  assigned_user_id: number | null;
  assigned_user_name: string | null;
  product_url: string | null;
  appointment_user_name: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
};

/** 加盟協会（設定画面で管理者が管理するマスタ）。is_active=0 でも、施設に付いている間は表示する */
export type Tag = { id: number; name: string; is_active: number; sort_order?: number };
export type Association = Tag;
/** リスト種類（「繋がり」「群私幼」など。設定画面で管理者が増やせるマスタ） */
export type ListType = Tag;
/** 部署（営業部・制作部・CS など。設定画面で管理者が増やせるマスタ。タイムラインの記録ごとに付ける） */
export type Section = Tag;

/** 架電メモから抽出する項目（仕様書 11章＋つながりやすい時間・推奨ステータス） */
export type CallExtraction = {
  call_result: string | null;
  contact_person: string | null;
  contact_role: string | null;
  interest_level: "high" | "mid" | "low" | "unknown";
  pain_point: string | null;
  current_service: string | null;
  decision_maker: string | null;
  decision_timing: string | null;
  budget: string | null;
  objection: string | null;
  best_time_to_call: string | null;
  next_action: string | null;
  next_call_date: string | null;
  suggested_status: string | null;
  summary: string;
};

/** 会社カルテから見たつながり（相手側の施設・担当者） */
export type RelationItem = {
  id: number;
  other_company_id: number;
  other_company_name: string;
  other_address: string | null;
  other_status_label: string | null;
  other_status_category: string | null;
  other_is_user: number;
  my_contact_id: number | null;
  my_contact_name: string | null;
  other_contact_id: number | null;
  other_contact_name: string | null;
  label: string | null;
  notes: string | null;
  created_at: string;
};

/** 相関図の点＝施設（園名・住所・担当者名をひとまとめにしたもの） */
export type GraphNode = {
  id: number;
  company_name: string;
  address: string | null;
  prefecture: string | null;
  city: string | null;
  contact_name: string | null;
  contact_role: string | null;
  status_label: string | null;
  status_category: string | null;
  is_user: number;
  latitude: number | null;
  longitude: number | null;
};

/** 相関図の線＝知り合い関係 */
export type GraphEdge = {
  id: number;
  source: number;
  target: number;
  source_contact_name: string | null;
  target_contact_name: string | null;
  label: string | null;
  notes: string | null;
};

export type CompanyDetailData = {
  company: Company;
  organization: Record<string, unknown> | null;
  contacts: Contact[];
  sources: { id: number; source_id: number | null; source_row: number | null; created_at: string; name: string | null; source_type: string | null; file_name: string | null }[];
  field_sources: FieldSource[];
  siblings: { id: number; company_name: string; status_label: string | null }[];
  pending_suggestions: number;
  summary_suggestion: SummarySuggestion | null;
  contracts: Contract[];
  associations: Association[];
  list_types: ListType[];
};

/** 施設のAIサマリーの提案（ai_suggestions の suggestion_type = 'summary'） */
export type SummarySuggestion = { id: number; summary: string; next_action: string | null; calls: number; model: string | null; created_at: string };

export type CompanyListData = { total: number | null; page: number; per_page: number; items: CompanyListItem[] };
export type Facet = { value: string; n: number };

type CountKey = "total" | "not_started" | "in_progress" | "appointment" | "won" | "lost" | "excluded" | "due_today" | "overdue" | "updated_today";
export type PrefectureStat = { prefecture: string; total: number; users: number };

export type DashboardData = {
  counts: Record<CountKey, number>;
  my_counts: Record<"total" | "not_started" | "in_progress" | "appointment" | "won" | "lost", number>;
  calls_today: { calls_today: number; companies_called: number };
  companies_needing_review: number;
  today: CompanyListItem[];
};

/** 担当（架電した人）ごと・月ごとの架電数と時間設定成立（アポ）数 */
export type MonthlyCallRow = { month: string; user_id: number | null; user_name: string | null; calls: number; appointments: number };
export type MonthlyCallsData = { months: string[]; rows: MonthlyCallRow[]; appointment_labels: string[] };

type UsageRow = { calls: number; cost_usd: number };
export type AIUsageData = {
  month: string;
  usd_jpy: number;
  budget_usd: number;
  provider: string;
  model: string;
  total: { calls: number; errors: number | null; input_tokens: number; output_tokens: number; cost_usd: number };
  by_day: (UsageRow & { day: string })[];
  by_feature: (UsageRow & { feature: string })[];
  by_user: (UsageRow & { name: string })[];
  by_model: (UsageRow & { provider: string; model: string; input_tokens: number; output_tokens: number })[];
  recent_errors: { created_at: string; feature: string; error: string }[];
};

export type AssigneeMappingItem = { name: string; total: number; unassigned: number };
