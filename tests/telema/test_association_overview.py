"""加盟協会の一覧（組織図・加盟施設数・加盟法人数）。"""


def make_company(client, name, prefecture=None, org=None, is_user=0, assigned=None):
    org_id = None
    if org:
        found = client.sql('SELECT id FROM telema_organizations WHERE name = %s', (org,))
        org_id = found[0]['id'] if found else client.sql('INSERT INTO telema_organizations (name, name_normalized) VALUES (%s, %s) RETURNING id', (org, org))[0]['id']
    return client.sql(
        'INSERT INTO telema_companies (company_name, company_name_normalized, prefecture, organization_id, is_user, assigned_user_id) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id',
        (name, name, prefecture, org_id, is_user, assigned))[0]['id']


def overview(client):
    status, body = client.api('/association-overview')
    assert status == 200
    return {a['name']: a for a in body['associations']}, body['totals']


def test_協会ごとの加盟施設数_加盟法人数_ユーザー数_会長役員が出る(client):
    a1 = client.api('/associations', {'name': '概要テスト横浜協会'})[1]['id']
    a2 = client.api('/associations', {'name': '概要テスト川崎協会'})[1]['id']
    empty = client.api('/associations', {'name': '概要テスト空協会'})[1]['id']
    f1 = make_company(client, '概要園1', '神奈川県', org='学校法人概要会', is_user=1)
    f2 = make_company(client, '概要園2', '神奈川県', org='学校法人概要会')
    f3 = make_company(client, '概要園3', '神奈川県', org='学校法人別概要会')
    f4 = make_company(client, '概要園4', '東京都')                                   # 法人に属していない施設
    for cid, assoc in ((f1, a1), (f2, a1), (f3, a1), (f4, a1), (f4, a2), (f3, a2)):
        client.api(f'/companies/{cid}/associations', {'association_ids': [*[x['id'] for x in client.api(f'/companies/{cid}')[1]['associations']], assoc]}, method='PATCH')
    client.api(f'/companies/{f1}/contacts', {'name': '会長 太郎', 'role': '理事長', 'is_association_chair': True})
    client.api(f'/companies/{f2}/contacts', {'name': '役員 花子', 'is_association_officer': True})
    client.api(f'/companies/{f3}/contacts', {'name': '兼任 次郎', 'is_association_chair': True, 'is_association_officer': True})
    client.api(f'/companies/{f4}/contacts', {'name': '一般 三郎'})
    by, totals = overview(client)
    y = by['概要テスト横浜協会']
    assert (y['facility_count'], y['organization_count'], y['user_count'], y['prefecture']) == (4, 2, 1, '神奈川県')       # 法人数は法人に属している施設の法人（法人なしの施設は数えない）
    assert [c['name'] for c in y['chairs']] == ['会長 太郎', '兼任 次郎'] and [o['name'] for o in y['officers']] == ['役員 花子']      # 兼任は会長として出す
    assert y['chairs'][0]['company_name'] == '概要園1' and y['chairs'][0]['role'] == '理事長'
    k = by['概要テスト川崎協会']
    assert (k['facility_count'], k['organization_count'], k['user_count']) == (2, 1, 0) and [c['name'] for c in k['chairs']] == ['兼任 次郎']
    e = by['概要テスト空協会']
    assert (e['facility_count'], e['organization_count'], e['chairs'], e['officers'], e['prefecture']) == (0, 0, [], [], None) and empty
    # 全体：同じ施設は1回だけ数える
    assert totals['facility_count'] >= 4 and totals['association_count'] >= 3


def test_協会の加盟施設一覧と_法人に登録した会長役員_全員が見られる_無効化(client):
    a = client.api('/associations', {'name': '概要メンバー協会'})[1]['id']
    x = make_company(client, '概要メンバー園X', '埼玉県', org='学校法人メンバー会')
    y = make_company(client, '概要メンバー園Y', '埼玉県', org='学校法人メンバー会')
    z = make_company(client, '概要メンバー園Z（法人なし）', '埼玉県')
    other = client.add_user('別の営業', 'sales')
    w = make_company(client, '概要メンバー園W（他人担当）', '埼玉県', assigned=other)
    for cid in (x, y, z, w):
        client.api(f'/companies/{cid}/associations', {'association_ids': [a]}, method='PATCH')
    org_id = client.sql('SELECT organization_id FROM telema_companies WHERE id = %s', (x,))[0]['organization_id']
    client.sql("INSERT INTO telema_contacts (organization_id, name, is_association_chair) VALUES (%s, '法人の会長', 1)", (org_id,))
    status, body = client.api(f'/association-overview/{a}/members')
    assert status == 200 and body['association']['name'] == '概要メンバー協会' and body['truncated'] is False
    names = [f['company_name'] for f in body['facilities']]
    assert sorted(names) == sorted(['概要メンバー園X', '概要メンバー園Y', '概要メンバー園Z（法人なし）', '概要メンバー園W（他人担当）'])
    byname = {f['company_name']: f for f in body['facilities']}
    assert byname['概要メンバー園X']['organization_name'] == '学校法人メンバー会' and byname['概要メンバー園X']['has_association_chair'] is True
    assert byname['概要メンバー園Y']['has_association_chair'] is True and byname['概要メンバー園Z（法人なし）']['organization_name'] is None
    # 法人に登録した会長は、協会の会長として1回だけ出る
    assert [c['name'] for c in overview(client)[0]['概要メンバー協会']['chairs']] == ['法人の会長']
    assert client.api('/association-overview/999999/members')[0] == 404
    # 営業を含め、全員が同じ数字を見られる（他人が担当している施設も数える）
    client.set_my_role('sales')
    try:
        assert overview(client)[0]['概要メンバー協会']['facility_count'] == 4
        assert any('W' in f['company_name'] for f in client.api(f'/association-overview/{a}/members')[1]['facilities'])
    finally:
        client.set_my_role('admin')
    # 無効にした協会も一覧には出る（is_active で見分けられる）
    client.api(f'/associations/{a}', {'is_active': False}, method='PATCH')
    assert overview(client)[0]['概要メンバー協会']['is_active'] == 0
