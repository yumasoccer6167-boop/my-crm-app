// 全日本私立幼稚園連合会の地区（連合会の地区一覧：https://zennichishiyouren.com/rengoukai/office.html）。
// 協会の組織図で、都道府県の協会がどの地区に入るかを、協会の都道府県から決めるのに使う

export const NATIONAL_ASSOCIATION_NAME = "全日本私立幼稚園連合会";

export const REGIONS: { key: string; label: string; prefectures: string[] }[] = [
  { key: "hokkaido", label: "北海道地区", prefectures: ["北海道"] },
  { key: "tohoku", label: "東北地区", prefectures: ["青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"] },
  { key: "kanto", label: "関東地区", prefectures: ["茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "新潟県", "山梨県"] },
  { key: "tokyo", label: "東京地区", prefectures: ["東京都"] },
  { key: "kanagawa", label: "神奈川地区", prefectures: ["神奈川県"] },
  { key: "tokai", label: "東海・北陸地区", prefectures: ["富山県", "石川県", "福井県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県"] },
  { key: "kinki", label: "近畿地区", prefectures: ["滋賀県", "京都府", "兵庫県", "奈良県", "和歌山県"] },
  { key: "osaka", label: "大阪地区", prefectures: ["大阪府"] },
  { key: "chugoku", label: "中国地区", prefectures: ["鳥取県", "島根県", "岡山県", "広島県", "山口県"] },
  { key: "shikoku", label: "四国地区", prefectures: ["徳島県", "香川県", "愛媛県", "高知県"] },
  { key: "kyushu", label: "九州地区", prefectures: ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"] },
];

export const UNKNOWN_REGION = { key: "unknown", label: "地区不明" };

/** 都道府県から地区を決める。分からなければ null */
export function regionOfPrefecture(prefecture: string | null | undefined) {
  return REGIONS.find((r) => prefecture != null && r.prefectures.includes(prefecture)) ?? null;
}
