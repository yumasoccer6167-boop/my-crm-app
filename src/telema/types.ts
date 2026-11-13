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
export type RecordType = "call" | "visit" | "reply";
/** 営業の訪問記録の結果。即決受注・返事待ち・NG・再営業 */
export type SalesResult = "won" | "waiting" | "ng" | "resales";
/** 初回訪問の訪問記録の結果。営業時間設定（営業の日時を決めた）・見込みなし */
export type FirstResult = "scheduled" | "no_prospect";
export type VisitMethod = "visit" | "zoom";

/** 架電または訪問の記録（タイムラインの1件）。訪問は結果・次回架電・AI整理を持たない */
/** 営業の訪問記録・返事待ち対応の、商材の行。商材ごとに 支払い内容（商品・サーバーの月額と回数、CB）、受注なら受注金額・粗利（円）・台数 を持つ */
export type SalesItem = {
  product: string | null;
  product_monthly: number | null;
  product_term: string | null;
  server_monthly: number | null;
  server_term: string | null;
  cashback: number | null;
  amount: number | null;
  gross_profit: number | null;
  units: number | null;
};

export type CallLog = {
  id: number;
  record_type: RecordType;
  visit_method: VisitMethod | null;
  /** 訪問の内容（ユーザー訪問・初回訪問・営業）。訪問の記録だけ。null は未設定 */
  visit_purpose_id: number | null;
  visit_purpose_name: string | null;
  /** 訪問の内容が「営業」のときの商材（複数のときは先頭）。それ以外は null */
  sales_product: string | null;
  /** 商材の行（複数登録できる）。これまでの記録は空（その場合は sales_* が1件分） */
  sales_items: SalesItem[];
  /** 営業の結果。返事待ち／再営業は次回日時、即決受注は受注金額・粗利（円）・台数を持つ */
  sales_result: SalesResult | null;
  sales_followup_at: string | null;
  sales_amount: number | null;
  sales_gross_profit: number | null;
  sales_units: number | null;
  /** 支払い内容。商品・サーバーの月額（円）と回数（cash＝現金一括、inhouse＝自社回収、12〜84＝回）、CB（キャッシュバック料金・円）。営業の訪問記録は結果によらず、返事待ち対応は受注のときだけ */
  sales_product_monthly: number | null;
  sales_product_term: string | null;
  sales_server_monthly: number | null;
  sales_server_term: string | null;
  sales_cashback: number | null;
  /** 初回訪問の結果。営業時間設定のときは、営業の日時を持つ */
  first_result: FirstResult | null;
  first_followup_at: string | null;
  /** 返事待ち対応の記録が対応している、返事待ちの訪問記録。返事待ちの訪問記録には、対応の結果（受注・NG・再営業）が replied_result に入る */
  reply_to_id: number | null;
  replied_result: SalesResult | null;
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
  /** 台数担当（営業担当とは別に、台数を持つ人） */
  units_user_id: number | null;
  units_user_name: string | null;
  product_url: string | null;
  appointment_user_name: string | null;
  /** 課題（集客・採用・クチコミ対策など） */
  issues: string[];
  memo: string | null;
  /** 受注金額・粗利（円）・台数。未入力は null */
  amount: number | null;
  gross_profit: number | null;
  units: number | null;
  /** 支払い内容。商品・サーバーの月額（円）と回数（cash＝現金一括、inhouse＝自社回収、12〜84＝回）、CB（キャッシュバック料金・円） */
  product_monthly: number | null;
  product_term: string | null;
  server_monthly: number | null;
  server_term: string | null;
  cashback: number | null;
  /** カルテの契約情報だけに付く。company_id が開いている施設と違うものは、同じ法人の施設（姉妹園）の契約 */
  company_name?: string;
  /** その契約の施設を編集できるか（カルテの契約情報だけに付く） */
  can_edit?: boolean;
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
/** 協会カルテ。数字は下位の協会の加盟施設も含む（同じ施設・同じ法人は1回だけ）。ユーザー率＝ユーザー法人 ÷ 加盟法人（%） */
export type AssociationKarte = {
  association: {
    id: number;
    name: string;
    is_active: number;
    parent_id: number | null;
    is_top_level: number;
    prefecture: string | null;
    website_url: string | null;
    chair_name: string | null;
    officer_names: string | null;
    updated_at: string;
    /** 最上位から、この協会までの名前 */
    path: string[];
  };
  metrics: {
    facility_count: number;
    own_facility_count: number;
    organization_count: number;
    user_facility_count: number;
    user_organization_count: number;
    user_rate: number | null;
  };
  industries: { industry: string; count: number; user_count: number }[];
  chairs: Omit<AssociationPerson, "association_id">[];
  officers: Omit<AssociationPerson, "association_id">[];
};
export type AssociationKarteInput = Partial<Pick<AssociationKarte["association"], "website_url" | "chair_name" | "officer_names">>;
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

/** ユーザー分析の元データ：「ユーザー」にチェックが入った施設と、その契約。絞り込みと集計は画面側で行う（issues が空の契約は「課題未選択」） */
export type UserAnalysis = {
  facilities: { id: number; industry: string; prefecture: string; city: string; organization_id: number | null }[];
  contracts: { company_id: number; product: string; issues: string[]; amount: number | null; gross_profit: number | null; units: number | null }[];
};

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

/** 営業結果管理・初回訪問結果管理の1件（訪問記録）。later_* は初回訪問結果管理で、その後に同じ施設で営業の訪問があったか／受注したか */
export type SalesResultItem = {
  id: number;
  record_type: RecordType;
  replied_result: SalesResult | null;
  company_id: number;
  company_name: string;
  called_at: string;
  user_id: number | null;
  user_name: string | null;
  visit_method: VisitMethod | null;
  raw_note: string;
  sales_product: string | null;
  sales_items: SalesItem[];
  sales_product_monthly: number | null;
  sales_product_term: string | null;
  sales_server_monthly: number | null;
  sales_server_term: string | null;
  sales_cashback: number | null;
  sales_result: SalesResult | null;
  sales_followup_at: string | null;
  sales_amount: number | null;
  sales_gross_profit: number | null;
  sales_units: number | null;
  first_result: FirstResult | null;
  first_followup_at: string | null;
  later_sales_visits: number;
  later_won: boolean;
};
export type SalesResultsData = { items: SalesResultItem[]; truncated: boolean; date_from: string; date_to: string };

/** 営業成績表の1行（営業担当ごと） */
export type SalesScoreRow = {
  user_id: number | null;
  user_name: string;
  first_visits: number;
  user_visits: number;
  sales_visits: number;
  reply_won: number;
  reply_ng: number;
  reply_resales: number;
  first_scheduled: number;
  first_no_prospect: number;
  won: number;
  waiting: number;
  ng: number;
  resales: number;
  amount: number;
  gross_profit: number;
  units: number;
};
export type SalesScorecardData = { items: SalesScoreRow[]; date_from: string; date_to: string };

/** 営業ごと・月ごとの目標（粗利・台数・商談数・初回訪問件数・時間設定件数）。未設定の月は null */
export type TargetsData = {
  month: string;
  items: { user_id: number; user_name: string; gross_profit: number | null; units: number | null; deals: number | null; first_visits: number | null; scheduled: number | null }[];
};

/** マイページ：目標と実績の1項目（目標が0なら未設定） */
/** マイルール。フラグ（テレアポ・商談・稼働・営業マン像）・ルールの内容・期待できる成果 */
export type MyRule = { id: number; flag: string; rule: string; outcome: string | null; created_at: string; updated_at: string };
export type MyRules = { flags: string[]; items: MyRule[] };
export type MyPageMetric = "gross_profit" | "units" | "deals" | "first_visits" | "scheduled";
export type MyPageProgress = Record<MyPageMetric, { target: number; actual: number }> & {
  /** 初回訪問時間設定件数（初回訪問の結果が営業時間設定の訪問記録）。時間設定件数（テレアポから）とは別の項目で、目標は持たない */
  scheduled_first: number;
};
export type MyPageData = {
  today: string;
  role: Role;
  /** マネージャー以上のとき、チームの名前（所属の部署）と人数 */
  team_name: string | null;
  team_size: number | null;
  /** 今日のコミット。定量（粗利は円・台数・商談件数）と定性（コメント） */
  commit: { commit_gp: number | null; commit_units: number | null; commit_deals: number | null; comment: string | null; updated_at: string } | null;
  today_workday: boolean;
  workdays_left: number;
  /** 今日の必要数字（円・台・件）。月間目標が0の項目は null */
  daily: Record<"gross_profit" | "units" | "deals", { need: number; done: number; left: number } | null>;
  week: { from: string; to: string; personal: MyPageProgress; team?: MyPageProgress };
  month: { month: string; personal: MyPageProgress; team?: MyPageProgress };
};
export type MyAnalysis = {
  scope: "closed" | "user";
  summary: {
    orders: number;
    deals: number;
    gross_profit: number;
    units: number;
    months: number;
    avg_gross_profit: number | null;
    units_per_deal: number | null;
    monthly_gross_profit: number | null;
    monthly_units: number | null;
  };
  products: { name: string; orders: number; gross_profit: number; avg_gross_profit: number | null }[];
  industries: { name: string; orders: number }[];
  months: { month: string; orders: number; gross_profit: number; units: number }[];
};

/** 数値分析：目標に対する今週・今日のペース。目標が未設定なら target 以降が null */
export type AnalyticsPace = {
  user_id: number;
  month: string;
  today: string;
  week_end: string;
  target: { gross_profit: number; units: number; deals: number; first_visits: number; scheduled: number } | null;
  month_actual: { gross_profit: number; units: number };
  month_remaining: { gross_profit: number; units: number } | null;
  month_workdays_left: number;
  week_workdays_left: number;
  week_need: { gross_profit: number; units: number } | null;
  week_visits_need: number | null;
  today_visits_need: number | null;
  today_visits_left: number | null;
  visits_done_today: number;
  /** 必要な訪問件数に直す元（直近 days 日の、1訪問あたりの粗利・台数） */
  basis: { days: number; visits: number; gross_profit: number; units: number; gross_profit_per_visit: number | null; units_per_visit: number | null };
};

/** 数値分析：期間の実績 */
export type AnalyticsData = {
  user_id: number | null;
  date_from: string;
  date_to: string;
  visits: {
    first_visits: number;
    user_visits: number;
    sales_visits: number;
    won: number;
    waiting: number;
    ng: number;
    resales: number;
    reply_won: number;
    reply_ng: number;
    reply_resales: number;
    first_scheduled: number;
    first_no_prospect: number;
    fall_rate: number | null;
  };
  orders: { orders: number; amount: number; gross_profit: number; units: number; corporations: number; unit_price: number | null; corporation_price: number | null };
  products: { product_name: string; orders: number; units: number; gross_profit: number; avg_gross_profit: number | null; avg_amount: number | null }[];
};

/** カレンダーの予定（記録から自動で出る。種類はサーバーの agenda.py と同じ。再コールは「再コール」ページ） */
export type AgendaKind = "first_visit" | "visit" | "followup" | "precheck";
export type AgendaItem = {
  kind: AgendaKind;
  label: string;
  id: number;
  company_id: number;
  company_name: string;
  user_name: string | null;
  at: string;
  note: string | null;
  done: boolean;
  /** 営業フォローなら「返事待ち」「再営業」 */
  detail: string | null;
};
export type CalendarDay = { day: string; is_workday: boolean; custom: boolean };
/** user_id が null は全員分（稼働日は持たない） */
export type CalendarData = { month: string; user_id: number | null; days: CalendarDay[]; items: AgendaItem[] };
export type WorkdayResult = { user_id: number; day: string; is_workday: boolean; custom: boolean };
/** 再コール一覧：次回架電が入っている施設。counts は範囲で絞る前の全体（week は期限超過を含む） */
export type RecallItem = {
  id: number;
  company_name: string;
  phone: string | null;
  is_user: number;
  at: string;
  next_action: string | null;
  assigned_user_id: number | null;
  assigned_user_name: string | null;
  status_label: string | null;
  status_category: string | null;
  contact_name: string | null;
  overdue: boolean;
};
export type RecallRange = "all" | "overdue" | "today" | "week";
export type RecallsData = { user_id: number | null; range: RecallRange; counts: { overdue: number; today: number; week: number; total: number }; items: RecallItem[] };
/** テレアポ（架電）の集計。接触＝代表（決裁者）／担当（決裁者以外）／宛先未選択。スケジューリング＝結果「初回訪問時間設定」、時間設定件数＝結果が「アポ獲得」区分 */
export type TeleapptMetrics = {
  calls: number;
  rep_contacts: number;
  staff_contacts: number;
  no_contact: number;
  scheduling: number;
  scheduling_rep: number;
  scheduling_staff: number;
  scheduling_unknown: number;
  appointments: number;
  appointments_rep: number;
  appointments_staff: number;
  appointments_unknown: number;
  /** 架電が1件でもあった1時間の区切りの数。1時間あたりコール数＝コール数 ÷ これ */
  active_hours: number;
  calls_per_hour: number | null;
};
export type TeleapptGranularity = "day" | "week" | "month";
export type TeleapptData = {
  granularity: TeleapptGranularity;
  date: string;
  date_from: string;
  date_to: string;
  user_id: number | null;
  totals: TeleapptMetrics;
  rows: (TeleapptMetrics & { key: string; label: string })[];
};

/** 組織図：部署のツリー（parent_id でたどる。兄弟は sort_order 順）と、メンバーのその日時点の所属（department_id が null は所属なし） */
export type OrgDepartment = { id: number; name: string; parent_id: number | null; sort_order: number };
export type OrgMember = { user_id: number; name: string; department_id: number | null; since: string | null };
export type OrgData = { date: string; departments: OrgDepartment[]; members: OrgMember[] };
export type OrgAssignment = { id: number; user_id: number; department_id: number | null; effective_date: string; note: string | null };
export type OrgHistoryItem = { id: number; department_id: number | null; department_name: string | null; effective_date: string; note: string | null };

/** 営業成績ダッシュボードの1行（メンバー、または課・部・事業部の小計）。金額は円（画面ではPに直す）。level は見た目（total＝一番上の合計、group＝部、unit＝課） */
export type SalesBoardRow = {
  kind: "member" | "dept";
  level: "member" | "unit" | "group" | "total";
  name: string;
  depth: number;
  user_id?: number;
  department_id?: number | null;
  target_gp: number;
  target_units: number;
  need_gp: number;
  need_units: number;
  act_gp: number;
  act_units: number;
  contracts: number;
  orders: number;
  rate_gp: number | null;
  rate_units: number | null;
  appo_dm: number;
  appo_staff: number;
  deals: number;
  ng: number;
  rate_fall: number | null;
};
export type SalesBoardData = { month: string; workdays_total: number; workdays_elapsed: number; rows: SalesBoardRow[] };

/** 日報。user_ids は対象メンバー（省略時は自分と同じ部署）、department は見出しに入れた部署名 */
export type DailyReportData = { date: string; user_ids: number[]; members: { id: number; name: string }[]; department: string; next_workday: string; plans: number; text: string };
