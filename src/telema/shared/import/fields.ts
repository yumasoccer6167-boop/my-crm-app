// 取り込みの標準項目。Excelの列はこのいずれか（または ignore / extra）に割り当てる

export const IMPORT_TARGETS = {
  // 架電対象（施設・会社）
  company_name: { label: "会社名・施設名", entity: "company" },
  name_kana: { label: "ふりがな", entity: "company" },
  facility_code: { label: "事業所番号", entity: "company" },
  corporate_number: { label: "法人番号", entity: "company" },
  phone: { label: "電話番号", entity: "company" },
  phone_alt: { label: "電話番号(その他)", entity: "company" },
  website: { label: "Webサイト", entity: "company" },
  postal_code: { label: "郵便番号", entity: "company" },
  address: { label: "住所（複数列は結合）", entity: "company" },
  industry: { label: "業種・施設類型", entity: "company" },
  employee_count: { label: "従業員数（複数列は合計）", entity: "company" },
  notes: { label: "備考", entity: "company" },
  latitude: { label: "緯度", entity: "company" },
  google_rating: { label: "口コミ評価", entity: "company" },
  google_review_count: { label: "口コミ数", entity: "company" },
  map_url: { label: "地図URL", entity: "company" },
  longitude: { label: "経度", entity: "company" },
  // 法人
  organization_name: { label: "法人名", entity: "organization" },
  organization_kana: { label: "法人名ふりがな", entity: "organization" },
  corporation_type: { label: "法人格・法人種別", entity: "organization" },
  organization_phone: { label: "法人電話番号", entity: "organization" },
  organization_postal_code: { label: "法人郵便番号", entity: "organization" },
  organization_address: { label: "法人住所（複数列は結合）", entity: "organization" },
  representative_name: { label: "代表者名", entity: "organization" },
  representative_title: { label: "代表者役職", entity: "organization" },
  // 先方担当者
  contact_name: { label: "先方担当者名", entity: "contact" },
  contact_title: { label: "先方担当者役職", entity: "contact" },
  // 自社の営業情報
  assigned_user: { label: "自社営業担当", entity: "sales" },
  status: { label: "ステータス", entity: "sales" },
} as const;

export type ImportTarget = keyof typeof IMPORT_TARGETS;
/** extra = 標準項目にしないが元データとして保持 / ignore = 取り込まない */
export type ColumnAssignment = ImportTarget | "extra" | "ignore";

/** 複数列を1項目に割り当てられる項目と、そのまとめ方 */
export const MULTI_COLUMN: Partial<Record<ImportTarget, "join" | "sum">> = {
  address: "join",
  organization_address: "join",
  employee_count: "sum",
};
