/**
 * 既存データの重複統合（管理者用CLI）。次のどちらかに当たる施設を1件にまとめる。
 *   - 電話番号が同じで、施設名も一致（表記ゆれ含む）
 *   - 施設名（正規化）と住所（正規化）が同じ（電話番号が無い・違う施設の重複）
 *
 *   npm run telema:merge                 統合予定と要確認の一覧を出すだけ（DBは変更しない）
 *   npm run telema:merge -- --apply      統合を実行する
 *     [--pair 残す施設ID:統合する施設ID ...]   名前が違うが同じ施設だと人が判断した組を追加で統合する
 *
 * - 接続先は DATABASE_URL（環境変数 または .env.local）
 * - 残す施設：架電履歴あり → ステータスあり → 事業所番号あり → 古い順
 * - 残す施設の空欄だけを補完し、既存の値は上書きしない。元データ列は無いキーだけ追加
 * - 架電履歴・先方担当者・AI提案・取得元の紐付け・つながりは残す施設へ付け替える
 * - 統合される施設は削除せず is_active = 0。統合前の全項目を telema_audit_logs（action = 'merge'）に残す
 * - 電話は同じでも施設名が違う組（本部番号の共有、同じ法人の別事業など）は統合せず「要確認」として出す
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSameFacilityName } from "../../src/telema/shared/normalize";
import { connect, describeTarget } from "./db";

// ---------- 引数 ----------
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const pairs = args
  .flatMap((a, i) => (args[i - 1] === "--pair" ? [a] : []))
  .map((p) => {
    const m = /^(\d+):(\d+)$/.exec(p);
    if (!m) throw new Error(`--pair は 残す施設ID:統合する施設ID の形式で指定してください: ${p}`);
    return { keep: Number(m[1]), drop: Number(m[2]) };
  });

type Row = Record<string, unknown> & {
  id: number;
  company_name: string;
  phone_normalized: string | null;
  company_name_normalized: string;
  address_normalized: string | null;
  status_id: number | null;
  status_label: string | null;
  facility_code: string | null;
  call_count: number;
  assigned_user_id: number | null;
};

const db = await connect();
try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(72830002)");

  // ---------- 対象 ----------
  const SELECT = "SELECT c.*, s.label AS status_label FROM telema_companies c LEFT JOIN telema_call_statuses s ON s.id = c.status_id";
  const rows = (await db.query<Row>(
    `${SELECT} WHERE c.is_active = 1 AND (c.phone_normalized IN (
       SELECT phone_normalized FROM telema_companies WHERE is_active = 1 AND phone_normalized IS NOT NULL GROUP BY phone_normalized HAVING COUNT(*) > 1)
     OR (c.company_name_normalized, c.address_normalized) IN (
       SELECT company_name_normalized, address_normalized FROM telema_companies WHERE is_active = 1 AND address_normalized IS NOT NULL
       GROUP BY 1, 2 HAVING COUNT(*) > 1))`,
  )).rows;
  const byId = new Map(rows.map((r) => [r.id, r]));

  /** 残す施設を先頭にする並び順 */
  const priority = (a: Row, b: Row) =>
    Number(b.call_count > 0) - Number(a.call_count > 0) ||
    Number(b.status_id != null) - Number(a.status_id != null) ||
    Number(b.facility_code != null) - Number(a.facility_code != null) ||
    a.id - b.id;

  // 同じ施設どうしをつなぐ（union-find）。電話＋施設名の一致、施設名＋住所の一致のどちらでもつながる
  const parent = new Map(rows.map((r) => [r.id, r.id]));
  const find = (id: number): number => (parent.get(id) === id ? id : find(parent.get(id)!));
  const union = (a: number, b: number) => parent.set(find(a), find(b));
  const groups = new Map<string, Row[]>();
  for (const r of rows) if (r.phone_normalized) groups.set(r.phone_normalized, [...(groups.get(r.phone_normalized) ?? []), r]);
  for (const [phone, members] of groups) if (members.length < 2) groups.delete(phone);
  for (const members of groups.values())
    for (const [i, a] of members.entries())
      for (const b of members.slice(i + 1)) if (isSameFacilityName(a.company_name, b.company_name)) union(a.id, b.id);
  const byNameAddress = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.address_normalized) continue;
    const key = `${r.company_name_normalized}|${r.address_normalized}`;
    byNameAddress.set(key, [...(byNameAddress.get(key) ?? []), r]);
  }
  let nameAddressPairs = 0;
  for (const members of byNameAddress.values())
    for (const r of members.slice(1))
      if (find(r.id) !== find(members[0]!.id)) {
        union(r.id, members[0]!.id);
        nameAddressPairs++;
      }

  type Merge = { keep: Row; drops: Row[]; manual?: boolean };
  const merges: Merge[] = [];
  const clusters = new Map<number, Row[]>();
  for (const r of rows) clusters.set(find(r.id), [...(clusters.get(find(r.id)) ?? []), r]);
  for (const cl of clusters.values()) {
    if (cl.length < 2) continue;
    const [keep, ...drops] = [...cl].sort(priority);
    merges.push({ keep: keep!, drops });
  }
  // 電話は同じでも、まとまらなかった施設がある組（本部番号の共有など）
  const review: Row[][] = [];
  for (const members of groups.values()) {
    const roots = [...new Set(members.map((r) => find(r.id)))];
    if (roots.length > 1) review.push(roots.map((root) => clusters.get(root)!.sort(priority)[0]!));
  }

  // 人が判断した組
  const load = async (id: number) => byId.get(id) ?? (await db.query<Row>(`${SELECT} WHERE c.id = $1 AND c.is_active = 1`, [id])).rows[0];
  for (const p of pairs) {
    const keep = await load(p.keep);
    const drop = await load(p.drop);
    if (!keep || !drop) throw new Error(`--pair ${p.keep}:${p.drop} の施設が見つからないか、既に無効です`);
    if (merges.some((m) => m.drops.some((d) => d.id === drop.id || d.id === keep.id))) throw new Error(`--pair ${p.keep}:${p.drop} は自動統合と重なっています`);
    const existing = merges.find((m) => m.keep.id === keep.id);
    if (existing) existing.drops.push(drop);
    else merges.push({ keep, drops: [drop], manual: true });
  }

  // ---------- 一覧 ----------
  const label = (r: Row) => `#${r.id} ${r.company_name}${r.status_label ? `［${r.status_label}］` : ""}${r.call_count ? `（架電${r.call_count}回）` : ""}`;
  const conflicts = (m: Merge) =>
    m.drops.flatMap((d) => [
      ...(m.keep.status_id != null && d.status_id != null && m.keep.status_id !== d.status_id ? [`ステータス違い（残す側を採用）：${m.keep.status_label} / ${d.status_label}`] : []),
      ...(m.keep.assigned_user_id != null && d.assigned_user_id != null && m.keep.assigned_user_id !== d.assigned_user_id ? ["担当営業が違う（残す側を採用）"] : []),
    ]);
  const lines: string[] = [];
  lines.push(`# 重複統合（${describeTarget()}）`, "");
  lines.push(`電話番号または施設名＋住所が重複する施設 ${rows.length}件（電話番号の重複 ${groups.size}組、施設名＋住所で追加でつながった ${nameAddressPairs}件）`, "");
  lines.push(`## 統合する ${merges.length}組（統合される施設 ${merges.reduce((n, m) => n + m.drops.length, 0)}件）`, "");
  for (const m of merges) {
    lines.push(`- 残す ${label(m.keep)} ← ${m.drops.map(label).join("、")}${m.manual ? "（手動指定）" : ""}`);
    for (const c of conflicts(m)) lines.push(`  - ※${c}`);
  }
  lines.push("", `## 要確認：電話は同じで施設名が違う ${review.length}組（統合しない。同じ施設なら --pair 残す:統合 で指定）`, "");
  for (const r of review) lines.push(`- ${r[0]!.phone_normalized}：${r.map(label).join(" / ")}`);

  const reportFile = join(mkdtempSync(join(tmpdir(), "telema-merge-")), "report.md");
  writeFileSync(reportFile, lines.join("\n"));
  console.log(lines.slice(0, 3).join("\n"));
  console.log(`統合 ${merges.length}組 / 要確認 ${review.length}組 / ステータス等の食い違い ${merges.filter((m) => conflicts(m).length).length}組`);
  console.log(`一覧: ${reportFile}`);

  if (!apply) {
    await db.query("ROLLBACK");
    console.log("\n確認のみ（DBは変更していません）。実行するには --apply を付けてください");
  } else if (merges.length) {
    console.log(`\n■ ${describeTarget()} へ適用中…`);
    // 空欄なら補完する列（識別に関わる名前・電話、件数系は対象外）
    const FILL = [
      "organization_id", "name_kana", "facility_code", "corporate_number", "phone_alt", "website", "website_domain", "postal_code", "prefecture", "city",
      "address", "address_normalized", "latitude", "longitude", "industry", "employee_count", "notes", "status_id", "ai_temperature", "ai_temperature_score",
      "interest", "pain_point", "decision_timing", "budget", "current_service", "competitor", "ng_reason", "summary", "current_note", "next_action",
      "next_call_at", "assigned_user_id", "google_rating", "google_review_count", "map_url", "visited_at",
    ];
    for (const m of merges) {
      const k = m.keep.id;
      for (const d of m.drops) {
        await db.query(
          `UPDATE telema_companies AS k SET ${FILL.map((f) => `${f} = COALESCE(k.${f}, d.${f})`).join(", ")},
             temperature = CASE WHEN k.temperature = 'unrated' THEN d.temperature ELSE k.temperature END,
             extra_attributes = CASE WHEN d.extra_attributes IS NULL THEN k.extra_attributes
               ELSE (d.extra_attributes::jsonb || COALESCE(k.extra_attributes, '{}')::jsonb)::text END,
             updated_at = telema_now()
           FROM telema_companies AS d WHERE k.id = $1 AND d.id = $2`,
          [k, d.id],
        );
        for (const table of ["telema_call_logs", "telema_contacts", "telema_ai_suggestions", "telema_company_sources"]) {
          await db.query(`UPDATE ${table} SET company_id = $1 WHERE company_id = $2`, [k, d.id]);
        }
        // つながり：相手を残す施設に付け替える。自分自身へのつながりになるもの・既にあるつながりと重なるものは無効にする
        const rels = (await db.query<{ id: number; company_a_id: number; company_b_id: number }>(
          "SELECT id, company_a_id, company_b_id FROM telema_company_relations WHERE is_active = 1 AND (company_a_id = $1 OR company_b_id = $1)",
          [d.id],
        )).rows;
        for (const r of rels) {
          const other = r.company_a_id === d.id ? r.company_b_id : r.company_a_id;
          const [a, b] = [Math.min(k, other), Math.max(k, other)];
          const dup = a === b || (await db.query("SELECT 1 FROM telema_company_relations WHERE is_active = 1 AND company_a_id = $1 AND company_b_id = $2 AND id <> $3", [a, b, r.id])).rowCount;
          if (dup) await db.query("UPDATE telema_company_relations SET is_active = 0, updated_at = telema_now() WHERE id = $1", [r.id]);
          else await db.query("UPDATE telema_company_relations SET company_a_id = $1, company_b_id = $2, updated_at = telema_now() WHERE id = $3", [a, b, r.id]);
        }
        await db.query(
          `INSERT INTO telema_company_field_sources (company_id, field, source, source_ref, confidence, updated_by, updated_at)
           SELECT $1, field, source, source_ref, confidence, updated_by, updated_at FROM telema_company_field_sources WHERE company_id = $2
           ON CONFLICT (company_id, field) DO NOTHING`,
          [k, d.id],
        );
        await db.query("UPDATE telema_companies SET is_active = 0, updated_at = telema_now() WHERE id = $1", [d.id]);
        const { status_label: _, search_text: __, ...before } = d;
        await db.query(
          "INSERT INTO telema_audit_logs (action, entity_type, entity_id, before_json, after_json) VALUES ('merge', 'company', $1, $2, $3)",
          [d.id, JSON.stringify(before), JSON.stringify({ merged_into: k, manual: !!m.manual, via: "cli" })],
        );
      }
      await db.query(
        `UPDATE telema_companies SET call_count = (SELECT COUNT(*) FROM telema_call_logs WHERE company_id = $1 AND is_active = 1),
           last_called_at = (SELECT MAX(called_at) FROM telema_call_logs WHERE company_id = $1 AND is_active = 1) WHERE id = $1`,
        [k],
      );
    }
    await db.query("COMMIT");
    console.log("✓ 完了");
  } else {
    await db.query("ROLLBACK");
  }
} catch (e) {
  await db.query("ROLLBACK").catch(() => {});
  throw e;
} finally {
  await db.end();
}
