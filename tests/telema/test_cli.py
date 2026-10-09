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


def test_重複統合は施設名と住所の一致もまとめ_つながりを付け替える(client):
    ins = "INSERT INTO telema_companies (company_name, company_name_normalized, address_normalized, phone_normalized) VALUES (%s, %s, %s, %s) RETURNING id"
    keep = client.sql(ins, ('住所一致園', '住所一致園', '茨城県笠間市1-1', None))[0]['id']
    drop = client.sql(ins, ('住所一致園', '住所一致園', '茨城県笠間市1-1', '0296000001'))[0]['id']
    other = client.sql(ins, ('つながり相手園', 'つながり相手園', '茨城県笠間市9-9', None))[0]['id']
    client.sql('INSERT INTO telema_company_relations (company_a_id, company_b_id) VALUES (%s, %s)', (min(drop, other), max(drop, other)))
    client.sql('INSERT INTO telema_company_relations (company_a_id, company_b_id) VALUES (%s, %s)', (keep, drop))
    client.sql('UPDATE telema_companies SET visited_at = %s WHERE id = %s', ('2026-10-01T01:00:00.000Z', drop))

    out = run(client, 'merge-duplicates.ts', '--apply')
    assert '完了' in out
    assert client.sql('SELECT is_active, visited_at FROM telema_companies WHERE id = %s', (keep,)) == [{'is_active': 1, 'visited_at': '2026-10-01T01:00:00.000Z'}]
    assert client.sql('SELECT is_active FROM telema_companies WHERE id = %s', (drop,)) == [{'is_active': 0}]
    rels = client.sql('SELECT company_a_id, company_b_id FROM telema_company_relations WHERE is_active = 1 AND %s IN (company_a_id, company_b_id, %s)', (keep, drop))
    assert rels == [{'company_a_id': min(keep, other), 'company_b_id': max(keep, other)}]


# ---------- 電話番号照合での割り振り（tag-by-phone） ----------
def make_phone_company(client, name, phone, is_active=1):
    from telema.normalize import normalize_phone
    return client.sql(
        'INSERT INTO telema_companies (company_name, company_name_normalized, phone, phone_normalized, is_active) VALUES (%s, %s, %s, %s, %s) RETURNING id',
        (name, name, phone, normalize_phone(phone), is_active))[0]['id']


def tags(client, cid):
    lt = client.sql('SELECT t.name FROM telema_company_list_types l JOIN telema_list_types t ON t.id = l.list_type_id WHERE l.company_id = %s', (cid,))
    asc = client.sql('SELECT t.name FROM telema_company_associations l JOIN telema_associations t ON t.id = l.association_id WHERE l.company_id = %s', (cid,))
    return sorted(r['name'] for r in lt), sorted(r['name'] for r in asc)


def test_電話番号がCSVと一致する施設にリスト種類と加盟協会を割り振る(client, tmp_path):
    a = make_phone_company(client, '一致園A', '042-762-4389')
    b = make_phone_company(client, '一致園B（全角・ハイフンなし）', '０４２７６１３４６４')
    dup = make_phone_company(client, '同じ番号の別施設', '042-762-4389')
    gone = make_phone_company(client, '無効な施設', '042-762-3633', is_active=0)
    other = make_phone_company(client, '無関係園', '03-0000-0000')
    existing = client.api('/associations', {'name': 'すでにある協会'})[1]['id']
    client.api(f'/companies/{a}/associations', {'association_ids': [existing]}, method='PATCH')

    csv = tmp_path / 'list.csv'
    csv.write_text('﻿法人名,園名,住所,電話番号\n学校法人X,"大沢,幼稚園",緑区,042-762-4389\n,大沢第二,緑区,042-761-3464\n,無効園,緑区,042-762-3633\n,存在しない園,緑区,042-000-0000\n,番号なし,緑区,\n',
                   encoding='utf-8')
    args = [str(csv), '--list-type', '繋がり', '--association', 'すでにある協会', '--association', '新しい協会']

    out = run(client, 'tag-by-phone.ts', *args)               # 確認だけ
    assert 'CSVの電話番号 4件のうち 2件がテレマリストの施設と一致（施設 3件）' in out
    assert '一致なし 2件' in out and '042-000-0000' in out and '042-762-3633' in out and '番号なし：電話番号を読めません' in out
    assert tags(client, a) == ([], ['すでにある協会']) and tags(client, b) == ([], [])
    assert client.sql("SELECT COUNT(*) AS n FROM telema_associations WHERE name = '新しい協会'")[0]['n'] == 0

    run(client, 'tag-by-phone.ts', *args, '--apply')
    assert tags(client, a) == (['繋がり'], ['すでにある協会', '新しい協会'])
    assert tags(client, b) == (['繋がり'], ['すでにある協会', '新しい協会'])
    assert tags(client, dup) == (['繋がり'], ['すでにある協会', '新しい協会'])
    assert tags(client, other) == ([], []) and tags(client, gone) == ([], [])        # 一致しない・無効な施設には付けない
    assert count(client, 'SELECT COUNT(*) AS n FROM telema_audit_logs WHERE entity_type = %s', ('company_associations',)) >= 3

    # もう一度実行しても何も変わらない（すでに付いているものは増やさない・外さない）
    logs = count(client, 'SELECT COUNT(*) AS n FROM telema_audit_logs')
    out = run(client, 'tag-by-phone.ts', *args, '--apply')
    assert '新しく付ける 0件 / すでに付いている 3件' in out and '変更した施設 0件' in out
    assert count(client, 'SELECT COUNT(*) AS n FROM telema_audit_logs') == logs
    assert count(client, "SELECT COUNT(*) AS n FROM telema_associations WHERE name = '新しい協会'") == 1


def test_電話番号照合_存在しないリスト種類では止まり何も変えない(client, tmp_path):
    a = make_phone_company(client, '園', '042-762-4389')
    csv = tmp_path / 'l.csv'
    csv.write_text('園名,電話番号\n園,042-762-4389\n', encoding='utf-8')
    r = subprocess.run(['npx', 'tsx', 'scripts/telema/tag-by-phone.ts', str(csv), '--list-type', '無い種類', '--association', '作られてはいけない協会', '--apply'],
                       cwd=ROOT, capture_output=True, text=True, env={**os.environ, 'DATABASE_URL': client.uri}, timeout=120)
    assert r.returncode != 0 and 'リスト種類「無い種類」が登録されていません' in r.stdout + r.stderr
    assert tags(client, a) == ([], [])


# ---------- 契約一覧CSVの取り込み（import-contracts） ----------
def make_company_addr(client, name, phone, address, org=None, alt=None):
    from telema.normalize import normalize_address, normalize_company_name, normalize_phone
    org_id = None
    if org:
        org_id = client.sql('INSERT INTO telema_organizations (name, name_normalized) VALUES (%s, %s) RETURNING id', (org, normalize_company_name(org)))[0]['id']
    return client.sql(
        '''INSERT INTO telema_companies (company_name, company_name_normalized, phone, phone_normalized, phone_alt, address, address_normalized, organization_id)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id''',
        (name, normalize_company_name(name), phone, normalize_phone(phone), alt, address, normalize_address(address), org_id))[0]['id']


CSV_HEADER = '会社名,商品名,申込み住所,代表者名,代表者カナ,申込み電話番号,営業担当,台数担当,契約日\n'


def contracts_of(client, cid):
    return client.sql('SELECT product_name, contract_date, assigned_user_id FROM telema_contracts WHERE company_id = %s AND is_active = 1 ORDER BY product_name, contract_date', (cid,))


def test_契約一覧CSVを電話と住所で照合して契約情報に追加する(client, tmp_path):
    inagawa = client.add_user('稲川新樹')
    kama = make_company_addr(client, 'かまち保育室', '048-822-1052', '埼玉県さいたま市浦和区神明2-23-4', org='合同会社かまちえん')
    hoshi = make_company_addr(client, '星の子保育園', '042-632-2525', '東京都八王子市片倉町704-14', alt='090-1111-2222')
    only_addr = make_company_addr(client, '住所だけ保育園', '011-111-1111', '北海道札幌市中央区北1条西1-1-1')
    twin_a = make_company_addr(client, 'ひまわり保育園', '03-1111-1111', '東京都新宿区1-1-1')
    twin_b = make_company_addr(client, 'さくら保育園', '03-1111-1111', '東京都新宿区1-1-1')
    far = make_company_addr(client, '大阪の園', '06-2222-2222', '大阪府大阪市北区1-1-1')
    exists = make_company_addr(client, 'すでにある園', '04-3333-3333', '神奈川県横浜市中区1-1-1')
    client.api(f'/companies/{exists}/contracts', {'product_name': 'Site Premium', 'contract_date': '2024-04-01'})
    csv = tmp_path / '契約.csv'
    csv.write_text(CSV_HEADER + '\n'.join([
        '合同会社 かまちえん,Site Premium,埼玉県さいたま市浦和区神明2-23-4,蒲池,カマチ,048-822-1052,稲川新樹,x,2019/09/21',   # 電話＋住所
        '合同会社 かまちえん,Site Premium,埼玉県さいたま市浦和区神明2-23-4,蒲池,カマチ,048-822-1052,稲川新樹,x,2019/09/21',   # CSV内の重複
        '合同会社 かまちえん,Movie Premium,埼玉県さいたま市浦和区神明2-23-4,蒲池,カマチ,048-822-1052,8finity（営業）,x,2024/07/04',   # 営業担当がメンバーでない
        '一般社団法人　星の子保育園,Site Premium,東京都八王子市片倉町1-1,野邉,ノベ,090-1111-2222,,x,2022/08/27',   # その他の電話番号で一致
        '住所だけ,Appli Premium,北海道札幌市中央区北1条西1-1-1,x,x,,,x,2021/01/05',   # 住所だけで一致
        'どちらか,Site Premium,東京都新宿区1-1-1,x,x,03-1111-1111,,x,2021/02/03',   # 同じ電話・住所の施設が2つ、名前でも決まらない
        'さくら保育園,Site Premium,東京都新宿区1-1-1,x,x,03-1111-1111,,x,2021/02/04',   # 名前で1つに決まる
        '遠い会社,Site Premium,東京都港区1-1-1,x,x,06-2222-2222,,x,2021/03/03',   # 電話は一致するが住所の市区町村が違う
        'どこにもない,Site Premium,東京都港区9-9-9,x,x,03-9999-9999,,x,2021/03/03',   # 一致なし
        'すでにある園,Site Premium,神奈川県横浜市中区1-1-1,x,x,04-3333-3333,,x,2024/04/01',   # すでに同じ契約あり
        'かまち,,埼玉県さいたま市浦和区神明2-23-4,x,x,048-822-1052,,x,2020/01/01',   # 商品名なし
        'かまち,Site Premium,埼玉県さいたま市浦和区神明2-23-4,x,x,048-822-1052,,x,',   # 契約日なし
    ]) + '\n', encoding='utf-8')
    report = tmp_path / 'report.tsv'

    out = run(client, 'import-contracts.ts', str(csv), '--report', str(report))        # 確認だけ
    assert '追加する契約情報 5件（4施設）' in out and '--apply が無いので' in out
    assert '施設が見つからない 1行 / 要確認 2行 / すでに同じ契約あり 1行 / CSV内の重複 1行 / 商品名なし 1行 / 契約日が読めない・なし 1行' in out
    assert '8finity（営業） 1' in out
    assert count(client, 'SELECT COUNT(*) AS n FROM telema_contracts WHERE company_id <> %s', (exists,)) == 0
    text = report.read_text(encoding='utf-8')
    assert 'どこにもない' in text and '電話番号は一致するが住所の都道府県・市区町村が違う' in text and '会社名では1つに決まらない' in text

    run(client, 'import-contracts.ts', str(csv), '--apply')
    assert [(r['product_name'], r['contract_date'], r['assigned_user_id']) for r in contracts_of(client, kama)] == [
        ('Movie Premium', '2024-07-04', None), ('Site Premium', '2019-09-21', inagawa)]
    assert [(r['product_name'], r['contract_date']) for r in contracts_of(client, hoshi)] == [('Site Premium', '2022-08-27')]
    assert [(r['product_name'], r['contract_date']) for r in contracts_of(client, only_addr)] == [('Appli Premium', '2021-01-05')]
    assert [(r['product_name'], r['contract_date']) for r in contracts_of(client, twin_b)] == [('Site Premium', '2021-02-04')]
    assert contracts_of(client, twin_a) == [] and contracts_of(client, far) == []
    assert len(contracts_of(client, exists)) == 1
    assert count(client, "SELECT COUNT(*) AS n FROM telema_audit_logs WHERE entity_type = 'contract' AND action = 'create'") >= 5

    # もう一度実行しても増えない
    out = run(client, 'import-contracts.ts', str(csv), '--apply')
    assert '追加する契約情報 0件' in out
    assert len(contracts_of(client, kama)) == 2
