/**
 * 管理者用の一括取り込みCLI（変換ロジックは画面と共通の src/telema/shared/import）。
 *
 *   python3 scripts/telema/xlsx-to-json.py リスト.xlsx /tmp/list.json
 *   npm run telema:import -- /tmp/list.json --source "茨城県 認可施設" --type public_data [--dry-run]
 *     [--on-phone-match merge-name|merge|separate|skip]  電話一致時（既定 merge-name）
 *        merge-name : 施設名も一致（表記ゆれ含む）する場合だけ既存に統合。名前が違えば separate
 *        merge-similar : merge-name に加え、括弧内の施設名が一致・片方が法人名だけの場合も統合（normalize.ts の isLikelySameFacility）
 *                     （本部番号の共有や同じ法人の別事業など、電話が同じ別施設があるため）
 *        merge      : 施設名が違っても統合
 *        separate   : 別レコードとして登録（重複候補として一覧表示）
 *        skip       : 取り込まない（取得元の紐付けもしない）
 *     [--skip-status]  「状態」列を反映しない
 *
 * - 接続先は DATABASE_URL（環境変数 または .env.local）
 * - 列は src/telema/shared/import/detect.ts で自動認識し、結果を表示する
 * - 既存データ・同じファイル内の重複：事業所番号・法人番号・電話番号（--on-phone-match）の一致は1件に統合する。
 *   統合は空欄の補完と元データ列の追記だけで、既存の値は上書きしない。統合した行の元の値は telema_import_rows に残す
 * - 1つのトランザクションで適用する（途中で失敗したら何も登録されない）
 */
import { readFileSync } from "node:fs";
import { isLikelySameFacility, isSameFacilityName } from "../../src/telema/shared/normalize";
import { detectColumns } from "../../src/telema/shared/import/detect";
import { transformRow, type ColumnMapping, type TransformedRow } from "../../src/telema/shared/import/transform";
import { connect, describeTarget, insertMany, reserveIds } from "./db";

// ---------- 引数 ----------
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const input = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
if (!input) throw new Error("入力JSONを指定してください");
const dryRun = flag("dry-run");
const sourceName = opt("source") ?? input;
const sourceType = opt("type") ?? "excel";
const onPhoneMatch = (opt("on-phone-match") ?? "merge-name") as "merge" | "merge-name" | "merge-similar" | "separate" | "skip";
if (!["merge", "merge-name", "merge-similar", "separate", "skip"].includes(onPhoneMatch))
  throw new Error("--on-phone-match は merge / merge-name / merge-similar / separate / skip");
const skipStatus = flag("skip-status");

const data = JSON.parse(readFileSync(input, "utf8")) as { file: string; sheet: string; headers: string[]; rows: string[][] };

// ---------- 列認識 ----------
const detections = detectColumns(data.headers, data.rows.slice(0, 300));
const mapping: ColumnMapping = detections.map((d) => ({ column: d.column, header: d.header, assignment: d.assignment }));
console.log(`\n■ ${data.file} / ${data.sheet}  ${data.rows.length}行`);
console.log("■ 列の認識結果（標準項目に割り当てた列）");
for (const d of detections) {
  if (d.assignment === "extra" || d.assignment === "ignore") continue;
  console.log(`  ${d.header} → ${d.assignment}  [${d.method} ${Math.round(d.confidence * 100)}%]${d.note ? `  ※${d.note}` : ""}`);
}
console.log(`  その他 ${detections.filter((d) => d.assignment === "extra").length}列は元データとして保持、空の列 ${detections.filter((d) => d.assignment === "ignore").length}列は無視`);
if (!detections.some((d) => d.assignment === "company_name")) throw new Error("会社名・施設名の列を認識できませんでした");

const rows = data.rows.map((r, i) => transformRow(r, i + 2, mapping));

const db = await connect();
try {
  await db.query("BEGIN");
  // 取り込み中に同じリストを二重に流さないよう、取り込みCLIどうしは順番に実行する
  await db.query("SELECT pg_advisory_xact_lock(72830002)");

  // ---------- 既存データ ----------
  type Existing = { id: number; company_name: string; facility_code: string | null; corporate_number: string | null; phone_normalized: string | null };
  const existing = (await db.query<Existing>("SELECT id, company_name, facility_code, corporate_number, phone_normalized FROM telema_companies WHERE is_active = 1")).rows;
  const byFacility = new Map(existing.filter((e) => e.facility_code).map((e) => [e.facility_code!, e]));
  const byCorp = new Map(existing.filter((e) => e.corporate_number).map((e) => [e.corporate_number!, e]));
  const byPhone = new Map(existing.filter((e) => e.phone_normalized).map((e) => [e.phone_normalized!, e]));
  const existingOrgs = new Map(
    (await db.query<{ id: number; key: string }>("SELECT id, name_normalized || '|' || COALESCE(postal_code, '') AS key FROM telema_organizations")).rows.map((o) => [o.key, o.id]),
  );
  const statuses = new Map((await db.query<{ id: number; label: string }>("SELECT id, label FROM telema_call_statuses")).rows.map((s) => [s.label, s.id]));

  // ---------- 分類 ----------
  // 新規の施設には仮の番号（負数）を振り、適用時にシーケンスから確保した id に置き換える
  type MatchType = "facility_code" | "corporate_number" | "phone";
  type Plan = {
    row: TransformedRow;
    kind: "new" | "merge" | "skip" | "error";
    /** new: 仮の番号 / merge: 統合先（既存の id、または同じファイル内で先に新規登録する施設の仮の番号） */
    id?: number;
    matchType?: MatchType;
    inFile?: boolean;
    phoneCandidate?: Existing;
  };
  let tempSeq = 0;
  const plans: Plan[] = rows.map((row) => {
    const c = row.company;
    if (!c.company_name) return { row, kind: "error" };
    const merge = (hit: Existing, matchType: MatchType): Plan => ({ row, kind: "merge", id: hit.id, matchType, inFile: hit.id < 0 });
    const fcHit = c.facility_code ? byFacility.get(c.facility_code) : undefined;
    if (fcHit) return merge(fcHit, "facility_code");
    const cnHit = c.corporate_number ? byCorp.get(c.corporate_number) : undefined;
    if (cnHit) return merge(cnHit, "corporate_number");
    const ph = c.phone_normalized ? byPhone.get(c.phone_normalized) : undefined;
    if (ph && onPhoneMatch === "skip") return { row, kind: "skip", phoneCandidate: ph };
    if (
      ph &&
      (onPhoneMatch === "merge" ||
        (onPhoneMatch === "merge-name" && isSameFacilityName(c.company_name, ph.company_name)) ||
        (onPhoneMatch === "merge-similar" && isLikelySameFacility(c.company_name, ph.company_name)))
    )
      return merge(ph, "phone");

    // 新規。以降の行（同じファイル内の重複）が統合先として見つけられるよう登録しておく
    const id = --tempSeq;
    const self: Existing = { id, company_name: c.company_name, facility_code: c.facility_code ?? null, corporate_number: c.corporate_number ?? null, phone_normalized: c.phone_normalized ?? null };
    if (self.facility_code) byFacility.set(self.facility_code, self);
    if (self.corporate_number) byCorp.set(self.corporate_number, self);
    if (self.phone_normalized && !ph) byPhone.set(self.phone_normalized, self);
    return { row, kind: "new", id, phoneCandidate: ph };
  });

  const newRows = plans.filter((p) => p.kind === "new");
  const candidates = newRows.filter((p) => p.phoneCandidate);
  const merged = plans.filter((p) => p.kind === "merge");
  const summary = {
    total_rows: rows.length,
    new_rows: newRows.length,
    candidate_rows: candidates.length,
    duplicate_rows: plans.filter((p) => p.kind === "merge" || p.kind === "skip").length,
    error_rows: plans.filter((p) => p.kind === "error").length,
  };
  // 同じファイル内で先に新規登録する施設は、まだ id が無いので行番号で示す
  const rowOfTemp = new Map(newRows.map((p) => [p.id!, p.row.row_index]));
  const label = (id: number) => (id < 0 ? `同じファイルの行${rowOfTemp.get(id)}` : `既存#${id}`);
  console.log("\n■ 解析結果");
  const mergedBy = (t: MatchType) => merged.filter((p) => p.matchType === t).length;
  console.log(`  総行数 ${summary.total_rows} / 新規 ${summary.new_rows} / 既存候補(電話一致・別登録) ${summary.candidate_rows} / 重複 ${summary.duplicate_rows}（うち統合 ${merged.length}・スキップ ${plans.filter((p) => p.kind === "skip").length}） / エラー ${summary.error_rows}`);
  if (merged.length) {
    console.log(`  統合の内訳：事業所番号 ${mergedBy("facility_code")} / 法人番号 ${mergedBy("corporate_number")} / 電話番号 ${mergedBy("phone")}（うち同じファイル内 ${merged.filter((p) => p.inFile).length}）`);
    const nameOf = new Map([...existing.map((e) => [e.id, e.company_name] as const), ...newRows.map((p) => [p.id!, p.row.company.company_name] as const)]);
    const renamed = merged.filter((p) => p.matchType === "phone" && !isSameFacilityName(p.row.company.company_name, nameOf.get(p.id!) ?? ""));
    if (renamed.length) console.log(`  施設名が違う電話一致の統合 ${renamed.length}件（既存の名前を残し、今回の名前は telema_import_rows に保存）`);
    for (const p of renamed.slice(0, 10)) console.log(`    行${p.row.row_index} ${p.row.company.company_name} → ${label(p.id!)} ${nameOf.get(p.id!)}`);
  }
  const warnRows = rows.filter((r) => r.errors.length);
  if (warnRows.length) console.log("  要確認:", warnRows.map((r) => `行${r.row_index} ${r.company.company_name}: ${r.errors.join("、")}`).join(" / "));
  for (const c of candidates.slice(0, 10)) console.log(`  電話一致: 行${c.row.row_index} ${c.row.company.company_name} ⇔ ${label(c.phoneCandidate!.id)} ${c.phoneCandidate!.company_name}`);

  // 法人：同じ名前・郵便番号の法人は1件にまとめる
  type OrgPlan = { temp: number; org: NonNullable<TransformedRow["organization"]> };
  const orgPlans: OrgPlan[] = [];
  const orgKey = new Map(existingOrgs);
  const orgOf = new Map<Plan, number>();
  for (const p of newRows) {
    const o = p.row.organization;
    if (!o) continue;
    const key = `${o.name_normalized}|${o.postal_code ?? ""}`;
    let id = orgKey.get(key);
    if (id == null) {
      id = -(orgPlans.length + 1);
      orgKey.set(key, id);
      orgPlans.push({ temp: id, org: o });
    }
    orgOf.set(p, id);
  }

  console.log(`\n■ 登録予定：法人 ${orgPlans.length}件（新規）、施設 ${newRows.length}件、既存への統合 ${merged.length}件、取得元の紐付け ${newRows.length + merged.length}件`);
  const unknownStatus = [...new Set(rows.map((r) => r.status_value).filter((s): s is string => !!s && !statuses.has(s)))];
  if (!skipStatus && unknownStatus.length) console.log(`  ※ステータスに無い「状態」の値（未設定で登録）：${unknownStatus.join("、")}`);

  if (dryRun) {
    await db.query("ROLLBACK");
    console.log("\n--dry-run のため適用しません");
  } else {
    console.log(`\n■ ${describeTarget()} へ適用中…`);

    // ---------- id の確保 ----------
    const companyIds = await reserveIds(db, "telema_companies", newRows.length);
    const orgIds = await reserveIds(db, "telema_organizations", orgPlans.length);
    const realCompany = new Map(newRows.map((p, i) => [p.id!, companyIds[i]!]));
    const realOrg = new Map(orgPlans.map((o, i) => [o.temp, orgIds[i]!]));
    const cid = (id: number) => (id < 0 ? realCompany.get(id)! : id);
    const oid = (id: number | undefined) => (id == null ? null : id < 0 ? realOrg.get(id)! : id);

    const sourceId = (await db.query<{ id: number }>(
      "INSERT INTO telema_list_sources (name, source_type, description) VALUES ($1, $2, $3) RETURNING id",
      [sourceName, sourceType, `${data.file} / ${data.sheet}`],
    )).rows[0]!.id;
    const jobId = (await db.query<{ id: number }>(
      `INSERT INTO telema_import_jobs (file_name, sheet_name, list_source_id, status, total_rows, new_rows, candidate_rows, duplicate_rows, error_rows, mapping_json, completed_at)
       VALUES ($1, $2, $3, 'completed', $4, $5, $6, $7, $8, $9, telema_now()) RETURNING id`,
      [data.file, data.sheet, sourceId, summary.total_rows, summary.new_rows, summary.candidate_rows, summary.duplicate_rows, summary.error_rows,
        JSON.stringify(mapping.filter((m) => m.assignment !== "ignore"))],
    )).rows[0]!.id;
    const ref = `import_job:${jobId}`;

    // ---------- 法人 ----------
    await insertMany(db, "telema_organizations",
      ["id", "name", "name_normalized", "name_kana", "corporation_type", "phone", "phone_normalized", "postal_code", "address", "representative_name", "representative_title"],
      orgPlans.map(({ temp, org: o }) => [realOrg.get(temp), o.name, o.name_normalized, o.name_kana, o.corporation_type, o.phone, o.phone_normalized, o.postal_code, o.address, o.representative_name, o.representative_title]));
    await insertMany(db, "telema_contacts", ["organization_id", "name", "role", "is_decision_maker", "source", "source_ref"],
      orgPlans.filter((o) => o.org.representative_name).map(({ temp, org: o }) => [realOrg.get(temp), o.representative_name, o.representative_title, 0, "excel", ref]));

    // ---------- 新規の施設 ----------
    // 営業状況などステータスに関わる値は元データに残し、判定できるものだけ反映
    const COMPANY_FIELDS = ["company_name", "name_kana", "facility_code", "corporate_number", "phone", "phone_alt", "website", "postal_code", "address", "industry", "employee_count", "google_rating", "google_review_count", "map_url", "notes"] as const;
    const companyRows: unknown[][] = [];
    const fieldRows: unknown[][] = [];
    const contactRows: unknown[][] = [];
    const sourceRows: unknown[][] = [];
    for (const p of newRows) {
      const c = p.row.company;
      const id = cid(p.id!);
      const orgId = oid(orgOf.get(p));
      const opStatus = p.row.extra["営業状況"];
      const statusId = !skipStatus && p.row.status_value ? statuses.get(p.row.status_value) ?? null : opStatus === "廃止済" ? statuses.get("廃業") ?? null : null;
      const notes = [c.notes, opStatus && opStatus !== "通常営業" ? `営業状況: ${opStatus}` : null].filter(Boolean).join("\n") || null;
      companyRows.push([id, orgId, c.company_name, c.company_name_normalized, c.name_kana, c.facility_code, c.corporate_number, c.phone, c.phone_normalized, c.phone_alt, c.website, c.website_domain,
        c.postal_code, c.prefecture, c.city, c.address, c.address_normalized, c.latitude, c.longitude, c.industry, c.employee_count, c.google_rating, c.google_review_count, c.map_url, notes, statusId,
        Object.keys(p.row.extra).length ? JSON.stringify(p.row.extra) : null]);
      for (const f of COMPANY_FIELDS) if ((f === "notes" ? notes : c[f]) != null) fieldRows.push([id, f, "excel", ref]);
      if (p.row.contact) contactRows.push([id, orgId, p.row.contact.name, p.row.contact.role, 0, "excel", ref]);
      sourceRows.push([id, sourceId, jobId, p.row.row_index]);
    }
    await insertMany(db, "telema_companies",
      ["id", "organization_id", "company_name", "company_name_normalized", "name_kana", "facility_code", "corporate_number", "phone", "phone_normalized", "phone_alt", "website", "website_domain",
        "postal_code", "prefecture", "city", "address", "address_normalized", "latitude", "longitude", "industry", "employee_count", "google_rating", "google_review_count", "map_url", "notes", "status_id", "extra_attributes"],
      companyRows);
    await insertMany(db, "telema_company_field_sources", ["company_id", "field", "source", "source_ref"], fieldRows);
    await insertMany(db, "telema_contacts", ["company_id", "organization_id", "name", "role", "is_decision_maker", "source", "source_ref"], contactRows);

    // ---------- 既存（または同じファイル内）への統合 ----------
    // 統合先ごとに行をまとめ、先に出てきた行の値を優先して1回で更新する（既存の値は上書きしない）
    const FILL_IF_EMPTY = ["name_kana", "phone_alt", "website", "website_domain", "postal_code", "prefecture", "city", "address", "address_normalized", "latitude", "longitude", "industry", "employee_count", "google_rating", "google_review_count", "map_url"] as const;
    type Fold = { id: number; values: Partial<Record<(typeof FILL_IF_EMPTY)[number], unknown>>; status_id: number | null; extra: Record<string, string> };
    const folds = new Map<number, Fold>();
    const mergeFieldRows: unknown[][] = [];
    const mergeContacts = new Map<string, unknown[]>();
    const importRows: unknown[][] = [];
    for (const p of merged) {
      const id = cid(p.id!);
      const c = p.row.company;
      const fold = folds.get(id) ?? { id, values: {}, status_id: null, extra: {} };
      for (const f of FILL_IF_EMPTY) if (fold.values[f] == null && c[f] != null) fold.values[f] = c[f];
      fold.status_id ??= !skipStatus && p.row.status_value ? statuses.get(p.row.status_value) ?? null : null;
      fold.extra = { ...p.row.extra, ...fold.extra };
      folds.set(id, fold);
      for (const f of FILL_IF_EMPTY) if ((COMPANY_FIELDS as readonly string[]).includes(f) && c[f] != null) mergeFieldRows.push([id, f, "excel", ref]);
      if (p.row.contact?.name && !mergeContacts.has(`${id}|${p.row.contact.name}`)) mergeContacts.set(`${id}|${p.row.contact.name}`, [id, p.row.contact.name, p.row.contact.role]);
      // 上書きしなかった値（施設名・電話の違いなど）を失わないよう、統合した行は元の値ごと残す
      importRows.push([jobId, p.row.row_index,
        JSON.stringify({ company: c, organization: p.row.organization, contact: p.row.contact, status_value: p.row.status_value }), JSON.stringify(p.row.extra),
        p.inFile ? "in_file" : p.matchType, id, "merge", id, "imported"]);
      sourceRows.push([id, sourceId, jobId, p.row.row_index]);
    }
    if (folds.size) {
      await db.query(
        `CREATE TEMP TABLE telema_merge ON COMMIT DROP AS
         SELECT id, status_id, extra_attributes, ${FILL_IF_EMPTY.join(", ")} FROM telema_companies WITH NO DATA`,
      );
      await insertMany(db, "telema_merge", ["id", "status_id", "extra_attributes", ...FILL_IF_EMPTY],
        [...folds.values()].map((f) => [f.id, f.status_id, JSON.stringify(f.extra), ...FILL_IF_EMPTY.map((k) => f.values[k] ?? null)]));
      await db.query(
        `UPDATE telema_companies c SET ${FILL_IF_EMPTY.map((f) => `${f} = COALESCE(c.${f}, m.${f})`).join(", ")},
           status_id = COALESCE(c.status_id, m.status_id),
           extra_attributes = (m.extra_attributes::jsonb || COALESCE(c.extra_attributes, '{}')::jsonb)::text,
           updated_at = telema_now()
         FROM telema_merge m WHERE c.id = m.id`,
      );
    }
    await insertMany(db, "telema_company_field_sources", ["company_id", "field", "source", "source_ref"], mergeFieldRows, "ON CONFLICT (company_id, field) DO NOTHING");
    // 統合先に同じ名前の担当者がいなければ追加する
    const mc = [...mergeContacts.values()];
    for (let i = 0; i < mc.length; i += 5000) {
      const params: unknown[] = [ref];
      const values = mc.slice(i, i + 5000).map((r) => {
        params.push(...r);
        const n = params.length;
        return `($${n - 2}::int, $${n - 1}::text, $${n}::text)`;
      });
      await db.query(
        `INSERT INTO telema_contacts (company_id, organization_id, name, role, is_decision_maker, source, source_ref)
         SELECT c.id, c.organization_id, v.name, v.role, 0, 'excel', $1 FROM (VALUES ${values.join(", ")}) AS v(id, name, role)
         JOIN telema_companies c ON c.id = v.id
         WHERE NOT EXISTS (SELECT 1 FROM telema_contacts ct WHERE ct.company_id = v.id AND ct.name = v.name)`,
        params,
      );
    }
    await insertMany(db, "telema_import_rows",
      ["import_job_id", "row_index", "mapped_json", "extra_json", "match_type", "matched_company_id", "decision", "result_company_id", "status"], importRows);
    await insertMany(db, "telema_company_sources", ["company_id", "source_id", "import_job_id", "source_row"], sourceRows);
    await db.query("INSERT INTO telema_audit_logs (action, entity_type, entity_id, after_json) VALUES ('import', 'import_job', $1, $2)",
      [jobId, JSON.stringify({ ...summary, organizations_created: orgPlans.length, via: "cli" })]);

    await db.query("COMMIT");
    const check = (await db.query<{ n: string }>("SELECT COUNT(*) AS n FROM telema_company_sources WHERE import_job_id = $1", [jobId])).rows[0]!;
    console.log(`\n✓ 完了：取り込みジョブ #${jobId} に ${check.n} 件が紐付きました`);
  }
} catch (e) {
  await db.query("ROLLBACK").catch(() => {});
  throw e;
} finally {
  await db.end();
}
