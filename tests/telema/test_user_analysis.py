"""ユーザー分析：ユーザー施設と契約の元データ（絞り込みと集計は画面側）"""


def make(client, name, prefecture=None, city=None, industry=None, is_user=0, org=None):
    org_id = None
    if org:
        found = client.sql('SELECT id FROM telema_organizations WHERE name = %s', (org,))
        org_id = found[0]['id'] if found else client.sql('INSERT INTO telema_organizations (name, name_normalized) VALUES (%s, %s) RETURNING id', (org, org))[0]['id']
    return client.sql(
        'INSERT INTO telema_companies (company_name, company_name_normalized, prefecture, city, industry, is_user, organization_id) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id',
        (name, name, prefecture, city, industry, is_user, org_id))[0]['id']


def test_ユーザー分析はユーザー施設とその契約だけを返す(client):
    a = make(client, '分析園A', '埼玉県', '川越市', '保育園', is_user=1, org='学校法人分析会')
    b = make(client, '分析園B', '埼玉県', '川越市', '保育園')                                    # ユーザーではない
    c = make(client, '分析園C', None, None, '', is_user=1)                                       # 住所も業種も空
    client.api(f'/companies/{a}/contracts', {'product_name': '分析商材X', 'contract_date': '2026-11-01', 'issues': ['集客', '採用'], 'gross_profit': 50000})
    client.api(f'/companies/{c}/contracts', {'product_name': '分析商材Y', 'contract_date': '2026-11-02'})          # 課題を選んでいない契約
    client.api(f'/companies/{b}/contracts', {'product_name': '分析商材Z', 'contract_date': '2026-11-03', 'issues': ['採用']})   # ユーザーではない施設の契約

    status, r = client.api('/user-analysis')
    assert status == 200
    fac = {f['id']: f for f in r['facilities']}
    assert a in fac and c in fac and b not in fac
    assert (fac[a]['industry'], fac[a]['prefecture'], fac[a]['city']) == ('保育園', '埼玉県', '川越市')
    assert fac[a]['organization_id'] is not None and fac[c]['organization_id'] is None
    assert (fac[c]['industry'], fac[c]['prefecture'], fac[c]['city']) == ('未設定', '不明', '不明')   # 空は「未設定」「不明」にまとめる

    con = {k['product']: k for k in r['contracts']}
    assert con['分析商材X']['company_id'] == a and con['分析商材X']['issues'] == ['集客', '採用'] and con['分析商材X']['gross_profit'] == 50000
    assert con['分析商材Y']['issues'] == []                                                       # 課題なしは空のリスト（画面で「課題未選択」）
    assert '分析商材Z' not in con


def test_ユーザー分析は無効な施設とユーザーでなくなった施設と削除した契約を返さない(client):
    x = make(client, '無効園', '千葉県', '市川市', '保育園', is_user=1)
    y = make(client, '外れ園', '千葉県', '船橋市', '保育園', is_user=1)
    z = make(client, '契約削除園', '千葉県', '柏市', '保育園', is_user=1)
    client.api(f'/companies/{x}/contracts', {'product_name': '分析商材W', 'contract_date': '2026-11-05', 'issues': ['クチコミ対策']})
    client.api(f'/companies/{y}/contracts', {'product_name': '分析商材W', 'contract_date': '2026-11-05', 'issues': ['クチコミ対策']})
    cid = client.api(f'/companies/{z}/contracts', {'product_name': '分析商材W', 'contract_date': '2026-11-05'})[1]['id']
    client.sql('UPDATE telema_companies SET is_active = 0 WHERE id = %s', (x,))
    client.sql('UPDATE telema_companies SET is_user = 0 WHERE id = %s', (y,))                     # ユーザーのチェックを外した
    client.sql('UPDATE telema_contracts SET is_active = 0 WHERE id = %s', (cid,))
    r = client.api('/user-analysis')[1]
    ids = {f['id'] for f in r['facilities']}
    assert x not in ids and y not in ids and z in ids
    assert not [k for k in r['contracts'] if k['product'] == '分析商材W']
