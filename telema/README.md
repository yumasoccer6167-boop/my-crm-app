# 育てるテレマリスト

架電するほど施設情報・先方担当者・営業履歴が蓄積される営業DB。CRM の「テレマリスト」メニューから使う。

## 構成

| 場所 | 中身 |
|---|---|
| `telema/` | API（Flask Blueprint、`/api/telema/*`）とテーブル定義 |
| `src/telema/` | 画面（React + TypeScript）。`src/App.jsx` の「テレマリスト」タブから読み込む |
| `tests/telema/` | API のテスト（pytest） |

- テーブルはすべて `telema_` 始まり。CRM 本体の `app_state` / `users` には書き込まない（`users` は読むだけ）
- テーブルはアプリ起動時に自動で作られる（`telema/schema.py`。適用済みの版は `telema_schema_version` に記録）
- ログインとメンバーは CRM 本体のものをそのまま使う。ロールの対応は `telema/context.py` の `ROLE_MAP`
  - オーナー → 管理者（設定変更・AI利用料の閲覧）
  - 役員・EMGR・MGR・SMGR → マネージャー（全件を見られる）
  - 一般 → 営業（自分の担当と未割当の施設だけ見られる）

## 守ること

- 架電対象は `telema_companies`（施設）。法人は `telema_organizations`
- AIは提案を返すだけ。会社情報・ステータス・次回架電日は利用者が採用したときだけ変わる
- `telema_call_logs.raw_note` は必ず保存する。AIが失敗しても架電履歴の保存は成功させる
- `telema_call_logs.record_type` は架電（call）か訪問（visit）。訪問は `visit_method`（visit｜zoom）を持ち、結果・次回架電を持たず、施設の状態・架電件数・集計・AI整理の対象外
- `telema_call_logs.visit_at` / `precheck_at`（訪問する日時・事前確認日時）は、結果が「時間設定」（区分 appointment）の架電にだけ付く。結果を時間設定以外に直すと外れる。登録用の文面は CRM 本体の「設定・管理 → 報告フォーマット」のフォーマットに値を当てはめて作る（`src/telema/lib/appointment-format.ts`）
- 履歴は削除せず `is_active = 0`
- SQL は必ずプレースホルダ（`%s`）で値を渡す。APIキーをフロントに置かない

## 環境変数（Render）

| 名前 | 必須 | 内容 |
|---|---|---|
| `GEMINI_API_KEY` | AIを使うなら | 架電メモのAI整理に使う。未設定でも架電メモの保存はできる |
| `TELEMA_AI_MODEL` | | 既定 `gemini-3.8-flash` |
| `TELEMA_AI_MONTHLY_BUDGET_USD` | | 月間のAI利用上限（USD）。既定 10、0 で無制限 |
| `TELEMA_USD_JPY` | | 管理画面の円換算レート。既定 150 |

`DATABASE_URL` は CRM 本体と同じものを使う。

## リストの取り込み（管理者用CLI）

Excel のリストを手元から本番DBへ取り込む。列名がバラバラでも項目を自動で認識し、既存の施設と重複する行は統合する。

準備（初回だけ）：Render の PostgreSQL の「External Database URL」を `.env.local` に書く（`.gitignore` 済み。**コミットしない・人に送らない**）。

```
DATABASE_URL=postgresql://...
```

```bash
pip install openpyxl
python3 scripts/telema/xlsx-to-json.py リスト.xlsx /tmp/list.json
npm run telema:import -- /tmp/list.json --source "茨城県 認可施設" --type public_data --dry-run   # 内容の確認だけ
npm run telema:import -- /tmp/list.json --source "茨城県 認可施設" --type public_data             # 取り込む
```

- 事業所番号・法人番号・電話番号が既存と一致する行は既存の施設に統合する（空欄の補完と元データ列の追記だけ。既存の値は上書きしない）
- 電話が同じでも施設名が違う場合は別の施設として登録する（`--on-phone-match merge|separate|skip` で変更可）
- 1回の取り込みはまとめて適用する。途中で失敗したら何も登録されない

施設の位置（緯度・経度）を住所から入れる（国土地理院の住所検索 API。訪問ルートの画面で使う）：

```bash
npm run telema:geocode -- --users --dry-run  # ユーザーだけ、確認のみ
npm run telema:geocode -- --users            # ユーザーだけ反映（位置の無い施設すべては --users を外す）
```

電話番号がCSVと一致する施設に、リスト種類・加盟協会をまとめて割り振る（CSVに「電話番号」列が必要。追加のみで、すでに付いているものは外さない）：

```bash
npm run telema:tag-phones -- リスト.csv --list-type 繋がり --association "協会A" --association "協会B"          # 照合結果の確認だけ
npm run telema:tag-phones -- リスト.csv --list-type 繋がり --association "協会A" --association "協会B" --apply  # 割り振る
```

- リスト種類は登録済みのものだけ指定できる。加盟協会は無ければ `--apply` のときに作る
- 一致しなかったCSVの行は一覧で表示する（有効な施設だけが対象。同じ電話番号の施設が複数あれば、すべてに付ける）

契約一覧のCSV（会社名・商品名・申込み住所・申込み電話番号・営業担当・契約日）を、電話番号・住所で施設と照合して、各施設の「契約情報」に追加する：

```bash
npm run telema:contracts -- 契約一覧.csv --report /tmp/契約照合.tsv          # 照合結果の確認だけ（一致しない行・要確認の行は report に出る）
npm run telema:contracts -- 契約一覧.csv --report /tmp/契約照合.tsv --apply  # 契約情報を追加する
```

- 電話番号・住所のどちらかで1施設に決まれば追加する。複数の施設に一致するときは会社名で絞り、決まらなければ「要確認」にして追加しない
- 営業担当はCRMのメンバー名と一致したときだけ入れる（一致しなければ空欄）。同じ施設・商材・契約日がすでにあれば追加しない

既存データの重複統合（電話番号と施設名が一致する施設、施設名と住所が一致する施設を1件にまとめる。つながり・訪問済みも引き継ぐ）：

```bash
npm run telema:merge             # 統合予定と要確認の一覧を出すだけ
npm run telema:merge -- --apply  # 統合する
```

## 開発

```bash
pip install -r requirements.txt -r requirements-dev.txt
npm install
npm run typecheck   # src/telema の型チェック
npm run build
pytest tests/telema # 一時的な PostgreSQL（pgserver）を立てて API を確かめる
```
