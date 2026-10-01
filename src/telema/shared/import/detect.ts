// 列の自動認識。①完全一致 ②類似語辞書（接頭語で法人/施設を区別）③データ型判定 の順。
// ④AI判定は STEP 10 で、ここで判定できなかった列にだけ使う。

import { toHalfWidth } from "../normalize";
import type { ColumnAssignment, ImportTarget } from "./fields";

export type Detection = {
  column: number;
  header: string;
  assignment: ColumnAssignment;
  method: "exact" | "dictionary" | "data_type" | "learned" | "none";
  confidence: number;
  note?: string;
};

/** ヘッダー比較用：半角化・空白/記号除去 */
export function normalizeHeader(h: string): string {
  return toHalfWidth(h)
    .replace(/[\s_＿・:：()（）\[\]【】「」]/g, "")
    .toLowerCase();
}

// ① 完全一致（正規化後）
const EXACT: Record<string, ImportTarget> = Object.fromEntries(
  (
    [
      ["会社名", "company_name"], ["法人名", "organization_name"], ["企業名", "company_name"], ["企業名称", "company_name"],
      ["施設名", "company_name"], ["施設の名称", "company_name"], ["店舗名", "company_name"], ["園名", "company_name"],
      ["名称", "company_name"], ["タイトル", "company_name"], ["社名", "company_name"], ["屋号", "company_name"],
      ["ふりがな", "name_kana"], ["フリガナ", "name_kana"], ["施設の名称ふりがな", "name_kana"], ["会社名カナ", "name_kana"],
      ["電話番号", "phone"], ["電話", "phone"], ["tel", "phone"], ["電話番号1", "phone"], ["代表電話", "phone"], ["施設の連絡先電話番号", "phone"],
      ["電話番号2", "phone_alt"], ["施設の連絡先その他連絡先", "phone_alt"], ["fax", "phone_alt"], ["fax番号", "phone_alt"],
      ["url", "website"], ["hp", "website"], ["ホームページ", "website"], ["webサイト", "website"], ["ウェブサイト", "website"], ["サイト", "website"],
      ["郵便番号", "postal_code"], ["〒", "postal_code"],
      ["住所", "address"], ["所在地", "address"], ["施設の所在地都道府県", "address"], ["施設の所在地市区町村", "address"],
      ["施設の所在地町名番地", "address"], ["施設の所在地建物名部屋番号等", "address"],
      ["業種", "industry"], ["カテゴリ", "industry"], ["施設類型", "industry"], ["業態", "industry"], ["事業内容", "industry"],
      ["従業員数", "employee_count"], ["社員数", "employee_count"], ["合計従業者数常勤", "employee_count"], ["合計従業者数非常勤", "employee_count"],
      ["事業所番号", "facility_code"], ["法人番号", "corporate_number"],
      ["備考", "notes"], ["メモ", "notes"],
      ["緯度", "latitude"], ["経度", "longitude"],
      ["評価", "google_rating"], ["口コミ評価", "google_rating"], ["クチコミ評価", "google_rating"], ["星評価", "google_rating"], ["レーティング", "google_rating"], ["rating", "google_rating"],
      ["レビューの数", "google_review_count"], ["レビュー数", "google_review_count"], ["口コミ数", "google_review_count"], ["クチコミ数", "google_review_count"], ["reviews", "google_review_count"],
      ["googleマップurl", "map_url"], ["地図url", "map_url"], ["マップurl", "map_url"],
      ["法人等の名称", "organization_name"], ["法人等の名称ふりがな", "organization_kana"], ["法人等の種類", "corporation_type"], ["法人格", "corporation_type"],
      ["法人等の連絡先電話番号", "organization_phone"], ["法人等の主たる事務所の所在地郵便番号", "organization_postal_code"],
      ["法人等の主たる事務所の所在地都道府県", "organization_address"], ["法人等の主たる事務所の所在地市区町村", "organization_address"],
      ["法人等の主たる事務所の所在地町名番地", "organization_address"], ["法人等の主たる事務所の所在地建物名部屋番号等", "organization_address"],
      ["法人等代表者の氏名", "representative_name"], ["代表者", "representative_name"], ["代表者名", "representative_name"],
      ["法人等代表者の職名", "representative_title"], ["代表者役職", "representative_title"],
      ["施設管理者氏名", "contact_name"], ["担当者名", "contact_name"], ["先方担当者", "contact_name"], ["施設管理者職名", "contact_title"], ["役職", "contact_title"],
      ["営業担当", "assigned_user"], ["営業担当者", "assigned_user"], ["担当営業", "assigned_user"],
      ["状態", "status"], ["ステータス", "status"], ["架電結果", "status"], ["結果", "status"],
    ] as const
  ).map(([k, v]) => [normalizeHeader(k), v]),
);

// ② 類似語辞書：部分一致。上から順に評価し、法人/施設の接頭語で振り分ける
const DICTIONARY: { test: RegExp; target: ImportTarget; unless?: RegExp }[] = [
  { test: /法人.*(電話|tel)/, target: "organization_phone" },
  { test: /法人.*郵便/, target: "organization_postal_code" },
  { test: /法人.*(所在地|住所)/, target: "organization_address" },
  { test: /代表者.*(氏名|名前)/, target: "representative_name" },
  { test: /代表者.*(職|役)/, target: "representative_title" },
  { test: /法人.*(名称|名).*(ふりがな|カナ|かな)/, target: "organization_kana" },
  { test: /法人.*(名称|名)$/, target: "organization_name" },
  { test: /(名称|名).*(ふりがな|フリガナ|カナ|かな)/, target: "name_kana" },
  { test: /(会社|企業|施設|店舗|事業所)(名|の名称)/, target: "company_name", unless: /管理者|担当/ },
  { test: /(電話|tel)/, target: "phone", unless: /携帯|fax|その他/ },
  { test: /fax/, target: "phone_alt" },
  { test: /郵便/, target: "postal_code" },
  { test: /(所在地|住所)/, target: "address" },
  { test: /(ホームページ|webサイト|website|url|hp)$/, target: "website", unless: /map|地図/ },
  { test: /(管理者|担当者).*(氏名|名)/, target: "contact_name", unless: /営業/ },
  { test: /(管理者|担当者).*(職|役)/, target: "contact_title" },
  { test: /(従業員|社員|職員)数/, target: "employee_count" },
  { test: /(業種|業態|施設類型|カテゴリ)/, target: "industry" },
  { test: /(口コミ|クチコミ|レビュー).*(数|件)/, target: "google_review_count" },
  { test: /(口コミ|クチコミ|レビュー).*(評価|点|星)/, target: "google_rating" },
];

// ③ データ型判定：値の形から推定（列名が当てにならない場合）
function detectByData(values: string[]): { target: ImportTarget; confidence: number; note?: string } | null {
  const v = values.map((x) => toHalfWidth(x).trim()).filter(Boolean).slice(0, 200);
  if (v.length < 3) return null;
  const ratio = (re: RegExp) => v.filter((x) => re.test(x)).length / v.length;
  if (ratio(/^0\d{1,4}-?\d{1,4}-?\d{3,4}$/) > 0.8) return { target: "phone", confidence: 0.7 };
  if (ratio(/^〒?\d{3}-?\d{4}(\.0)?$/) > 0.8) return { target: "postal_code", confidence: 0.7 };
  if (ratio(/^\d{13}$/) > 0.8) return { target: "corporate_number", confidence: 0.6 };
  if (ratio(/^(〒\d{3}-?\d{4}\s*)?(北海道|東京都|大阪府|京都府|.{2,3}県)/) > 0.7) return { target: "address", confidence: 0.75 };
  if (ratio(/google\.[a-z.]+\/maps|maps\.app\.goo\.gl/) > 0.5) return { target: "map_url", confidence: 0.85 }; // 地図URLは Webサイトではない
  if (ratio(/^https?:\/\//) > 0.6) return { target: "website", confidence: 0.6 };
  return null;
}

/** 列名の曖昧さを値で検証して補正（主要都市リストの緯度経度の入れ違いなど） */
function verifyWithData(target: ImportTarget, values: string[]): { target: ImportTarget; note?: string } {
  const nums = values.map(Number).filter((n) => Number.isFinite(n) && n !== 0).slice(0, 200);
  if ((target === "latitude" || target === "longitude") && nums.length) {
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    // 日本の緯度は 20〜46、経度は 122〜154
    if (target === "latitude" && avg > 100) return { target: "longitude", note: "値が経度の範囲のため「経度」として扱います" };
    if (target === "longitude" && avg < 50) return { target: "latitude", note: "値が緯度の範囲のため「緯度」として扱います" };
  }
  const mapRatio = values.filter((x) => /google\.[a-z.]+\/maps|maps\.app\.goo\.gl/.test(x)).length / Math.max(values.length, 1);
  if (target === "website" && mapRatio > 0.5) return { target: "map_url", note: "GoogleマップのURLのため「地図URL」として扱います" };
  return { target };
}

/**
 * ヘッダーと列の値サンプルから割り当てを推定する。
 * learned: 利用者が過去に確定した対応（header_normalized → target）
 */
export function detectColumns(headers: string[], sample: string[][], learned: Record<string, ImportTarget> = {}): Detection[] {
  const col = (i: number) => sample.map((r) => r[i] ?? "").filter((x) => x !== "");
  const out: Detection[] = headers.map((header, i) => {
    const n = normalizeHeader(header ?? "");
    const values = col(i);
    const base = { column: i, header };
    if (!n) return { ...base, assignment: "ignore" as const, method: "none" as const, confidence: 1 };
    if (values.length === 0) return { ...base, assignment: "ignore" as const, method: "none" as const, confidence: 0.9, note: "値がすべて空です" };

    let hit: { target: ImportTarget; method: Detection["method"]; confidence: number } | null = null;
    if (learned[n]) hit = { target: learned[n]!, method: "learned", confidence: 0.95 };
    else if (EXACT[n]) hit = { target: EXACT[n]!, method: "exact", confidence: 0.95 };
    else if (n.length <= 25) {
      // 説明文のような長い列名は部分一致で誤認識しやすいので辞書判定しない
      const d = DICTIONARY.find((d) => d.test.test(n) && !(d.unless && d.unless.test(n)));
      if (d) hit = { target: d.target, method: "dictionary", confidence: 0.8 };
    }
    if (hit) {
      const v = verifyWithData(hit.target, values);
      return { ...base, assignment: v.target, method: hit.method, confidence: v.note ? 0.6 : hit.confidence, note: v.note };
    }
    // 値が一部の行にしかない列は型判定しない（評価結果URLなどを Webサイトと誤認しないため）
    const byData = values.length >= sample.length * 0.2 ? detectByData(values) : null;
    if (byData) return { ...base, assignment: byData.target, method: "data_type", confidence: byData.confidence, note: byData.note };
    return { ...base, assignment: "extra", method: "none", confidence: 0.5 };
  });

  // 1列しか持てない項目が重複したら、最初の列（より確からしい列）を残し残りは extra に
  const SINGLE_OK = new Set<string>(["address", "organization_address", "employee_count"]);
  const seen = new Map<string, Detection>();
  for (const d of [...out].sort((a, b) => b.confidence - a.confidence || a.column - b.column)) {
    if (d.assignment === "extra" || d.assignment === "ignore" || SINGLE_OK.has(d.assignment)) continue;
    const prev = seen.get(d.assignment);
    if (!prev) seen.set(d.assignment, d);
    else {
      d.note = `「${prev.header}」と同じ項目の候補のため元データとして保持します`;
      d.assignment = "extra";
      d.confidence = 0.5;
    }
  }
  return out;
}
