// 管理者用CLIの PostgreSQL 接続。接続先は環境変数 DATABASE_URL、無ければ .env.local の DATABASE_URL（.gitignore 済み）
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (existsSync(".env.local")) {
    const m = readFileSync(".env.local", "utf8").match(/^\s*DATABASE_URL\s*=\s*["']?([^"'\s]+)/m);
    if (m) return m[1]!;
  }
  throw new Error("DATABASE_URL が設定されていません（Render の PostgreSQL の External Database URL を .env.local に書いてください）");
}

export async function connect(): Promise<pg.Client> {
  const url = databaseUrl();
  const local = /@(localhost|127\.0\.0\.1)[:/]|@\/|[?&]host=\//.test(url);
  const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

/** 接続先の表示用（パスワードは出さない） */
export function describeTarget(): string {
  const url = databaseUrl();
  const host = url.match(/@([^/:?]+)/)?.[1] ?? (/[?&]host=\//.test(url) ? "ローカルのDB" : null);
  return host ?? "（不明）";
}

/** 複数行の INSERT。値はすべてプレースホルダで渡す（1文あたりのパラメータ上限 65535 に収まるよう分割） */
export async function insertMany(db: pg.Client, table: string, cols: string[], rows: unknown[][], suffix = ""): Promise<void> {
  const per = Math.max(1, Math.floor(60000 / cols.length));
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const params: unknown[] = [];
    const values = chunk.map((r) => `(${r.map((v) => (params.push(v), `$${params.length}`)).join(", ")})`);
    await db.query(`INSERT INTO ${table} (${cols.join(", ")}) VALUES ${values.join(", ")} ${suffix}`, params);
  }
}

/** シーケンスから id を n 件確保する（アプリの登録と同時に走っても重ならない） */
export async function reserveIds(db: pg.Client, table: string, n: number): Promise<number[]> {
  if (n === 0) return [];
  const r = await db.query<{ id: string }>(`SELECT nextval(pg_get_serial_sequence($1, 'id')) AS id FROM generate_series(1, $2)`, [table, n]);
  return r.rows.map((x) => Number(x.id));
}
