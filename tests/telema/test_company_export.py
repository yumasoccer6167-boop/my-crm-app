"""リストの絞り込みを Excel（.xlsx）に出力する。列は 法人名・園名・決裁者名・住所・電話番号。"""
import re
import zipfile
from io import BytesIO
from urllib.parse import unquote
from xml.etree import ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def export(client, query=''):
    r = client.http.open(f'/api/telema/companies/export{query}', headers={'Authorization': f'Bearer {client.token}'})
    return r


def read_sheet(data):
    """出力した .xlsx を読み戻して、行（文字列のリスト）の一覧にする"""
    z = zipfile.ZipFile(BytesIO(data))
    assert z.testzip() is None
    for name in ('[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml'):
        ET.fromstring(z.read(name))                                   # すべて正しい XML
    sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    rows = []
    for row in sheet.find('m:sheetData', NS):
        cells = {}
        for c in row:
            col = re.match(r'[A-Z]+', c.get('r')).group()
            t = c.find('m:is/m:t', NS)
            cells[col] = t.text if t is not None else ''
        rows.append([cells.get(x, '') for x in 'ABCDE'])
    return rows


def make(client, name, phone, address, org=None, assigned=None, user=0):
    org_id = None
    if org:
        found = client.sql('SELECT id FROM telema_organizations WHERE name = %s', (org,))
        org_id = found[0]['id'] if found else client.sql('INSERT INTO telema_organizations (name, name_normalized) VALUES (%s, %s) RETURNING id', (org, org))[0]['id']
    return client.sql(
        'INSERT INTO telema_companies (company_name, company_name_normalized, phone, address, organization_id, assigned_user_id, is_user) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id',
        (name, name, phone, address, org_id, assigned, user))[0]['id']


def test_絞り込んだ施設だけを_法人名_園名_決裁者名_住所_電話番号で出力する(client):
    a = make(client, '出力テストさくら園', '045-100-0001', '神奈川県横浜市中区1-1', org='学校法人出力会')
    b = make(client, '出力テストつばき園', '0463-20-0002', '神奈川県平塚市2-2', org='学校法人出力会')
    c = make(client, '出力テスト東京園', '03-1111-0003', '東京都新宿区3-3')
    client.api(f'/companies/{a}/contacts', {'name': '決裁 太郎', 'is_decision_maker': True})
    client.api(f'/companies/{a}/contacts', {'name': '決裁 次郎', 'is_decision_maker': True})
    client.api(f'/companies/{a}/contacts', {'name': '一般 花子'})                           # 決裁者ではない担当者は出さない
    client.sql("INSERT INTO telema_contacts (organization_id, name, is_decision_maker) VALUES ((SELECT organization_id FROM telema_companies WHERE id = %s), '法人 理事長', 1)", (b,))
    client.sql('UPDATE telema_companies SET prefecture = %s WHERE id IN (%s, %s)', ('神奈川県', a, b))

    r = export(client, '?prefecture=神奈川県&q=出力テスト&sort=company_name&order=asc')
    assert r.status_code == 200 and r.mimetype == 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    assert r.headers['X-Export-Count'] == '2'
    fname = unquote(re.search(r"filename\*=UTF-8''(.+)", r.headers['Content-Disposition']).group(1))
    assert fname.startswith('リスト_') and fname.endswith('.xlsx')
    rows = read_sheet(r.data)
    assert rows[0] == ['法人名', '園名', '決裁者名', '住所', '電話番号']
    assert rows[1][:2] == ['学校法人出力会', '出力テストさくら園'] and set(rows[1][2].split('、')) == {'決裁 太郎', '決裁 次郎', '法人 理事長'}      # 決裁者が複数なら「、」でつなぐ。法人に登録した決裁者は、その法人のどの施設にも出る（カルテと同じ）
    assert rows[1][3:] == ['神奈川県横浜市中区1-1', '045-100-0001']
    assert rows[2] == ['学校法人出力会', '出力テストつばき園', '法人 理事長', '神奈川県平塚市2-2', '0463-20-0002']      # 施設の決裁者がいなければ、法人の決裁者だけ
    assert c and all('東京園' not in x[1] for x in rows)                                  # 絞り込みに合わない施設は出ない
    # 絞り込みなし：法人なし・決裁者なしの施設は空欄で出る。電話番号の先頭の 0 も残る
    all_rows = read_sheet(export(client, '?q=出力テスト東京').data)
    assert all_rows[1] == ['', '出力テスト東京園', '', '東京都新宿区3-3', '03-1111-0003']
    log = client.sql("SELECT after_json FROM telema_audit_logs WHERE action = 'export' AND entity_type = 'company_list' ORDER BY id")
    assert len(log) == 2 and '"count": 2' in log[0]['after_json']


def test_ページに関係なく全件を出し_担当外の施設は出さず_0件でも列名は出る(client):
    mine = client.sql("SELECT id FROM users WHERE username = 'owner'")[0]['id']
    other = client.add_user('別の営業')
    for i in range(3):
        make(client, f'全件テスト園{i}', f'045-200-000{i}', '神奈川県川崎市1-1', assigned=other)
    r = export(client, '?q=全件テスト園&per_page=1&page=2')                         # ページを指定しても全件
    assert r.headers['X-Export-Count'] == '3' and len(read_sheet(r.data)) == 4
    client.set_my_role('sales')                                                       # 一般は、担当外の施設が見えない（一覧と同じ）
    r = export(client, '?q=全件テスト園')
    assert r.status_code == 200 and read_sheet(r.data) == [['法人名', '園名', '決裁者名', '住所', '電話番号']] and mine


def test_上限を超えるとき_条件が不正なときはエラー(client, monkeypatch):
    from telema import companies
    monkeypatch.setattr(companies, 'EXPORT_MAX', 1)
    make(client, '上限テスト園A', '045-300-0001', '神奈川県1-1')
    make(client, '上限テスト園B', '045-300-0002', '神奈川県1-1')
    r = export(client, '?q=上限テスト園')
    assert r.status_code == 400 and '超えています' in r.get_json()['error']['message']
    assert export(client, '?sort=nonsense').status_code == 400
