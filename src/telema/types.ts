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
  /** 有効な契約情報の件数（ユーザーで0件なら、一覧に「契約情報未登録」を出す） */
  contract_count: number;
  /** 協会会長の担当者がいる施設（一覧で王冠マークを出す） */
  has_association_chair: boolean;
  has_association_officer: boolean;
  /** 訪問ステータス（架電のステータスとは別）。一番新しい訪問記録の訪問の内容。無ければ null */
  visit_purpose_id: number | null;
  visit_purpose_name: string | null;
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
  /** 協会会長（決裁者とは別）。施設一覧では王冠マークで目印にする */
  is_association_chair: number;
  is_association_officer: number;
  notes: string | null;
  source: string;
  confidence: number | null;
  updated_at: string;
};

export type FieldSource = { field: string; source: string; source_ref: string | null; confidence: number | null; updated_at: string };

/** 記録の種類。架電（call）か訪問（visit）。訪問は方法（visit＝訪問／zoom）を持つ */
export type RecordType = "call" | "visit";
export type VisitMethod = "visit" | "zoom";

/** 架電または訪問の記録（タイムラインの1件）。訪問は結果・次回架電・AI整理を持たない */
export type CallLog = {
  id: number;
  record_type: RecordType;
  visit_method: VisitMethod | null;
  /** 訪問の内容（ユーザー訪問・初回訪問・営業）。訪問の記録だけ。null は未設定 */
  visit_purpose_id: number | null;
  visit_purpose_name: string | null;
  /** 訪問の内容が「営業」のときの、商材・月額（円）・期間（cash＝現金一括、12〜84＝か月）。それ以外は null */
  sales_product: string | null;
  sales_monthly_fee: number | null;
  sales_term: string | null;
  /** 結果が「時間設定」のときの、訪問する日時と事前確認の日時 */
  visit_at: string | null;
  precheck_at: string | null;
  /** 対応済みにした時刻（日時を直すと外れる） */
  visit_done_at: string | null;
  precheck_done_at: string | null;
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

/** 契約情報（商材・契約日・納品日・営業担当）。契約日は暦の日付 YYYY-MM-DD */
export type Contract = {
  id: number;
  company_id: number;
  product_name: string;
  contract_date: string;
  /** 納品日（YYYY-MM-DD）。未納品は null */
  delivery_date: string | null;
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
/** 加盟協会のマスタ（設定画面）。parent_id＝親の協会（無ければ都道府県の協会）、prefecture＝都道府県の協会が入る都道府県（未指定なら加盟施設で一番多い都道府県） */
export type AssociationMaster = Association & { parent_id: number | null; prefecture: string | null; is_top_level: number };
/** リスト種類（「繋がり」「群私幼」など。設定画面で管理者が増やせるマスタ） */
export type ListType = Tag;
/** 部署（営業部・制作部・CS など。設定画面で管理者が増やせるマスタ。タイムラインの記録ごとに付ける） */
export type Section = Tag;
/** 訪問の内容（ユーザー訪問・初回訪問・営業。設定画面で管理者が増やせるマスタ。訪問の記録ごとに付ける） */
export type VisitPurpose = Tag;

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

/** 加盟協会の一覧（「協会」タブ：マインドマップ／リスト）。人は、協会会長・協会役員の担当者 */
export type AssociationPerson = { association_id: number; contact_id: number; name: string | null; role: string | null; company_id: number; company_name: string };
export type AssociationOverviewItem = {
  id: number;
  name: string;
  is_active: number;
  sort_order: number;
  facility_count: number;
  organization_count: number;
  user_count: number;
  /** 親の協会（組織図）。null は都道府県の協会 */
  parent_id: number | null;
  /** 1＝組織図の最上位の組織（全日本私立幼稚園連合会と同じ位置。複数登録できる） */
  is_top_level: number;
  /** 協会に指定した都道府県（未指定は null） */
  prefecture_setting: string | null;
  /** 協会に指定した都道府県。指定がなければ、加盟施設で一番多い都道府県（それも無ければ null） */
  prefecture: string | null;
  /** その協会に直接加盟している施設の数（facility_count は下位の協会の施設も含む） */
  own_facility_count: number;
  chairs: AssociationPerson[];
  officers: AssociationPerson[];
};
export type AssociationOverview = {
  associations: AssociationOverviewItem[];
  totals: { association_count: number; facility_count: number; organization_count: number; user_count: number };
};
export type AssociationMember = {
  id: number;
  company_name: string;
  organization_id: number | null;
  organization_name: string | null;
  is_user: number;
  is_headquarters: number;
  prefecture: string | null;
  city: string | null;
  status_label: string | null;
  status_category: string | null;
  has_association_chair: boolean;
  has_association_officer: boolean;
};
export type AssociationMembers = { association: { id: number; name: string }; truncated: boolean; facilities: AssociationMember[] };

/** 同じ加盟協会の施設のまとまり（相関図では線ではなく「★ 協会名」のグループで表示）。2施設以上が加盟している協会だけ */
export type AssociationGroup = { id: number; name: string; members: number[] };

/** マイページの「今日の予定」（訪問予定・訪問前連絡予定・再コール）。id は、訪問・訪問前連絡は架電記録、再コールは施設のID */
export type ScheduleKind = "visit" | "precheck" | "recall";
export type ScheduleItem = {
  id: number;
  company_id: number;
  company_name: string;
  at: string;
  raw_note: string | null;
  contact_name: string | null;
  phone: string | null;
  is_user: number;
  user_name: string | null;
  /** 今日より前の、対応していない予定 */
  overdue: boolean;
};
export type ScheduleToday = Record<ScheduleKind, ScheduleItem[]>;

/** 同じ市区町村のユーザー（カルテに自動で表示） */
export type NearbyUsers = {
  prefecture: string | null;
  city: string | null;
  total: number;
  items: { id: number; company_name: string; city: string | null; organization_name: string | null; address: string | null; chairman_name: string | null; principal_name: string | null }[];
};

/** 姉妹園（同じ法人の他の施設） */
export type Sibling = { id: number; company_name: string; is_user: number; is_headquarters: number; status_label: string | null };

/** CRM本体の顧客リストからの取り込み（管理者）。件数の概要と、1回分（数十〜数百件）の結果 */
export type CustomerImportSummary = { customers: number; imported_customers: number; records: number; imported_records: number };
export type CustomerImportBatch = {
  processed: number;
  created: number;
  merged: number;
  calls: number;
  visits: number;
  contracts: number;
  skipped_records: number;
  relations: number;
  review: { crm_id: number; name: string; reason: string; candidates: { id: number; name: string }[] }[];
  unknown_assignees: Record<string, number>;
  next_after_id: number;
  done: boolean;
  remaining: number;
  applied: boolean;
};

/** 契約一覧CSVの取り込み（管理者）。1回分（数百行）の結果 */
export type ContractImportRow = { line: number; name: string; phone: string; address: string; product: string; date: string; sales: string };
export type ContractImportBatch = {
  rows: number;
  added: number;
  companies: number;
  unmatched: number;
  review: number;
  existing: number;
  duplicate: number;
  no_product: number;
  bad_date: number;
  unmatched_rows: { line: number; name: string; phone: string; address: string; product: string; date: string }[];
  review_rows: { line: number; name: string; phone: string; address: string; product: string; date: string; reason: string; candidates: string[] }[];
  unknown_sales: Record<string, number>;
  basis: Record<string, number>;
  added_keys: string[];
  applied: boolean;
};

/** 同じ加盟協会の施設。協会ごと */
export type AssociationPeers = {
  association_id: number;
  association_name: string;
  total: number;
  peers: { id: number; company_name: string; address: string | null; is_user: number; status_label: string | null; status_category: string | null }[];
};

export type CompanyDetailData = {
  company: Company;
  organization: Record<string, unknown> | null;
  contacts: Contact[];
  sources: { id: number; source_id: number | null; source_row: number | null; created_at: string; name: string | null; source_type: string | null; file_name: string | null }[];
  field_sources: FieldSource[];
  siblings: Sibling[];
  pending_suggestions: number;
  summary_suggestion: SummarySuggestion | null;
  contracts: Contract[];
  associations: Association[];
  list_types: ListType[];
  /** リストを担当者に割り振った記録（タイムラインに「リスト割り振り」として出す） */
  assignments: Assignment[];
};

export type Assignment = { id: number; at: string; assignee_name: string | null };

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
