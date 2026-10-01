// 重複判定・検索用の正規化。表示用の値は別に保持し、ここで作る値は比較専用。
import { PREFECTURES } from "./prefectures";

/** 全角英数記号→半角、全角スペース→半角、前後空白除去 */
export function toHalfWidth(s: string): string {
  return s
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[　]/g, " ")
    .replace(/[‐－―−ー–—](?=\d)|(?<=\d)[‐－―−ー–—]/g, "-")
    .trim();
}

/** 数字のみ。国際表記 +81 は 0 始まりに戻す */
export function normalizePhone(v: unknown): string | null {
  if (v == null) return null;
  let d = toHalfWidth(String(v)).replace(/\D/g, "");
  if (d.startsWith("81") && d.length >= 11) d = "0" + d.slice(2);
  // Excelの数値セルで先頭0が落ちたケース（例: 452310290 → 0452310290）
  if (d.length === 9 || (d.length === 10 && /^[5789]0/.test(d))) d = "0" + d;
  return d.length >= 10 && d.length <= 11 ? d : null;
}

/** 表示用：ハイフン区切りがあればそのまま、なければ数字を返す */
export function displayPhone(v: unknown): string | null {
  if (v == null) return null;
  const s = toHalfWidth(String(v)).replace(/[^\d-]/g, "");
  return s || null;
}

/** 7桁文字列。数値セル（3060033.0）や先頭0落ち（600001 → 0600001）にも対応 */
export function normalizePostalCode(v: unknown): string | null {
  if (v == null || v === "") return null;
  let s = toHalfWidth(String(v)).replace(/\.0+$/, "").replace(/\D/g, "");
  if (s.length === 6) s = "0" + s;
  return s.length === 7 ? s : null;
}

const CORP_TYPES = [
  "株式会社", "有限会社", "合同会社", "合資会社", "合名会社",
  "社会福祉法人", "学校法人", "医療法人社団", "医療法人財団", "医療法人",
  "一般社団法人", "一般財団法人", "公益社団法人", "公益財団法人",
  "特定非営利活動法人", "NPO法人", "宗教法人", "社会医療法人",
  "(株)", "(有)", "(合)", "(社福)", "(学)", "(医)", "(一社)", "(一財)", "(特非)",
  "㈱", "㈲",
];

/** 比較用の会社名：法人格・空白・記号を除去し、半角・大文字に揃える */
export function normalizeCompanyName(v: unknown): string {
  if (v == null) return "";
  let s = toHalfWidth(String(v)).replace(/[（]/g, "(").replace(/[）]/g, ")");
  for (const t of CORP_TYPES) s = s.split(t).join("");
  return s
    .replace(/[\s・,.、。'"`]/g, "")
    .toUpperCase();
}

/** 施設名の一致判定（表記ゆれ）。「常磐大学 幼稚園」と「常磐大学幼稚園」、「古河市立〇〇」と「〇〇」は一致、「幼稚園」と「こども園」の違いは不一致 */
export function isSameFacilityName(a: unknown, b: unknown): boolean {
  const KANJI_NUM: Record<string, string> = { 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };
  const key = (v: unknown) =>
    normalizeCompanyName(v)
      .replace(/^(.{2,}?[市町村区])立/, "")
      .replace(/\([^)]*\)/g, "") // 読み仮名・旧称などの括弧書き
      .replace(/[ヶヵｹ]/g, "ケ")
      .replace(/[‘’“”]/g, "")
      .replace(/第([一二三四五六七八九])/g, (_, n: string) => `第${KANJI_NUM[n]}`)
      .replace(/^(幼保連携型|幼稚園型|保育所型)?(認定こども園)?(幼保連携型)?/, "");
  // 分園・第二〇〇・駐車場などは電話が同じでも別施設（括弧書きの「（分園）」も見るので括弧を外す前に判定）
  const branch = (v: unknown) =>
    (normalizeCompanyName(v).replace(/第([一二三四五六七八九])/g, (_, n: string) => `第${KANJI_NUM[n]}`).match(/分園|分室|分校|分院|別館|本園|本館|駐車場|第[0-9]+|[0-9]+号/g) ?? [])
      .sort()
      .join();
  if (branch(a) !== branch(b)) return false;
  const x = key(a);
  const y = key(b);
  if (x === y) return true;
  return Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x));
}

/** 比較用の住所：〒・郵便番号・空白を除去、数字の漢数字化はしない（誤爆を避ける） */
export function normalizeAddress(v: unknown): string {
  if (v == null) return "";
  return toHalfWidth(String(v))
    .replace(/〒?\s*\d{3}-?\d{4}/, "")
    .replace(/[\s,、]/g, "")
    .replace(/丁目|番地|番|号/g, "-")
    .replace(/-+/g, "-")
    .replace(/-$/, "")
    .toUpperCase();
}

/** URLからドメイン（www.除去）。GoogleマップなどのURLは会社ドメインではないので除外 */
const NON_COMPANY_DOMAINS = [
  "google.com", "google.co.jp", "goo.gl", "maps.app.goo.gl",
  "facebook.com", "instagram.com", "twitter.com", "x.com", "line.me",
  "ameblo.jp", "hatena.ne.jp", "wixsite.com", "jimdofree.com", "fc2.com",
];
export function extractDomain(v: unknown): string | null {
  if (v == null || v === "") return null;
  let s = toHalfWidth(String(v)).trim();
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try {
    const host = new URL(s).hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".")) return null;
    if (NON_COMPANY_DOMAINS.some((d) => host === d || host.endsWith("." + d))) return null;
    return host;
  } catch {
    return null;
  }
}

/** 住所文字列から郵便番号を分離する（主要都市リストの「〒232-0002 神奈川県…」形式） */
export function splitPostalFromAddress(v: string): { postal_code: string | null; address: string } {
  const s = toHalfWidth(v);
  const m = s.match(/^〒?\s*(\d{3})-?(\d{4})\s*/);
  if (!m) return { postal_code: null, address: s.trim() };
  return { postal_code: m[1]! + m[2]!, address: s.slice(m[0].length).trim() };
}

/** 住所から都道府県・市区町村を取り出す（政令市の区まで含めて city とする） */
export function splitPrefectureCity(address: string): { prefecture: string | null; city: string | null } {
  const s = address.trim();
  const prefecture = PREFECTURES.find((p) => s.startsWith(p)) ?? null;
  const rest = prefecture ? s.slice(prefecture.length) : s;
  const m = rest.match(/^(.+?郡.+?[町村]|.+?市.+?区|.+?[市区町村])/);
  return { prefecture, city: m ? m[1]! : null };
}

/** LIKE検索用のエスケープ（ESCAPE '\' と併用） */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}
