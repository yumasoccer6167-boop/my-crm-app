"""管理者用CLI（scripts/telema/*.ts）を一時的な DB に対して実際に動かす。"""
import json
import os
import shutil
import subprocess

import pytest

from conftest import ROOT

pytestmark = pytest.mark.skipif(not shutil.which('npx') or not os.path.exists(os.path.join(ROOT, 'node_modules', '.bin', 'tsx')),
                                reason='npm install が必要')

HEADERS = ['施設名', '電話番号', '住所', '法人名', '事業所番号', '施設管理者氏名', '担当者', '営業状況']


def run(client, script, *args):
    r = subprocess.run(['npx', 'tsx', f'scripts/telema/{script}', *args], cwd=ROOT, capture_output=True, text=True,
                       env={**os.environ, 'DATABASE_URL': client.uri}, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    return r.stdout


def write_list(tmp_path, rows, name='list.json'):
    p = tmp_path / name
    p.write_text(json.dumps({'file': 'テスト.xlsx', 'sheet': 'Sheet1', 'headers': HEADERS, 'rows': rows}, ensure_ascii=False))
    return str(p)


def count(client, sql, params=()):
    return client.sql(sql, params)[0]['n']


ROWS = [
    ['ひかり保育園', '029-111-0001', '茨城県水戸市三の丸1-1', '社会福祉法人ひかり会', '0810100001', '田中 花子', '佐藤', '通常営業'],
    ['ひかり第二保育園', '029-111-0002', '茨城県水戸市三の丸2-2', '社会福祉法人ひかり会', '0810100002', '', '佐藤', '通常営業'],
    ['さくら幼稚園', '029-111-0003', '茨城県つくば市竹園3-3', '', '', '鈴木 一郎', '', '廃止済'],
    # 同じファイル内の重複（事業所番号が同じ）→ 1件目に統合され、空欄だけ補完される
    ['ひかり第二保育園', '', '', '', '0810100002', '山本 次郎', '', ''],
]


def test_取り込み_dry_runでは何も登録しない(client, tmp_path):
    out = run(client, 'import-excel.ts', write_list(tmp_path, ROWS), '--source', 'テスト一覧', '--dry-run')
    assert '総行数 4 / 新規 3' in out
    assert '--dry-run のため適用しません' in out
    assert count(client, 'SELECT COUNT(*) AS n FROM telema_companies') == 0


def test_取り込みで施設_法人_担当者_取得元が登録される(client, tmp_path):
    out = run(client, 'import-excel.ts', write_list(tmp_path, ROWS), '--source', 'テスト一覧', '--type', 'public_data')
    assert '新規 3' in out and '同じファイル内 1' in out
    assert '完了' in out
    cos = client.sql('SELECT company_name, phone_normalized, prefecture, city, organization_id, status_id, notes, extra_attributes FROM telema_companies ORDER BY id')
    assert [c['company_name'] for c in cos] == ['ひかり保育園', 'ひかり第二保育園', 'さくら幼稚園']
    assert cos[0]['organization_id'] == cos[1]['organization_id'] is not None  # 同じ法人は1件
    assert cos[0]['prefecture'] == '茨城県' and cos[0]['city'] == '水戸市'
    assert json.loads(cos[0]['extra_attributes'])['担当者'] == '佐藤'
    assert cos[2]['status_id'] == client.status_id('廃業') and '営業状況: 廃止済' in cos[2]['notes']
    assert count(client, 'SELECT COUNT(*) AS n FROM telema_organizations') == 1
    # 法人代表者はいないので、施設の担当者3名（同じファイル内の統合分を含む）
    names = {r['name'] for r in client.sql('SELECT name FROM telema_contacts')}
    assert names == {'田中 花子', '鈴木 一郎', '山本 次郎'}
    assert count(client, 'SELECT COUNT(*) AS n FROM telema_company_sources') == 4
    assert client.sql("SELECT match_type FROM telema_import_rows") == [{'match_type': 'in_file'}]
    # 画面の検索・リスト取得元にも出る
    status, body = client.api('/companies?q=ひかり')
    assert status == 200 and body['total'] == 2
    sources = client.api('/list-sources')[1]
    assert {'name': 'テスト一覧', 'company_count': 3}.items() <= sources[0].items()


def test_同じリストを再度取り込むと既存に統合され増えない(client, tmp_path):
    client.sql("UPDATE telema_companies SET website = NULL, industry = '既存の業種' WHERE company_name = 'ひかり保育園'")
    rows = [r[:] for r in ROWS[:3]]
    out = run(client, 'import-excel.ts', write_list(tmp_path, rows), '--source', 'テスト一覧（2回目）')
    assert '新規 0' in out and '統合 3' in out
    assert count(client, 'SELECT COUNT(*) AS n FROM telema_companies') == 3
    assert count(client, "SELECT COUNT(*) AS n FROM telema_contacts WHERE name = '田中 花子'") == 1
    # 既存の値は上書きしない
    assert client.sql("SELECT industry FROM telema_companies WHERE company_name = 'ひかり保育園'") == [{'industry': '既存の業種'}]


def test_電話が同じで施設名が違う施設は別に登録する(client, tmp_path):
    rows = [['ほのぼのルーム', '029-111-0001', '茨城県水戸市三の丸1-1', '', '', '', '', '']]
    out = run(client, 'import-excel.ts', write_list(tmp_path, rows), '--source', '電話一致テスト')
    assert '既存候補(電話一致・別登録) 1' in out
    assert count(client, "SELECT COUNT(*) AS n FROM telema_companies WHERE phone_normalized = '0291110001'") == 2


def test_重複統合は一覧だけ出し_applyで統合する(client):
    # 電話一致・名前が表記ゆれのペアを作り、統合される側に架電履歴を付ける
    keep = client.sql("INSERT INTO telema_companies (company_name, company_name_normalized, phone_normalized) VALUES ('常磐大学幼稚園', '常磐大学幼稚園', '0292220000') RETURNING id")[0]['id']
    drop = client.sql("INSERT INTO telema_companies (company_name, company_name_normalized, phone_normalized, website) VALUES ('常磐大学 幼稚園', '常磐大学幼稚園', '0292220000', 'https://tokiwa.example.jp') RETURNING id")[0]['id']
    client.api(f'/companies/{drop}/calls', {'raw_note': '統合前の架電'})

    out = run(client, 'merge-duplicates.ts')
    assert '確認のみ' in out
    assert '要確認' in out  # ひかり保育園 と ほのぼのルーム（電話同じ・名前違い）
    assert client.sql('SELECT is_active FROM telema_companies WHERE id = %s', (drop,)) == [{'is_active': 1}]

    out = run(client, 'merge-duplicates.ts', '--apply')
    assert '完了' in out
    # 架電履歴のある側を残す
    assert client.sql('SELECT is_active FROM telema_companies WHERE id = %s', (drop,)) == [{'is_active': 1}]
    assert client.sql('SELECT is_active FROM telema_companies WHERE id = %s', (keep,)) == [{'is_active': 0}]
    kept = client.api(f'/companies/{drop}')[1]['company']
    assert kept['call_count'] == 1
    assert client.sql("SELECT action FROM telema_audit_logs WHERE action = 'merge' AND entity_id = %s", (keep,)) == [{'action': 'merge'}]
    # 名前が違う組は統合しない
    assert count(client, "SELECT COUNT(*) AS n FROM telema_companies WHERE phone_normalized = '0291110001' AND is_active = 1") == 2
