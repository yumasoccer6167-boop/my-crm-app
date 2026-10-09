/**
 * 契約一覧のCSVを、電話番号・住所でテレマリストの施設と照合して、各施設の「契約情報」に追加する管理者用CLI。
 *
 *   npm run telema:contracts -- 契約一覧.csv --report /tmp/契約照合.tsv          # 照合結果の確認だけ（何も変更しない）
 *   npm run telema:contracts -- 契約一覧.csv --report /tmp/契約照合.tsv --apply  # 契約情報を追加する
 *
 * CSVの列（ヘッダー名）：会社名 / 商品名 / 申込み住所 / 申込み電話番号 / 営業担当 / 契約日（YYYY/MM/DD）。その他の列は使わない
 *
 * 照合のしかた（有効な施設だけが対象）
 *  - 電話番号が一致する施設（電話番号・その他の電話番号）と、住所が一致する施設（表記ゆれを除いた住所の完全一致）を探す
 *  - 両方に一致すればその施設。電話番号だけ／住所だけの一致でも、候補が1件ならその施設
 *    （電話番号だけの一致で、都道府県・市区町村が食い違うものは「要確認」にして追加しない）
 *  - 候補が複数のときは、会社名と施設名（法人名）が似ているものに絞る。それでも1件に決まらなければ「要確認」にして追加しない
 *  - 電話番号と住所がそれぞれ別の施設に一致するときも「要確認」
 * 追加する契約情報：商材＝商品名、契約日＝契約日、営業担当＝CRMのメンバー名と一致したときだけ（一致しなければ空欄）
 *  - すでに同じ施設・商材・契約日の契約情報があるものと、CSV内の重複は追加しない
 *  - 商品名・契約日が空の行は追加しない
 * 1つのトランザクションで追加する（途中で失敗したら何も追加されない）。接続先は DATABASE_URL（環境変数 または .env.local）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { isLikelySameFacility, normalizeAddress, normalizePhone, splitPrefectureCity } from "../../src/telema/shared/normalize";
import { readTable } from "./csv";
import { connect, describeTarget } from "./db";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const input = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!input) throw new Error("契約一覧のCSVを指定してください");
const reportPath = opt("report");

const { header, rows } = readTable(readFileSync(input, "utf8"));
const COLS = { name: "会社名", product: "商品名", address: "申込み住所", phone: "申込み電話番号", sales: "営業担当", date: "契約日" } as const;
for (const c of Object.values(COLS)) if (!header.includes(c)) throw new Error(`「${c}」列が見つかりません（列: ${header.join(", ")}）`);

type Co = { id: number; company_name: string; org_name: string | null; address: string | null; address_n: string | null; phone_n: string | null; alt_n: string | null };
type Result = { status: "ok" | "unmatched" | "review"; company?: Co; basis?: string; note?: string; candidates?: Co[] };

const compact = (s: string) => s.replace(/[\s　]/g, "");
const toIsoDate = (s: string): string | null => {
  const m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
};

const db = await connect();
console.log(`\n■ ${input}  ${rows.length}行`);
console.log(`■ 接続先: ${describeTarget()}${apply ? "" : "（確認のみ。--apply で追加します）"}`);
try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(72830004)");

  // ---------- 施設・メンバー・既存の契約情報 ----------
  const companies = (await db.query<Co>(
    `SELECT c.id, c.company_name, o.name AS org_name, c.address, c.address_normalized AS address_n, c.phone_normalized AS phone_n,
            NULLIF(regexp_replace(COALESCE(c.phone_alt, ''), '\\D', '', 'g'), '') AS alt_n
       FROM telema_companies c LEFT JOIN telema_organizations o ON o.id = c.organization_id WHERE c.is_active = 1`,
  )).rows;
  const byPhone = new Map<string, Co[]>();
  const byAddr = new Map<string, Co[]>();
  const push = (m: Map<string, Co[]>, k: string | null, c: Co) => {
    if (!k) return;
    const l = m.get(k);
    if (!l) m.set(k, [c]);
    else if (!l.includes(c)) l.push(c);
  };
  for (const c of companies) {
    push(byPhone, c.phone_n, c);
    push(byPhone, normalizePhone(c.alt_n), c);
    push(byAddr, c.address_n || null, c);
  }
  const users = (await db.query<{ id: number; display_name: string }>("SELECT id, display_name FROM users")).rows;
  const userByName = new Map(users.map((u) => [compact(u.display_name), u.id]));
  const have = new Set(
    (await db.query<{ company_id: number; product_name: string; contract_date: string }>("SELECT company_id, product_name, contract_date FROM telema_contracts WHERE is_active = 1")).rows
      .map((r) => `${r.company_id}|${compact(r.product_name)}|${r.contract_date}`),
  );

  // ---------- 照合（会社名・電話・住所の組ごとに1回） ----------
  const cache = new Map<string, Result>();
  const sameArea = (csvAddr: string, c: Co) => {
    if (!csvAddr || !c.address) return true; // どちらかに住所が無ければ食い違いとは言えない
    const a = splitPrefectureCity(csvAddr);
    const b = splitPrefectureCity(c.address);
    return !a.prefecture || !b.prefecture || (a.prefecture === b.prefecture && (!a.city || !b.city || a.city === b.city));
  };
  function match(name: string, rawPhone: string, rawAddr: string): Result {
    const phone = normalizePhone(rawPhone);
    const addr = normalizeAddress(rawAddr);
    const P = phone ? (byPhone.get(phone) ?? []) : [];
    const A = addr ? (byAddr.get(addr) ?? []) : [];
    let cands: Co[];
    let basis: string;
    if (P.length && A.length) {
      cands = P.filter((c) => A.includes(c));
      if (!cands.length) return { status: "review", note: "電話番号と住所が別の施設に一致", candidates: [...P, ...A] };
      basis = "電話＋住所";
    } else if (P.length) {
      cands = P.filter((c) => sameArea(rawAddr, c));
      if (!cands.length) return { status: "review", note: "電話番号は一致するが住所の都道府県・市区町村が違う", candidates: P };
      basis = "電話";
    } else if (A.length) {
      cands = A;
      basis = "住所";
    } else return { status: "unmatched" };
    if (cands.length > 1) {
      const named = cands.filter((c) => isLikelySameFacility(name, c.company_name) || (c.org_name != null && isLikelySameFacility(name, c.org_name)));
      if (named.length !== 1) return { status: "review", note: `${basis}で${cands.length}施設に一致し、会社名では1つに決まらない`, candidates: cands };
      cands = named;
      basis += "＋名称";
    }
    return { status: "ok", company: cands[0]!, basis };
  }

  type Plan = { line: number; company: Co; product: string; date: string; userId: number | null; basis: string };
  const plans: Plan[] = [];
  const stats = { rows: rows.length, noProduct: 0, badDate: 0, dup: 0, existing: 0, unmatched: 0, review: 0 };
  const basisCount = new Map<string, number>();
  const unmatchedRows: string[] = [];
  const reviewRows: string[] = [];
  const unknownSales = new Map<string, number>();
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const line = i + 2;
    const product = r[COLS.product]!.trim();
    const date = toIsoDate(r[COLS.date]!);
    if (!product) return void stats.noProduct++;
    if (!date) return void stats.badDate++;
    const key = `${r[COLS.name]}|${r[COLS.phone]}|${r[COLS.address]}`;
    let res = cache.get(key);
    if (!res) cache.set(key, (res = match(r[COLS.name]!, r[COLS.phone]!, r[COLS.address]!)));
    const label = `${line}行目\t${r[COLS.name]}\t${r[COLS.phone]}\t${r[COLS.address]}\t${product}\t${r[COLS.date]}`;
    if (res.status === "unmatched") return void (stats.unmatched++, unmatchedRows.push(label));
    if (res.status === "review") {
      stats.review++;
      reviewRows.push(`${label}\t${res.note}\t候補: ${(res.candidates ?? []).map((c) => `#${c.id} ${c.company_name}`).join(" / ")}`);
      return;
    }
    const company = res.company!;
    const dupKey = `${company.id}|${compact(product)}|${date}`;
    if (have.has(dupKey)) return void stats.existing++;
    if (seen.has(dupKey)) return void stats.dup++;
    seen.add(dupKey);
    const sales = compact(r[COLS.sales] ?? "");
    const userId = sales ? (userByName.get(sales) ?? null) : null;
    if (sales && userId == null) unknownSales.set(r[COLS.sales]!, (unknownSales.get(r[COLS.sales]!) ?? 0) + 1);
    plans.push({ line, company, product, date, userId, basis: res.basis! });
    basisCount.set(res.basis!, (basisCount.get(res.basis!) ?? 0) + 1);
  });

  // ---------- 結果の表示 ----------
  const companiesHit = new Set(plans.map((p) => p.company.id)).size;
  console.log(`\n■ 照合結果`);
  console.log(`  追加する契約情報 ${plans.length}件（${companiesHit}施設）  ${[...basisCount].map(([k, v]) => `${k} ${v}`).join(" / ")}`);
  console.log(`  追加しない：施設が見つからない ${stats.unmatched}行 / 要確認 ${stats.review}行 / すでに同じ契約あり ${stats.existing}行 / CSV内の重複 ${stats.dup}行 / 商品名なし ${stats.noProduct}行 / 契約日が読めない・なし ${stats.badDate}行`);
  if (unknownSales.size) {
    const top = [...unknownSales].sort((a, b) => b[1] - a[1]);
    console.log(`  営業担当がメンバーと一致せず、空欄で追加 ${top.reduce((s, [, n]) => s + n, 0)}件（名前 ${top.length}種）: ${top.slice(0, 10).map(([k, n]) => `${k} ${n}`).join("、")}${top.length > 10 ? " ほか" : ""}`);
  }
  if (reviewRows.length) {
    console.log(`\n■ 要確認の例（全件は --report のファイル）`);
    reviewRows.slice(0, 8).forEach((l) => console.log(`  ${l}`));
  }
  if (reportPath) {
    const out = [
      `# 追加しない：施設が見つからない（${unmatchedRows.length}行）`, "行\t会社名\t電話\t住所\t商品名\t契約日", ...unmatchedRows, "",
      `# 追加しない：要確認（${reviewRows.length}行）`, "行\t会社名\t電話\t住所\t商品名\t契約日\t理由\t候補", ...reviewRows, "",
      `# 追加する契約情報（${plans.length}件）`, "行\t施設ID\t施設名\t商品名\t契約日\t営業担当(メンバー一致)\t照合",
      ...plans.map((p) => `${p.line}行目\t${p.company.id}\t${p.company.company_name}\t${p.product}\t${p.date}\t${p.userId ?? ""}\t${p.basis}`),
    ].join("\n");
    writeFileSync(reportPath, out, "utf8");
    console.log(`\n詳細を ${reportPath} に書き出しました`);
  }

  if (apply) {
    for (const p of plans) {
      const r = await db.query<{ id: number }>(
        "INSERT INTO telema_contracts (company_id, product_name, contract_date, assigned_user_id) VALUES ($1, $2, $3, $4) RETURNING id",
        [p.company.id, p.product, p.date, p.userId],
      );
      await db.query(
        "INSERT INTO telema_audit_logs (action, entity_type, entity_id, after_json) VALUES ('create', 'contract', $1, $2)",
        [r.rows[0]!.id, JSON.stringify({ company_id: p.company.id, product_name: p.product, contract_date: p.date, assigned_user_id: p.userId, source: `契約一覧CSV ${p.line}行目（${p.basis}）` })],
      );
    }
    await db.query("COMMIT");
    console.log(`\n契約情報を ${plans.length}件追加しました（${companiesHit}施設）`);
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
