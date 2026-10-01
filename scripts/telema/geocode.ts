/**
 * 管理者用CLI：緯度・経度が空の施設に、住所から位置を入れる（国土地理院の住所検索 API を使う）。
 *
 *   npm run telema:geocode -- --won --dry-run   ユーザー（ステータス区分が受注）だけ、確認のみ
 *   npm run telema:geocode -- --won             ユーザーだけ反映
 *   npm run telema:geocode                      位置の無い施設すべて
 *     [--limit 100]  件数を絞る
 *
 * - 接続先は DATABASE_URL（環境変数 または .env.local）
 * - 検索結果の住所が施設の都道府県と違う場合は採用しない（同じ町名の別の県に当たるのを防ぐ）
 * - API に負担をかけないよう 1件ずつ間隔をあけて問い合わせる
 */
import { connect, describeTarget } from "./db";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = flag("dry-run");
const wonOnly = flag("won");
const limit = Number(opt("limit")) || null;

const API = "https://msearch.gsi.go.jp/address-search/AddressSearch?q=";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Hit = { lat: number; lng: number; title: string };
async function search(address: string): Promise<Hit | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(API + encodeURIComponent(address));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { geometry: { coordinates: [number, number] }; properties: { title: string } }[];
      const f = json[0];
      return f ? { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], title: f.properties.title } : null;
    } catch {
      await sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

/** 住所の後ろにある建物名・部屋番号などは検索の邪魔になるので、番地までにする */
function trimAddress(address: string): string {
  const m = address.match(/^.*?[0-9０-９]+(?:[-－‐ー−丁目番地号の]+[0-9０-９]+)*(?:番地|号)?/);
  return (m ? m[0] : address).trim();
}

const db = await connect();
try {
  const rows = (
    await db.query<{ id: number; company_name: string; prefecture: string | null; city: string | null; address: string | null }>(
      `SELECT c.id, c.company_name, c.prefecture, c.city, c.address FROM telema_companies c
       LEFT JOIN telema_call_statuses s ON s.id = c.status_id
       WHERE c.is_active = 1 AND (c.latitude IS NULL OR c.longitude IS NULL) AND (c.address IS NOT NULL OR c.city IS NOT NULL)
         AND ($1::boolean IS FALSE OR s.category = 'won')
       ORDER BY c.id ${limit ? "LIMIT " + limit : ""}`,
      [wonOnly],
    )
  ).rows;
  console.log(`\n■ 接続先 ${describeTarget()}：位置の無い施設 ${rows.length}件${wonOnly ? "（ユーザーのみ）" : ""}${dryRun ? "（確認のみ）" : ""}`);

  let ok = 0;
  const failed: string[] = [];
  for (const [i, r] of rows.entries()) {
    const q = r.address ? trimAddress(r.address) : `${r.prefecture ?? ""}${r.city ?? ""}`;
    const hit = await search(q);
    if (!hit || (r.prefecture && !hit.title.startsWith(r.prefecture))) {
      failed.push(`  #${r.id} ${r.company_name}：${q}${hit ? ` → ${hit.title}（都道府県が違うため採用せず）` : " → 見つからず"}`);
    } else {
      ok++;
      if (!dryRun)
        await db.query("UPDATE telema_companies SET latitude = $1, longitude = $2, updated_at = telema_now() WHERE id = $3", [hit.lat, hit.lng, r.id]);
    }
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1} / ${rows.length}件…`);
    await sleep(200);
  }
  console.log(`\n✓ 位置を${dryRun ? "取得できる" : "入れた"}施設 ${ok}件 / 取得できなかった施設 ${failed.length}件`);
  if (failed.length) console.log(failed.join("\n"));
} finally {
  await db.end();
}
