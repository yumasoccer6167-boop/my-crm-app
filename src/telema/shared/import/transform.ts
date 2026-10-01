// 1行を「施設(company)・法人(organization)・担当者(contacts)・元データ(extra)」に変換する

import {
  displayPhone,
  extractDomain,
  normalizeAddress,
  normalizeCompanyName,
  normalizePhone,
  normalizePostalCode,
  splitPostalFromAddress,
  splitPrefectureCity,
  toHalfWidth,
} from "../normalize";
import { MULTI_COLUMN, type ColumnAssignment, type ImportTarget } from "./fields";

export type ColumnMapping = { column: number; header: string; assignment: ColumnAssignment }[];

export type TransformedRow = {
  row_index: number;
  company: {
    company_name: string;
    company_name_normalized: string;
    name_kana: string | null;
    facility_code: string | null;
    corporate_number: string | null;
    phone: string | null;
    phone_normalized: string | null;
    phone_alt: string | null;
    website: string | null;
    website_domain: string | null;
    postal_code: string | null;
    prefecture: string | null;
    city: string | null;
    address: string | null;
    address_normalized: string | null;
    latitude: number | null;
    longitude: number | null;
    google_rating: number | null;
    google_review_count: number | null;
    map_url: string | null;
    industry: string | null;
    employee_count: number | null;
    notes: string | null;
  };
  organization: {
    name: string;
    name_normalized: string;
    name_kana: string | null;
    corporation_type: string | null;
    phone: string | null;
    phone_normalized: string | null;
    postal_code: string | null;
    address: string | null;
    representative_name: string | null;
    representative_title: string | null;
  } | null;
  contact: { name: string | null; role: string | null } | null;
  status_value: string | null;
  assigned_user_value: string | null;
  extra: Record<string, string>;
  errors: string[];
};

const clean = (v: string | undefined | null): string | null => {
  if (v == null) return null;
  const s = String(v).replace(/　/g, " ").trim();
  return s === "" ? null : s;
};

/** Excelの数値セル由来の "9.0" を "9" に */
const tidyNumber = (s: string) => (/^-?\d+\.0+$/.test(s) ? s.replace(/\.0+$/, "") : s);

export function transformRow(values: string[], rowIndex: number, mapping: ColumnMapping): TransformedRow {
  const by = new Map<ImportTarget, string[]>();
  const extra: Record<string, string> = {};
  for (const m of mapping) {
    const v = clean(values[m.column]);
    if (m.assignment === "ignore" || v == null) continue;
    if (m.assignment === "extra") {
      extra[m.header] = tidyNumber(v);
      continue;
    }
    const list = by.get(m.assignment) ?? [];
    list.push(v);
    by.set(m.assignment, list);
  }

  const one = (t: ImportTarget) => by.get(t)?.[0] ?? null;
  const many = (t: ImportTarget) => {
    const list = by.get(t) ?? [];
    if (MULTI_COLUMN[t] === "sum") {
      const nums = list.map((x) => Number(toHalfWidth(x).replace(/[,人名]/g, ""))).filter(Number.isFinite);
      return nums.length ? String(Math.round(nums.reduce((a, b) => a + b, 0))) : null;
    }
    return list.length ? list.map(toHalfWidth).join("") : null;
  };

  const errors: string[] = [];
  const name = one("company_name");
  if (!name) errors.push("会社名・施設名が空です");

  // 住所：「〒232-0002 神奈川県…」形式なら郵便番号を分離
  let address = many("address");
  let postal = normalizePostalCode(one("postal_code"));
  if (address) {
    const sp = splitPostalFromAddress(address);
    address = sp.address;
    postal ??= sp.postal_code;
  }
  const pc = address ? splitPrefectureCity(address) : { prefecture: null, city: null };

  const phoneRaw = one("phone");
  const phone = displayPhone(phoneRaw);
  if (phoneRaw && !normalizePhone(phoneRaw)) errors.push(`電話番号の形式を確認してください（${phoneRaw}）`);

  const website = one("website");
  const num = (v: string | null) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const employees = num(many("employee_count"));

  const orgName = one("organization_name");
  const orgAddress = many("organization_address");
  const organization = orgName
    ? {
        name: orgName,
        name_normalized: normalizeCompanyName(orgName),
        name_kana: one("organization_kana"),
        corporation_type: one("corporation_type"),
        phone: displayPhone(one("organization_phone")),
        phone_normalized: normalizePhone(one("organization_phone")),
        postal_code: normalizePostalCode(one("organization_postal_code")),
        address: orgAddress,
        representative_name: one("representative_name"),
        representative_title: one("representative_title"),
      }
    : null;

  const contactName = one("contact_name");
  const contactTitle = one("contact_title");

  return {
    row_index: rowIndex,
    company: {
      company_name: name ?? "",
      company_name_normalized: normalizeCompanyName(name),
      name_kana: one("name_kana"),
      facility_code: one("facility_code") ? toHalfWidth(one("facility_code")!).replace(/\.0+$/, "") : null,
      corporate_number: one("corporate_number") ? toHalfWidth(one("corporate_number")!).replace(/\D/g, "") || null : null,
      phone,
      phone_normalized: normalizePhone(phoneRaw),
      phone_alt: displayPhone(one("phone_alt")),
      website,
      website_domain: extractDomain(website),
      postal_code: postal,
      prefecture: pc.prefecture,
      city: pc.city,
      address,
      address_normalized: address ? normalizeAddress(address) || null : null,
      latitude: num(one("latitude")),
      longitude: num(one("longitude")),
      google_rating: ((r) => (r != null && r >= 0 && r <= 5 ? r : null))(num(one("google_rating"))),
      google_review_count: ((r) => (r != null && r >= 0 ? Math.round(r) : null))(num(one("google_review_count"))),
      map_url: one("map_url"),
      industry: one("industry"),
      employee_count: employees,
      notes: one("notes"),
    },
    organization,
    contact: contactName || contactTitle ? { name: contactName, role: contactTitle } : null,
    status_value: one("status"),
    assigned_user_value: one("assigned_user"),
    extra,
    errors,
  };
}
