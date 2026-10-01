// 会社カルテの項目定義。画面の表示・手動編集・情報源管理・インポートの標準項目で共通に使う

export type FieldGroup = "basic" | "sales";

export const COMPANY_FIELDS = {
  company_name: { label: "会社名・施設名", group: "basic" },
  name_kana: { label: "ふりがな", group: "basic" },
  facility_code: { label: "事業所番号", group: "basic" },
  corporate_number: { label: "法人番号", group: "basic" },
  phone: { label: "電話番号", group: "basic" },
  phone_alt: { label: "電話番号(その他)", group: "basic" },
  website: { label: "Webサイト", group: "basic" },
  postal_code: { label: "郵便番号", group: "basic" },
  address: { label: "住所", group: "basic" },
  industry: { label: "業種・施設類型", group: "basic" },
  employee_count: { label: "従業員数", group: "basic" },
  google_rating: { label: "口コミ評価", group: "basic" },
  google_review_count: { label: "口コミ数", group: "basic" },
  map_url: { label: "地図", group: "basic" },
  notes: { label: "備考", group: "basic" },
  interest: { label: "興味", group: "sales" },
  pain_point: { label: "課題", group: "sales" },
  decision_timing: { label: "導入時期", group: "sales" },
  budget: { label: "予算", group: "sales" },
  current_service: { label: "現在利用サービス", group: "sales" },
  competitor: { label: "競合", group: "sales" },
  ng_reason: { label: "NG理由", group: "sales" },
  next_action: { label: "次回アクション", group: "sales" },
  current_note: { label: "メモ", group: "sales" },
} as const satisfies Record<string, { label: string; group: FieldGroup }>;

export type CompanyField = keyof typeof COMPANY_FIELDS;
export const COMPANY_FIELD_KEYS = Object.keys(COMPANY_FIELDS) as CompanyField[];

export const SOURCE_LABELS: Record<string, string> = {
  excel: "Excel",
  csv: "CSV",
  web: "Web",
  manual: "手入力",
  call: "架電",
  ai: "AI推定",
  verified: "確認済み",
};
