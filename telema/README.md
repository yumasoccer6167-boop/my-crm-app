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

## 開発

```bash
pip install -r requirements.txt -r requirements-dev.txt
npm install
npm run typecheck   # src/telema の型チェック
npm run build
pytest tests/telema # 一時的な PostgreSQL（pgserver）を立てて API を確かめる
```
