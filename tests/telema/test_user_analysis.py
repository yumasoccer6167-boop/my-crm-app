"""ユーザー分析：業種別・地域別（都道府県／市区町村）・接点別（契約情報の課題）"""


def make(client, name, prefecture=None, city=None, industry=None, is_user=0, org=None):
    org_id = None
    if org:
        found = client.sql('SELECT id FROM telema_organizations WHERE name = %s', (org,))
        org_id = found[0]['id'] if found else client.sql('INSERT INTO telema_organizations (name, name_normalized) VALUES (%s, %s) RETURNING id', (org, org))[0]['id']
    return client.sql(
        'INSERT INTO telema_companies (company_name, company_name_normalized, prefecture, city, industry, is_user, organization_id) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id',
        (name, name, prefecture, city, industry, is_user, org_id))[0]['id']


def test_ユーザー分析は業種別_地域別_接点別に数える(client):
    before = client.api('/user-analysis')[1]
    a = make(client, '分析園A', '埼玉県', '川越市', '保育園', is_user=1, org='学校法人分析会')
    b = make(client, '分析園B', '埼玉県', '川越市', '保育園', org='学校法人分析会')
    c = make(client, '分析園C', '埼玉県', '所沢市', '幼稚園', is_user=1)
    d = make(client, '分析園D', '東京都', '府中市', None, is_user=1)
    e = make(client, '分析園E', None, None, '', is_user=0)                        # 住所も業種も空
    client.api(f'/companies/{a}/contracts', {'product_name': '分析商材', 'contract_date': '2026-11-01', 'issues': ['集客', '採用']})
    client.api(f'/companies/{c}/contracts', {'product_name': '分析商材', 'contract_date': '2026-11-02', 'issues': ['集客']})
    client.api(f'/companies/{d}/contracts', {'product_name': '分析商材', 'contract_date': '2026-11-03'})   # 課題を選んでいない契約
    client.api(f'/companies/{b}/contracts', {'product_name': '分析商材', 'contract_date': '2026-11-04', 'issues': ['採用']})

    status, r = client.api('/user-analysis')
    assert status == 200
    t, t0 = r['totals'], before['totals']
    assert t['facility_count'] - t0['facility_count'] == 5
    assert t['user_facility_count'] - t0['user_facility_count'] == 3
    assert t['organization_count'] - t0['organization_count'] == 1 and t['user_organization_count'] - t0['user_organization_count'] == 1

    ind = {x['industry']: x for x in r['industries']}
    ind0 = {x['industry']: x for x in before['industries']}
    assert ind['保育園']['count'] - ind0.get('保育園', {}).get('count', 0) == 2
    assert ind['保育園']['user_count'] - ind0.get('保育園', {}).get('user_count', 0) == 1
    assert ind['未設定']['count'] - ind0.get('未設定', {}).get('count', 0) == 2                      # 業種が空と未登録は「未設定」
    assert r['industries'][-1]['industry'] == '未設定'                                               # 未設定は最後

    pref = {x['prefecture']: x for x in r['prefectures']}
    pref0 = {x['prefecture']: x for x in before['prefectures']}
    assert pref['埼玉県']['total'] - pref0.get('埼玉県', {}).get('total', 0) == 3
    assert pref['埼玉県']['users'] - pref0.get('埼玉県', {}).get('users', 0) == 2
    assert pref['不明']['total'] - pref0.get('不明', {}).get('total', 0) == 1
    city = {(x['prefecture'], x['city']): x for x in r['cities']}
    city0 = {(x['prefecture'], x['city']): x for x in before['cities']}
    assert city[('埼玉県', '川越市')]['total'] - city0.get(('埼玉県', '川越市'), {}).get('total', 0) == 2
    assert city[('埼玉県', '川越市')]['users'] - city0.get(('埼玉県', '川越市'), {}).get('users', 0) == 1
    assert city[('東京都', '府中市')]['users'] - city0.get(('東京都', '府中市'), {}).get('users', 0) == 1

    needs = {x['issue']: x for x in r['needs']['items']}
    needs0 = {x['issue']: x for x in before['needs']['items']}
    g = lambda k, f: needs.get(k, {}).get(f, 0) - needs0.get(k, {}).get(f, 0)
    assert (g('集客', 'company_count'), g('集客', 'contract_count')) == (2, 2)
    assert (g('採用', 'company_count'), g('採用', 'contract_count')) == (2, 2)
    assert (g('課題未選択', 'company_count'), g('課題未選択', 'contract_count')) == (1, 1)
    assert r['needs']['contract_count'] - before['needs']['contract_count'] == 4                    # 複数の課題を選んだ契約も1件
    assert r['needs']['items'][-1]['issue'] == '課題未選択'


def test_ユーザー分析は無効な施設と削除した契約を数えない(client):
    before = client.api('/user-analysis')[1]
    x = make(client, '無効園', '千葉県', '市川市', '保育園', is_user=1)
    client.api(f'/companies/{x}/contracts', {'product_name': '分析商材', 'contract_date': '2026-11-05', 'issues': ['クチコミ対策']})
    client.sql('UPDATE telema_companies SET is_active = 0 WHERE id = %s', (x,))
    after = client.api('/user-analysis')[1]
    assert after['totals'] == before['totals']
    assert after['needs'] == before['needs']
