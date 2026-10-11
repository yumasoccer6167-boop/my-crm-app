"""契約一覧CSV（取り込みページ）を電話・住所で施設と照合して契約情報に追加する。"""


def make_company(client, name, phone, address, org=None, alt=None):
    from telema.normalize import normalize_address, normalize_company_name, normalize_phone
    org_id = client.sql('INSERT INTO telema_organizations (name, name_normalized) VALUES (%s, %s) RETURNING id', (org, normalize_company_name(org)))[0]['id'] if org else None
    return client.sql(
        '''INSERT INTO telema_companies (company_name, company_name_normalized, phone, phone_normalized, phone_alt, address, address_normalized, organization_id)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id''',
        (name, normalize_company_name(name), phone, normalize_phone(phone), alt, address, normalize_address(address), org_id))[0]['id']


def row(line, name, product, address, phone, sales, date):
    return {'line': line, 'name': name, 'product': product, 'address': address, 'phone': phone, 'sales': sales, 'date': date}


def contracts_of(client, cid):
    return [(r['product_name'], r['contract_date'], r['assigned_user_id']) for r in client.sql(
        'SELECT product_name, contract_date, assigned_user_id FROM telema_contracts WHERE company_id = %s AND is_active = 1 ORDER BY product_name, contract_date', (cid,))]


def post(client, rows, apply, known=''):
    status, body = client.api('/admin/contract-import', {'apply': apply, 'rows': rows, 'known_keys': known})
    assert status == 200, body
    return body


def test_照合して契約情報に追加し_確認だけでは何も残らない(client):
    sales = client.add_user('取込営業A')
    kama = make_company(client, 'かまち保育室', '048-822-1052', '埼玉県さいたま市浦和区神明2-23-4', org='合同会社かまちえん')
    hoshi = make_company(client, '星の子保育園', '042-632-2525', '東京都八王子市片倉町704-14', alt='090-1111-2222')
    only_addr = make_company(client, '住所だけ保育園', '011-111-1111', '北海道札幌市中央区北1条西1-1-1')
    twin_a = make_company(client, 'ひまわり保育園', '03-1111-1111', '東京都新宿区1-1-1')
    twin_b = make_company(client, 'さくら保育園', '03-1111-1111', '東京都新宿区1-1-1')
    far = make_company(client, '大阪の園', '06-2222-2222', '大阪府大阪市北区1-1-1')
    exists = make_company(client, 'すでにある園', '04-3333-3333', '神奈川県横浜市中区1-1-1')
    for _ in range(2):
        make_company(client, 'もも保育園', '05-5555-5555', '愛知県名古屋市中区1-1-1')                       # 同じ名前の施設が2つ
    client.api(f'/companies/{exists}/contracts', {'product_name': 'Site Premium', 'contract_date': '2024-04-01'})
    rows = [
        row(2, '合同会社 かまちえん', 'Site Premium', '埼玉県さいたま市浦和区神明2-23-4', '048-822-1052', '取込営業A', '2019/09/21'),
        row(3, '合同会社 かまちえん', 'Site Premium', '埼玉県さいたま市浦和区神明2-23-4', '048-822-1052', '取込営業A', '2019/09/21'),     # 重複
        row(4, '合同会社 かまちえん', 'Movie Premium', '埼玉県さいたま市浦和区神明2-23-4', '048-822-1052', '8finity（営業）', '2024/07/04'),
        row(5, '一般社団法人　星の子保育園', 'Site Premium', '東京都八王子市片倉町1-1', '090-1111-2222', '', '2022/08/27'),          # その他の電話番号
        row(6, '住所だけ', 'Appli Premium', '北海道札幌市中央区北1条西1-1-1', '', '', '2021/01/05'),
        row(7, 'どちらか', 'Site Premium', '東京都新宿区1-1-1', '03-1111-1111', '', '2021/02/03'),                                      # 要確認
        row(8, 'さくら保育園', 'Site Premium', '東京都新宿区1-1-1', '03-1111-1111', '', '2021/02/04'),
        row(9, '遠い会社', 'Site Premium', '東京都港区1-1-1', '06-2222-2222', '', '2021/03/03'),                                       # 住所の市区町村が違う
        row(10, 'どこにもない', 'Site Premium', '東京都港区9-9-9', '03-9999-9999', '', '2021/03/03'),                                 # 一致なし
        row(11, 'すでにある園', 'Site Premium', '神奈川県横浜市中区1-1-1', '04-3333-3333', '', '2024/04/01'),                          # 既存
        row(14, 'もも保育園', 'Site Premium', '愛知県名古屋市中区1-1-1', '05-5555-5555', '', '2021/04/04'),                            # 名前でも2つ残る → 要確認
        row(12, 'かまち', '', '埼玉県さいたま市浦和区神明2-23-4', '048-822-1052', '', '2020/01/01'),                                  # 商品名なし
        row(13, 'かまち', 'Site Premium', '埼玉県さいたま市浦和区神明2-23-4', '048-822-1052', '', ''),                                 # 契約日なし
    ]
    dry = post(client, rows, False)
    assert (dry['added'], dry['companies'], dry['unmatched'], dry['review'], dry['existing'], dry['duplicate'], dry['no_product'], dry['bad_date']) == (5, 4, 1, 3, 1, 1, 1, 1)
    assert dry['unknown_sales'] == {'8finity（営業）': 1}
    assert contracts_of(client, kama) == [] and client.sql('SELECT COUNT(*) AS n FROM telema_contracts')[0]['n'] == 1
    assert [r['line'] for r in dry['unmatched_rows']] == [10]
    assert {r['reason'] for r in dry['review_rows']} == {'電話番号は一致するが住所の都道府県・市区町村が違う', '電話＋住所で2施設に一致し、会社名では1つに決まらない'}

    real = post(client, rows, True)
    assert {k: real[k] for k in ('added', 'companies', 'unmatched', 'review', 'existing', 'duplicate')} == {k: dry[k] for k in ('added', 'companies', 'unmatched', 'review', 'existing', 'duplicate')}
    assert contracts_of(client, kama) == [('Movie Premium', '2024-07-04', None), ('Site Premium', '2019-09-21', sales)]
    assert contracts_of(client, hoshi) == [('Site Premium', '2022-08-27', None)]
    assert contracts_of(client, only_addr) == [('Appli Premium', '2021-01-05', None)]
    assert contracts_of(client, twin_b) == [('Site Premium', '2021-02-04', None)]
    assert contracts_of(client, twin_a) == [] and contracts_of(client, far) == [] and len(contracts_of(client, exists)) == 1
    assert client.sql("SELECT COUNT(*) AS n FROM telema_audit_logs WHERE entity_type = 'contract' AND action = 'create'")[0]['n'] >= 5

    again = post(client, rows, True)                                                  # もう一度実行しても増えない
    assert again['added'] == 0 and again['existing'] == 7       # 今回追加した5件＋CSV内の重複の行＋もともとあった1件


def test_回をまたいだ重複は_known_keys_で見分ける(client):
    c = make_company(client, '回またぎ園', '03-4444-0001', '東京都渋谷区4-4-4')
    r = [row(2, '回またぎ園', 'Site Premium', '東京都渋谷区4-4-4', '03-4444-0001', '', '2025/05/05')]
    first = post(client, r, False)
    assert first['added'] == 1 and len(first['added_keys']) == 1
    second = post(client, r, False, known='\n'.join(first['added_keys']))
    assert (second['added'], second['duplicate']) == (0, 1)
    assert contracts_of(client, c) == []


def test_管理者だけが実行でき_行数の上限がある(client):
    r = [row(2, 'x', 'p', '', '', '', '2025/01/01')]
    for role in ('manager', 'sales'):
        client.set_my_role(role)
        try:
            assert client.api('/admin/contract-import', {'apply': False, 'rows': r})[0] == 403
        finally:
            client.set_my_role('admin')
    assert client.api('/admin/contract-import', {'apply': False, 'rows': []})[0] == 400
    assert client.api('/admin/contract-import', {'apply': False, 'rows': [row(i + 2, 'x', 'p', '', '', '', '2025/01/01') for i in range(1001)]})[0] == 400
    assert client.api('/admin/contract-import', {'rows': r})[0] == 400                     # apply は必須
