"""テレマリストのテーブル定義（PostgreSQL）。起動時に未適用の分だけ順に適用する。

方針:
 * テーブルはすべて telema_ 始まり（CRM本体の app_state / users とぶつけない）
 * ユーザーは CRM本体の users.id をそのまま使う。CRM側でメンバーを削除できるよう外部キーは張らない
 * 架電対象は telema_companies（施設・拠点）。法人は telema_organizations として親に紐付ける（1法人:N施設）
 * 会社の「現在の状態」と「架電履歴(telema_call_logs)」を分離する
 * 履歴は削除せず is_active=0 で無効化する
 * AIの出力は提案として保存し、承認されたものだけを本体へ反映する
 * 日時はすべて UTC の ISO8601 文字列（例 2026-10-01T03:00:00.000Z）で保存し、表示時に JST へ変換する
   （画面・取り込みCLIと同じ形式のまま文字列比較できるようにするため TEXT にしている）
"""

MIGRATIONS = [
    # 1: 初期スキーマ
    r"""
CREATE OR REPLACE FUNCTION telema_now() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- ===== ステータスマスタ（管理者が追加・変更可能） =====
CREATE TABLE telema_call_statuses (
  id          SERIAL PRIMARY KEY,
  label       TEXT NOT NULL UNIQUE,
  category    TEXT NOT NULL CHECK (category IN ('not_started', 'in_progress', 'appointment', 'won', 'lost', 'excluded')),
  color       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT telema_now(),
  updated_at  TEXT NOT NULL DEFAULT telema_now()
);

-- ===== 法人 =====
CREATE TABLE telema_organizations (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT NOT NULL,
  name_normalized       TEXT NOT NULL,
  name_kana             TEXT,
  corporation_type      TEXT,
  corporate_number      TEXT,
  phone                 TEXT,
  phone_normalized      TEXT,
  postal_code           TEXT,
  address               TEXT,
  website               TEXT,
  representative_name   TEXT,
  representative_title  TEXT,
  notes                 TEXT,
  extra_attributes      TEXT,                  -- JSON: 標準項目に割り当てなかった列
  created_at            TEXT NOT NULL DEFAULT telema_now(),
  updated_at            TEXT NOT NULL DEFAULT telema_now()
);
CREATE INDEX telema_idx_org_name_norm ON telema_organizations(name_normalized);
CREATE INDEX telema_idx_org_phone     ON telema_organizations(phone_normalized);

-- ===== 架電対象（施設・拠点・会社） =====
CREATE TABLE telema_companies (
  id                        SERIAL PRIMARY KEY,
  organization_id           INTEGER REFERENCES telema_organizations(id),
  company_name              TEXT NOT NULL,
  company_name_normalized   TEXT NOT NULL,
  name_kana                 TEXT,
  facility_code             TEXT,
  corporate_number          TEXT,
  phone                     TEXT,
  phone_normalized          TEXT,
  phone_alt                 TEXT,
  website                   TEXT,
  website_domain            TEXT,
  postal_code               TEXT,
  prefecture                TEXT,
  city                      TEXT,
  address                   TEXT,
  address_normalized        TEXT,
  latitude                  DOUBLE PRECISION,
  longitude                 DOUBLE PRECISION,
  industry                  TEXT,
  employee_count            INTEGER,
  notes                     TEXT,
  google_rating             DOUBLE PRECISION CHECK (google_rating BETWEEN 0 AND 5),
  google_review_count       INTEGER CHECK (google_review_count >= 0),
  map_url                   TEXT,
  -- 営業情報（現在の状態）
  status_id                 INTEGER REFERENCES telema_call_statuses(id),
  temperature               TEXT NOT NULL DEFAULT 'unrated' CHECK (temperature IN ('unrated', 'low', 'mid', 'high')),
  ai_temperature            TEXT CHECK (ai_temperature IN ('unrated', 'low', 'mid', 'high')),
  ai_temperature_score      INTEGER CHECK (ai_temperature_score BETWEEN 0 AND 100),
  interest                  TEXT,
  pain_point                TEXT,
  decision_timing           TEXT,
  budget                    TEXT,
  current_service           TEXT,
  competitor                TEXT,
  ng_reason                 TEXT,
  summary                   TEXT,
  current_note              TEXT,
  next_action               TEXT,
  next_call_at              TEXT,
  last_called_at            TEXT,
  call_count                INTEGER NOT NULL DEFAULT 0,
  assigned_user_id          INTEGER,           -- users.id（CRM本体）
  is_active                 INTEGER NOT NULL DEFAULT 1,
  extra_attributes          TEXT,              -- JSON: 標準項目に割り当てなかった列（捨てずに保持）
  search_text               TEXT,              -- キーワード検索用（トリガーで更新）
  created_at                TEXT NOT NULL DEFAULT telema_now(),
  updated_at                TEXT NOT NULL DEFAULT telema_now()
);
CREATE INDEX telema_idx_co_org        ON telema_companies(organization_id);
CREATE INDEX telema_idx_co_name_norm  ON telema_companies(company_name_normalized);
CREATE INDEX telema_idx_co_phone      ON telema_companies(phone_normalized);
CREATE INDEX telema_idx_co_status     ON telema_companies(status_id);
CREATE INDEX telema_idx_co_next_call  ON telema_companies(next_call_at);
CREATE INDEX telema_idx_co_assigned   ON telema_companies(assigned_user_id);
CREATE INDEX telema_idx_co_updated    ON telema_companies(updated_at);

-- 項目ごとの情報源（現在値の出所）。変更履歴そのものは telema_audit_logs に残す
CREATE TABLE telema_company_field_sources (
  company_id   INTEGER NOT NULL REFERENCES telema_companies(id),
  field        TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('excel', 'csv', 'web', 'manual', 'call', 'ai', 'verified')),
  source_ref   TEXT,
  confidence   DOUBLE PRECISION CHECK (confidence BETWEEN 0 AND 1),
  updated_by   INTEGER,
  updated_at   TEXT NOT NULL DEFAULT telema_now(),
  PRIMARY KEY (company_id, field)
);

-- ===== 先方担当者 =====
CREATE TABLE telema_contacts (
  id                 SERIAL PRIMARY KEY,
  company_id         INTEGER REFERENCES telema_companies(id),
  organization_id    INTEGER REFERENCES telema_organizations(id),
  name               TEXT,
  department         TEXT,
  role               TEXT,
  phone              TEXT,
  email              TEXT,
  is_decision_maker  INTEGER NOT NULL DEFAULT 0,
  notes              TEXT,
  source             TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('excel', 'csv', 'web', 'manual', 'call', 'ai', 'verified')),
  source_ref         TEXT,
  confidence         DOUBLE PRECISION CHECK (confidence BETWEEN 0 AND 1),
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT telema_now(),
  updated_at         TEXT NOT NULL DEFAULT telema_now(),
  CHECK (company_id IS NOT NULL OR organization_id IS NOT NULL)
);
CREATE INDEX telema_idx_contacts_company ON telema_contacts(company_id);
CREATE INDEX telema_idx_contacts_org     ON telema_contacts(organization_id);

-- ===== 架電履歴（原文を必ず保存。AIが失敗しても保存される） =====
CREATE TABLE telema_call_logs (
  id                  SERIAL PRIMARY KEY,
  company_id          INTEGER NOT NULL REFERENCES telema_companies(id),
  contact_id          INTEGER REFERENCES telema_contacts(id),
  user_id             INTEGER,
  called_at           TEXT NOT NULL,
  phone_number        TEXT,
  result_status_id    INTEGER REFERENCES telema_call_statuses(id),
  raw_note            TEXT NOT NULL DEFAULT '',
  input_method        TEXT NOT NULL DEFAULT 'text' CHECK (input_method IN ('text', 'voice', 'import')),
  ai_status           TEXT NOT NULL DEFAULT 'pending' CHECK (ai_status IN ('pending', 'done', 'failed', 'skipped')),
  ai_error            TEXT,
  ai_model            TEXT,
  ai_summary          TEXT,
  ai_extracted_json   TEXT,
  ai_next_action      TEXT,
  ai_next_call_at     TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT telema_now(),
  updated_at          TEXT NOT NULL DEFAULT telema_now()
);
CREATE INDEX telema_idx_calls_company ON telema_call_logs(company_id, called_at);
CREATE INDEX telema_idx_calls_user    ON telema_call_logs(user_id, called_at);
CREATE INDEX telema_idx_calls_called  ON telema_call_logs(called_at);

-- ===== リスト取得元 =====
CREATE TABLE telema_list_sources (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  source_type  TEXT NOT NULL DEFAULT 'excel' CHECK (source_type IN ('exhibition', 'web', 'purchased', 'referral', 'sales', 'customer', 'excel', 'csv', 'public_data', 'google_maps', 'other')),
  description  TEXT,
  created_at   TEXT NOT NULL DEFAULT telema_now()
);

-- ===== インポートジョブ =====
CREATE TABLE telema_import_jobs (
  id                 SERIAL PRIMARY KEY,
  file_name          TEXT NOT NULL,
  sheet_name         TEXT,
  list_source_id     INTEGER REFERENCES telema_list_sources(id),
  status             TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'mapping', 'previewed', 'importing', 'completed', 'failed', 'cancelled')),
  total_rows         INTEGER NOT NULL DEFAULT 0,
  new_rows           INTEGER NOT NULL DEFAULT 0,
  candidate_rows     INTEGER NOT NULL DEFAULT 0,
  duplicate_rows     INTEGER NOT NULL DEFAULT 0,
  error_rows         INTEGER NOT NULL DEFAULT 0,
  mapping_json       TEXT,
  value_mapping_json TEXT,
  error_message      TEXT,
  created_by         INTEGER,
  created_at         TEXT NOT NULL DEFAULT telema_now(),
  completed_at       TEXT
);

-- インポート前の行（重複判定と利用者の判断を保持するステージング）
CREATE TABLE telema_import_rows (
  id                  SERIAL PRIMARY KEY,
  import_job_id       INTEGER NOT NULL REFERENCES telema_import_jobs(id),
  row_index           INTEGER NOT NULL,
  mapped_json         TEXT NOT NULL,
  extra_json          TEXT,
  validation_errors   TEXT,
  match_type          TEXT CHECK (match_type IN ('none', 'facility_code', 'corporate_number', 'phone', 'name_address', 'domain', 'ai', 'in_file')),
  matched_company_id  INTEGER REFERENCES telema_companies(id),
  match_score         DOUBLE PRECISION,
  decision            TEXT CHECK (decision IN ('new', 'merge', 'separate', 'skip')),
  result_company_id   INTEGER REFERENCES telema_companies(id),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'imported', 'skipped', 'error')),
  UNIQUE (import_job_id, row_index)
);

-- 会社とリストの多対多（同じ会社が複数リストに存在してよい）
CREATE TABLE telema_company_sources (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER NOT NULL REFERENCES telema_companies(id),
  source_id       INTEGER REFERENCES telema_list_sources(id),
  import_job_id   INTEGER REFERENCES telema_import_jobs(id),
  source_row      INTEGER,
  created_at      TEXT NOT NULL DEFAULT telema_now()
);
CREATE INDEX telema_idx_company_sources_company ON telema_company_sources(company_id);
CREATE INDEX telema_idx_company_sources_source  ON telema_company_sources(source_id);

-- ===== AI提案（直接確定しない） =====
CREATE TABLE telema_ai_suggestions (
  id                    SERIAL PRIMARY KEY,
  company_id            INTEGER REFERENCES telema_companies(id),
  call_log_id           INTEGER REFERENCES telema_call_logs(id),
  import_job_id         INTEGER REFERENCES telema_import_jobs(id),
  suggestion_type       TEXT NOT NULL CHECK (suggestion_type IN ('field_update', 'contact', 'next_action', 'summary', 'temperature', 'status', 'duplicate', 'column_mapping')),
  field                 TEXT,
  payload_json          TEXT NOT NULL,
  confidence            DOUBLE PRECISION CHECK (confidence BETWEEN 0 AND 1),
  model                 TEXT,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'modified', 'rejected', 'superseded')),
  decided_payload_json  TEXT,
  approved_by           INTEGER,
  approved_at           TEXT,
  created_at            TEXT NOT NULL DEFAULT telema_now()
);
CREATE INDEX telema_idx_ai_sugg_company ON telema_ai_suggestions(company_id, status);
CREATE INDEX telema_idx_ai_sugg_call    ON telema_ai_suggestions(call_log_id);

-- ===== AI呼び出しごとの利用量と概算料金（管理者だけが閲覧） =====
CREATE TABLE telema_ai_usage_logs (
  id              SERIAL PRIMARY KEY,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  feature         TEXT NOT NULL,
  user_id         INTEGER,
  company_id      INTEGER REFERENCES telema_companies(id),
  call_log_id     INTEGER REFERENCES telema_call_logs(id),
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_usd        DOUBLE PRECISION NOT NULL DEFAULT 0,
  status          TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  error           TEXT,
  latency_ms      INTEGER,
  created_at      TEXT NOT NULL DEFAULT telema_now()
);
CREATE INDEX telema_idx_ai_usage_created ON telema_ai_usage_logs(created_at);

-- ===== 操作ログ =====
CREATE TABLE telema_audit_logs (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    INTEGER,
  before_json  TEXT,
  after_json   TEXT,
  created_at   TEXT NOT NULL DEFAULT telema_now()
);
CREATE INDEX telema_idx_audit_entity ON telema_audit_logs(entity_type, entity_id);

-- ===== 施設どうしのつながり（相関図の「線」） =====
-- 向きは持たない。同じ組を二重に登録しないよう company_a_id < company_b_id で保存する
CREATE TABLE telema_company_relations (
  id            SERIAL PRIMARY KEY,
  company_a_id  INTEGER NOT NULL REFERENCES telema_companies(id),
  company_b_id  INTEGER NOT NULL REFERENCES telema_companies(id),
  contact_a_id  INTEGER REFERENCES telema_contacts(id),
  contact_b_id  INTEGER REFERENCES telema_contacts(id),
  label         TEXT,
  notes         TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT telema_now(),
  updated_at    TEXT NOT NULL DEFAULT telema_now(),
  CHECK (company_a_id < company_b_id)
);
CREATE UNIQUE INDEX telema_idx_rel_pair ON telema_company_relations(company_a_id, company_b_id) WHERE is_active = 1;
CREATE INDEX telema_idx_rel_b ON telema_company_relations(company_b_id) WHERE is_active = 1;

-- ===== キーワード検索 =====
-- 施設名・カナ・住所・電話（正規化）・法人名・有効な先方担当者名を改行区切りで search_text に持つ。
-- トリガーで更新するので、API・取り込みCLIのどちらから書いても追従する
CREATE OR REPLACE FUNCTION telema_company_search_text(p_id INTEGER, p_name TEXT, p_kana TEXT, p_address TEXT, p_phone TEXT, p_org INTEGER)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT concat_ws(E'\n', p_name, p_kana, p_address, p_phone,
    (SELECT o.name FROM telema_organizations o WHERE o.id = p_org),
    (SELECT string_agg(ct.name, E'\n') FROM telema_contacts ct WHERE ct.company_id = p_id AND ct.is_active = 1 AND ct.name IS NOT NULL))
$$;

CREATE OR REPLACE FUNCTION telema_companies_search_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := telema_company_search_text(NEW.id, NEW.company_name, NEW.name_kana, NEW.address, NEW.phone_normalized, NEW.organization_id);
  RETURN NEW;
END $$;
CREATE TRIGGER telema_companies_search BEFORE INSERT OR UPDATE OF company_name, name_kana, address, phone_normalized, organization_id, search_text
  ON telema_companies FOR EACH ROW EXECUTE FUNCTION telema_companies_search_trg();

-- 法人名・先方担当者が変わったら、関係する施設の search_text を作り直す（search_text への代入で上のトリガーが動く）
CREATE OR REPLACE FUNCTION telema_organizations_search_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE telema_companies SET search_text = NULL WHERE organization_id = NEW.id;
  RETURN NULL;
END $$;
CREATE TRIGGER telema_organizations_search AFTER UPDATE OF name ON telema_organizations
  FOR EACH ROW EXECUTE FUNCTION telema_organizations_search_trg();

CREATE OR REPLACE FUNCTION telema_contacts_search_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    UPDATE telema_companies SET search_text = NULL WHERE id = OLD.company_id;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.company_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.company_id END) THEN
    UPDATE telema_companies SET search_text = NULL WHERE id = NEW.company_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER telema_contacts_search AFTER INSERT OR DELETE OR UPDATE OF name, is_active, company_id ON telema_contacts
  FOR EACH ROW EXECUTE FUNCTION telema_contacts_search_trg();

-- ===== 初期データ：自社の既存ステータス区分（運用に合わせて管理画面から変更する） =====
INSERT INTO telema_call_statuses (label, category, sort_order) VALUES
  ('未コール',       'not_started', 10),
  ('再コール',       'in_progress', 20),
  ('見込み',         'in_progress', 30),
  ('条件見込み',     'in_progress', 40),
  ('決対話アポれず', 'in_progress', 50),
  ('決直電',         'in_progress', 60),
  ('直FAX',          'in_progress', 70),
  ('時間設定成立',   'appointment', 80),
  ('受注成立',       'won',         90),
  ('受注不成立',     'lost',        100),
  ('詰め直しNG',     'lost',        110),
  ('リリース',       'excluded',    120),
  ('アポ禁',         'excluded',    130),
  ('現アナ',         'excluded',    140),
  ('廃業',           'excluded',    150),
  ('5店舗以上',      'excluded',    160),
  ('10店鋪以上',     'excluded',    170);
""",
    # 2: 初回訪問の済み印（訪問ルートから外す）
    r"""
ALTER TABLE telema_companies ADD COLUMN visited_at TEXT;
""",
    # 3: ユーザー（導入済み）をステータスとは別の項目にする。ステータス「ユーザー」の施設は is_user = 1・ステータス「受注成立」へ移し、
    #    ステータス「ユーザー」は無効にする（見込み・再コールなどの営業ステータスはユーザーにも付けられる）
    r"""
ALTER TABLE telema_companies ADD COLUMN is_user INTEGER NOT NULL DEFAULT 0;
UPDATE telema_companies SET is_user = 1,
  status_id = COALESCE((SELECT id FROM telema_call_statuses WHERE label = '受注成立'), status_id), updated_at = telema_now()
  WHERE status_id IN (SELECT id FROM telema_call_statuses WHERE label = 'ユーザー');
UPDATE telema_call_statuses SET is_active = 0, updated_at = telema_now() WHERE label = 'ユーザー';
CREATE INDEX telema_idx_co_is_user ON telema_companies(is_user) WHERE is_user = 1;
""",
]

# 部分一致検索を速くする索引（pg_trgm）。拡張を作れない環境では索引なしの ILIKE で動く
OPTIONAL = [
    "CREATE EXTENSION IF NOT EXISTS pg_trgm",
    "CREATE INDEX IF NOT EXISTS telema_idx_co_search ON telema_companies USING gin (search_text gin_trgm_ops)",
]

_LOCK_KEY = 72_830_001  # pg_advisory_xact_lock のキー（gunicorn の複数ワーカーが同時に適用しないように）


def migrate(get_conn):
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute('SELECT pg_advisory_xact_lock(%s)', (_LOCK_KEY,))
        cur.execute('CREATE TABLE IF NOT EXISTS telema_schema_version (version INTEGER NOT NULL)')
        cur.execute('SELECT MAX(version) FROM telema_schema_version')
        current = cur.fetchone()[0] or 0
        for i, sql in enumerate(MIGRATIONS, start=1):
            if i <= current:
                continue
            cur.execute(sql)
            cur.execute('INSERT INTO telema_schema_version (version) VALUES (%s)', (i,))
        conn.commit()
        for sql in OPTIONAL:
            try:
                cur = conn.cursor()
                cur.execute(sql)
                conn.commit()
            except Exception as e:
                conn.rollback()
                print('telema optional migration skipped:', e)
    finally:
        conn.close()
