/**
 * 電話番号がCSVと一致する施設に、リスト種類・加盟協会をまとめて割り振る管理者用CLI。
 *
 *   npm run telema:tag-phones -- リスト.csv --list-type 繋がり --association "協会A" --association "協会B"          # 確認だけ
 *   npm run telema:tag-phones -- リスト.csv --list-type 繋がり --association "協会A" --association "協会B" --apply  # 割り振る
 *     [--phone-column 電話番号]  電話番号の列名（既定「電話番号」）
 *
 * - 接続先は DATABASE_URL（環境変数 または .env.local）
 * - 照合は、ハイフン・全角などを除いた電話番号の一致（取り込み時の正規化と同じ）。有効な施設だけが対象
 * - 割り振りは「追加」だけ。すでに付いているリスト種類・加盟協会は外さない。すでに付いているものは何も変えない
 * - リスト種類は登録済みのものだけ指定できる（無ければ止まる）。加盟協会は無ければ作る（無効にしてあるものは止まる）
 * - 1つのトランザクションで適用する（途中で失敗したら何も変わらない）
 */
import { readFileSync } from "node:fs";
import { normalizePhone } from "../../src/telema/shared/normalize";
import { parseCsv } from "./csv";
import { connect, describeTarget } from "./db";

// ---------- 引数 ----------
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const optAll = (name: string) => args.flatMap((a, i) => (args[i - 1] === `--${name}` && a !== undefined ? [a] : []));
const input = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!input) throw new Error("CSVファイルを指定してください");
const listTypeName = optAll("list-type")[0];
const associationNames = [...new Set(optAll("association"))];
if (!listTypeName && associationNames.length === 0) throw new Error("--list-type か --association を指定してください");
const phoneColumn = optAll("phone-column")[0] ?? "電話番号";

const table = parseCsv(readFileSync(input, "utf8"));
const header = table[0]?.map((h) => h.trim()) ?? [];
const phoneCol = header.indexOf(phoneColumn);
if (phoneCol < 0) throw new Error(`「${phoneColumn}」列が見つかりません（列: ${header.join(", ")}）`);
const nameCol = header.indexOf("園名");
const csvRows = table.slice(1).map((r, i) => ({ line: i + 2, name: nameCol >= 0 ? (r[nameCol] ?? "") : "", raw: r[phoneCol] ?? "", phone: normalizePhone(r[phoneCol]) }));
const invalid = csvRows.filter((r) => !r.phone);
const phones = [...new Set(csvRows.flatMap((r) => (r.phone ? [r.phone] : [])))];
console.log(`\n■ ${input}  ${csvRows.length}行（電話番号として読めたもの ${csvRows.length - invalid.length}件、重複を除いて ${phones.length}件）`);
for (const r of invalid) console.log(`  ※ ${r.line}行目 ${r.name}：電話番号を読めません「${r.raw}」`);

type Company = { id: number; company_name: string; phone_normalized: string };

const db = await connect();
console.log(`■ 接続先: ${describeTarget()}${apply ? "" : "（確認のみ。--apply で割り振ります）"}`);
try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(72830003)");

  // ---------- 割り振り先（マスタ） ----------
  let listTypeId: number | null = null;
  if (listTypeName) {
    const r = await db.query<{ id: number; is_active: number }>("SELECT id, is_active FROM telema_list_types WHERE name = $1", [listTypeName]);
    if (!r.rows[0]) throw new Error(`リスト種類「${listTypeName}」が登録されていません（テレマリストの「設定」で追加してください）`);
    if (!r.rows[0].is_active) throw new Error(`リスト種類「${listTypeName}」は無効になっています`);
    listTypeId = r.rows[0].id;
  }
  const associations: { name: string; id: number | null }[] = [];
  for (const name of associationNames) {
    const r = await db.query<{ id: number; is_active: number }>("SELECT id, is_active FROM telema_associations WHERE name = $1", [name]);
    if (r.rows[0] && !r.rows[0].is_active) throw new Error(`加盟協会「${name}」は無効になっています`);
    if (r.rows[0]) associations.push({ name, id: r.rows[0].id });
    else if (apply) {
      const c = await db.query<{ id: number }>(
        "INSERT INTO telema_associations (name, sort_order) VALUES ($1, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM telema_associations)) RETURNING id",
        [name],
      );
      associations.push({ name, id: c.rows[0]!.id });
      console.log(`  加盟協会「${name}」が無かったので作成しました`);
    } else {
      associations.push({ name, id: null });
      console.log(`  加盟協会「${name}」は未登録です（--apply のとき作成します）`);
    }
  }

  // ---------- 照合 ----------
  const companies = (await db.query<Company>(
    "SELECT id, company_name, phone_normalized FROM telema_companies WHERE is_active = 1 AND phone_normalized = ANY($1) ORDER BY id", [phones])).rows;
  const matchedPhones = new Set(companies.map((c) => c.phone_normalized));
  const unmatched = csvRows.filter((r) => r.phone && !matchedPhones.has(r.phone));
  const shared = [...matchedPhones].filter((p) => companies.filter((c) => c.phone_normalized === p).length > 1);
  console.log(`\n■ 照合結果: CSVの電話番号 ${phones.length}件のうち ${matchedPhones.size}件がテレマリストの施設と一致（施設 ${companies.length}件）`);
  if (shared.length) console.log(`  ※ 同じ電話番号の施設が複数あるもの ${shared.length}件（該当の施設すべてに割り振ります）: ${shared.join(", ")}`);
  if (unmatched.length) {
    console.log(`  一致なし ${unmatched.length}件（割り振りません）:`);
    for (const r of unmatched) console.log(`    ${r.line}行目 ${r.name} ${r.raw}`);
  }

  // ---------- 割り振り（追加のみ） ----------
  const ids = companies.map((c) => c.id);
  const have = async (link: string, fk: string, tagId: number | null) =>
    new Set(tagId === null ? [] : (await db.query<{ company_id: number }>(`SELECT company_id FROM ${link} WHERE ${fk} = $1 AND company_id = ANY($2)`, [tagId, ids])).rows.map((r) => r.company_id));
  const plans: { label: string; link: string; fk: string; ids_key: string; audit: string; tagId: number | null }[] = [];
  if (listTypeId !== null) plans.push({ label: `リスト種類「${listTypeName}」`, link: "telema_company_list_types", fk: "list_type_id", ids_key: "list_type_ids", audit: "company_list_types", tagId: listTypeId });
  for (const a of associations) plans.push({ label: `加盟協会「${a.name}」`, link: "telema_company_associations", fk: "association_id", ids_key: "association_ids", audit: "company_associations", tagId: a.id });

  const changed = new Map<number, { before: Record<string, number[]>; after: Record<string, number[]> }>();
  for (const p of plans) {
    const already = await have(p.link, p.fk, p.tagId);
    const targets = companies.filter((c) => !already.has(c.id));
    console.log(`  ${p.label}: 新しく付ける ${targets.length}件 / すでに付いている ${companies.length - targets.length}件`);
    if (!apply || p.tagId === null) continue;
    for (const c of targets) {
      const rec = changed.get(c.id) ?? { before: {}, after: {} };
      const cur = (await db.query<{ tag_id: number }>(`SELECT ${p.fk} AS tag_id FROM ${p.link} WHERE company_id = $1 ORDER BY 1`, [c.id])).rows.map((r) => r.tag_id);
      rec.before[p.audit + ":" + p.ids_key] ??= cur;
      await db.query(`INSERT INTO ${p.link} (company_id, ${p.fk}) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [c.id, p.tagId]);
      const next = (await db.query<{ tag_id: number }>(`SELECT ${p.fk} AS tag_id FROM ${p.link} WHERE company_id = $1 ORDER BY 1`, [c.id])).rows.map((r) => r.tag_id);
      rec.after[p.audit + ":" + p.ids_key] = next;
      changed.set(c.id, rec);
    }
  }
  if (apply) {
    for (const [companyId, rec] of changed) {
      await db.query("UPDATE telema_companies SET updated_at = telema_now() WHERE id = $1", [companyId]);
      for (const key of Object.keys(rec.after)) {
        const [entity, idsKey] = key.split(":") as [string, string];
        await db.query(
          "INSERT INTO telema_audit_logs (action, entity_type, entity_id, before_json, after_json) VALUES ('update', $1, $2, $3, $4)",
          [entity, companyId, JSON.stringify({ [idsKey]: rec.before[key] }), JSON.stringify({ [idsKey]: rec.after[key] })],
        );
      }
    }
    await db.query("COMMIT");
    console.log(`\n割り振りました（変更した施設 ${changed.size}件）`);
  } else {
    await db.query("ROLLBACK");
    console.log("\n--apply が無いので、何も変更していません");
  }
} catch (e) {
  await db.query("ROLLBACK").catch(() => undefined);
  throw e;
} finally {
  await db.end();
}
