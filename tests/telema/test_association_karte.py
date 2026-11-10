"""協会カルテ：加盟施設数・加盟法人数・業種別・ユーザー率・会長役員・協会HPのリンク"""


def make_company(client, name, industry=None, org=None, is_user=0):
    org_id = None
    if org:
        found = client.sql('SELECT id FROM telema_organizations WHERE name = %s', (org,))
        org_id = found[0]['id'] if found else client.sql('INSERT INTO telema_organizations (name, name_normalized) VALUES (%s, %s) RETURNING id', (org, org))[0]['id']
    return client.sql(
        'INSERT INTO telema_companies (company_name, company_name_normalized, industry, organization_id, is_user) VALUES (%s, %s, %s, %s, %s) RETURNING id',
        (name, name, industry, org_id, is_user))[0]['id']


def join(client, cid, assoc):
    have = [x['id'] for x in client.api(f'/companies/{cid}')[1]['associations']]
    client.api(f'/companies/{cid}/associations', {'association_ids': [*have, assoc]}, method='PATCH')


def test_協会カルテは加盟施設_法人_業種別_ユーザー率を下位の協会も含めて数える(client):
    top = client.api('/associations', {'name': 'カルテ県協会'})[1]['id']
    sub = client.api('/associations', {'name': 'カルテ市協会'})[1]['id']
    client.api(f'/associations/{sub}/structure', {'parent_id': top}, method='PATCH')
    f1 = make_company(client, 'カルテ園1', '保育園', org='学校法人カルテ会', is_user=1)
    f2 = make_company(client, 'カルテ園2', '保育園', org='学校法人カルテ会')
    f3 = make_company(client, 'カルテ園3', '幼稚園', org='学校法人別カルテ会')
    f4 = make_company(client, 'カルテ園4', None)                                   # 業種なし・法人なし
    f5 = make_company(client, 'カルテ園5', '認定こども園', org='学校法人三つ目会', is_user=1)
    for cid in (f1, f2, f3):
        join(client, cid, top)
    for cid in (f4, f5, f3):
        join(client, cid, sub)                                                    # f3 は両方に入っていても1施設
    client.api(f'/companies/{f1}/contacts', {'name': 'カルテ会長', 'role': '理事長', 'is_association_chair': True})
    client.api(f'/companies/{f2}/contacts', {'name': 'カルテ役員', 'is_association_officer': True})

    status, k = client.api(f'/associations/{top}/karte')
    m = k['metrics']
    assert status == 200 and k['association']['path'] == ['カルテ県協会']
    assert (m['facility_count'], m['own_facility_count'], m['organization_count']) == (5, 3, 3)
    assert (m['user_facility_count'], m['user_organization_count'], m['user_rate']) == (2, 2, 66.7)       # ユーザー法人2 ÷ 加盟法人3
    by = {i['industry']: i for i in k['industries']}
    assert [(i['industry'], i['count']) for i in k['industries']] == [('保育園', 2), ('幼稚園', 1), ('認定こども園', 1), ('未設定', 1)]      # 多い順、未設定は最後
    assert (by['保育園']['user_count'], by['認定こども園']['user_count']) == (1, 1)
    assert [c['name'] for c in k['chairs']] == ['カルテ会長'] and [o['name'] for o in k['officers']] == ['カルテ役員']

    k2 = client.api(f'/associations/{sub}/karte')[1]
    assert k2['association']['path'] == ['カルテ県協会', 'カルテ市協会'] and k2['metrics']['facility_count'] == 3

    empty = client.api('/associations', {'name': 'カルテ空協会'})[1]['id']
    e = client.api(f'/associations/{empty}/karte')[1]
    assert (e['metrics']['facility_count'], e['metrics']['user_rate'], e['industries']) == (0, None, [])
    assert client.api('/associations/999999/karte')[0] == 404


def test_協会カルテの会長名_役員名_協会HPを保存し_空にすると消える_権限(client):
    a = client.api('/associations', {'name': 'カルテ入力協会'})[1]['id']
    status, k = client.api(f'/associations/{a}/karte', {'website_url': 'https://example.org/kyokai', 'chair_name': '山田 太郎', 'officer_names': '副会長 佐藤\n理事 鈴木'}, method='PATCH')
    assert status == 200 and k['association']['website_url'] == 'https://example.org/kyokai' and k['association']['chair_name'] == '山田 太郎'
    assert '理事 鈴木' in k['association']['officer_names']
    # 一部だけ変えても、ほかは残る。空にした項目は消える
    k = client.api(f'/associations/{a}/karte', {'chair_name': '', 'officer_names': '更新後'}, method='PATCH')[1]
    assert (k['association']['chair_name'], k['association']['officer_names'], k['association']['website_url']) == (None, '更新後', 'https://example.org/kyokai')
    # http(s) 以外のURLと、何も指定しない更新は受け付けない
    assert client.api(f'/associations/{a}/karte', {'website_url': 'javascript:alert(1)'}, method='PATCH')[0] == 400
    assert client.api(f'/associations/{a}/karte', {}, method='PATCH')[0] == 400
    assert client.api('/associations/999999/karte', {'chair_name': 'x'}, method='PATCH')[0] == 404
    # 営業は見るだけ、マネージャーは入力できる
    client.sql("UPDATE users SET role = 'general' WHERE username = 'owner'")
    try:
        assert client.api(f'/associations/{a}/karte')[0] == 200
        assert client.api(f'/associations/{a}/karte', {'chair_name': '営業が入力'}, method='PATCH')[0] == 403
        client.sql("UPDATE users SET role = 'mgr' WHERE username = 'owner'")
        assert client.api(f'/associations/{a}/karte', {'chair_name': 'マネージャーが入力'}, method='PATCH')[0] == 200
    finally:
        client.sql("UPDATE users SET role = 'owner' WHERE username = 'owner'")
