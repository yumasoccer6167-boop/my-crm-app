"""施設類型CSV（取り込みページ）を電話番号で施設と照合して、基本情報の「業種・施設類型」に入れる。"""


def make_company(client, name, phone, industry=None, org=None, alt=None):
    from telema.normalize import normalize_company_name, normalize_phone
    org_id = client.sql('INSERT INTO telema_organizations (name, name_normalized) VALUES (%s, %s) RETURNING id', (org, normalize_company_name(org)))[0]['id'] if org else None
    return client.sql(
        '''INSERT INTO telema_companies (company_name, company_name_normalized, phone, phone_normalized, phone_alt, industry, organization_id)
           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id''',
        (name, normalize_company_name(name), phone, normalize_phone(phone), alt, industry, org_id))[0]['id']


def industry(client, cid):
    return client.sql('SELECT industry FROM telema_companies WHERE id = %s', (cid,))[0]['industry']


def row(line, name, phone, ftype, conflict=False):
    return {'line': line, 'name': name, 'phone': phone, 'facility_type': ftype, 'conflict': conflict}


def post(client, rows, apply, overwrite=False, known=''):
    status, body = client.api('/admin/industry-import', {'apply': apply, 'overwrite': overwrite, 'rows': rows, 'known_keys': known})
    assert status == 200, body
    return body


def test_電話番号が一致する施設に施設類型を入れ_確認だけでは何も残らない(client):
    a = make_company(client, 'さくら幼稚園', '045-111-0001')
    b = make_company(client, 'つばき幼稚園', '045-111-0002', industry='幼稚園')          # すでに値あり
    c = make_company(client, 'すみれ園', '045-111-0003', industry='施設型給付を受ける幼稚園')   # すでに同じ値
    rows = [
        row(2, 'さくら幼稚園', '(045)111-0001', '施設型給付を受ける幼稚園'),   # 表記ゆれ（括弧）
        row(3, 'つばき幼稚園', '045-111-0002', '認定こども園－幼保連携型'),
        row(4, 'すみれ園', '０４５－１１１－０００３', '施設型給付を受ける幼稚園'),   # 全角
        row(5, '一致なし園', '045-999-9999', '施設型給付を受けない幼稚園'),
        row(6, '電話なし園', '', '施設型給付を受けない幼稚園'),
        row(7, '類型なし園', '045-111-0001', ''),
    ]
    r = post(client, rows, apply=False)
    assert (r['filled'], r['overwritten'], r['same'], r['kept'], r['unmatched'], r['no_phone'], r['no_type'], r['review']) == (1, 0, 1, 1, 1, 1, 1, 0)
    assert r['kept_rows'][0]['current'] == '幼稚園' and r['applied'] is False
    assert industry(client, a) is None and industry(client, b) == '幼稚園'       # 確認だけなので変わらない

    r = post(client, rows, apply=True)
    assert r['filled'] == 1 and r['types'] == {'施設型給付を受ける幼稚園': 1}
    assert industry(client, a) == '施設型給付を受ける幼稚園'
    assert industry(client, b) == '幼稚園'                                        # 既定では、入っている値は変えない
    log = client.sql("SELECT before_json, after_json FROM telema_audit_logs WHERE entity_type = 'company' AND entity_id = %s", (a,))
    assert len(log) == 1

    r = post(client, rows, apply=True, overwrite=True)
    assert r['overwritten'] == 1 and r['kept'] == 0 and r['same'] == 2
    assert industry(client, b) == '認定こども園－幼保連携型'


def test_同じ電話番号の施設が複数_CSV内で類型が食い違うときは施設名で絞れたときだけ入れる(client):
    kg = make_company(client, 'ひかり幼稚園', '046-222-0001')
    hk = make_company(client, 'ひかり保育園', '046-222-0001')
    solo = make_company(client, 'もみじ幼稚園', '046-222-0002')
    rows = [
        row(2, 'ひかり幼稚園', '046-222-0001', '施設型給付を受ける幼稚園'),            # 2施設に一致 → 名称で1つに
        row(3, 'ほし園', '046-222-0001', '認定こども園－幼稚園型'),                    # 名称で決まらない → 要確認
        row(4, 'もみじ幼稚園', '046-222-0002', '施設型給付を受ける幼稚園', conflict=True),   # 単独でも、CSV内で食い違い → 名称が合うので入れる
        row(5, 'もみじこども園', '046-222-0002', '認定こども園－幼保連携型', conflict=True),   # 名称が合わない → 要確認
    ]
    r = post(client, rows, apply=True)
    assert r['filled'] == 2 and r['review'] == 2
    assert industry(client, kg) == '施設型給付を受ける幼稚園' and industry(client, hk) is None
    assert industry(client, solo) == '施設型給付を受ける幼稚園'
    assert {x['line'] for x in r['review_rows']} == {3, 5}


def test_回をまたいで同じ施設に別の類型を入れる行は決められない(client):
    a = make_company(client, 'のぞみ幼稚園', '047-333-0001')
    first = post(client, [row(2, 'のぞみ幼稚園', '047-333-0001', '施設型給付を受ける幼稚園')], apply=False)
    assert first['filled'] == 1 and len(first['new_keys']) == 1
    known = '\n'.join(first['new_keys'])
    again = post(client, [row(3, 'のぞみ幼稚園', '047-333-0001', '施設型給付を受ける幼稚園'), row(4, 'のぞみ幼稚園', '047-333-0001', '認定こども園－幼稚園型')], apply=False, known=known)
    assert again['duplicate'] == 1 and again['review'] == 1 and again['filled'] == 0
    assert industry(client, a) is None


def test_予備の電話番号でも照合でき_管理者以外は使えない(client):
    a = make_company(client, 'あさひ園', '048-444-0001', alt='048-444-0009')
    assert post(client, [row(2, 'あさひ園', '048-444-0009', '施設型給付を受けない幼稚園')], apply=True)['filled'] == 1
    assert industry(client, a) == '施設型給付を受けない幼稚園'
    assert client.api('/admin/industry-import', {'apply': True, 'rows': []})[0] == 400
    client.set_my_role('sales')
    assert client.api('/admin/industry-import', {'apply': True, 'rows': [row(2, 'x', '048-444-0001', 'y')]})[0] == 403
