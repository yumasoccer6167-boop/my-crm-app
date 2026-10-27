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


def test_協会の階層_下位の協会の加盟施設も上位の数字に入り_親は付け替えられる(client):
    pref = client.api('/associations', {'name': '階層県協会'})[1]['id']
    district = client.api('/associations', {'name': '階層地区協会'})[1]['id']
    town = client.api('/associations', {'name': '階層地域協会'})[1]['id']
    other = client.api('/associations', {'name': '階層別県協会'})[1]['id']
    a = make_company(client, '階層園A', '神奈川県', org='学校法人階層会', is_user=1)
    b = make_company(client, '階層園B', '神奈川県', org='学校法人階層会')
    c = make_company(client, '階層園C', '神奈川県', org='学校法人階層別会')
    for cid, assoc in ((a, pref), (b, district), (c, town), (a, town)):
        client.api(f'/companies/{cid}/associations', {'association_ids': [*[x['id'] for x in client.api(f'/companies/{cid}')[1]['associations']], assoc]}, method='PATCH')
    # 親の協会を決める（県 → 地区 → 地域）。決める前は、それぞれ別の協会として数える
    by, _ = overview(client)
    assert by['階層県協会']['facility_count'] == 1 and by['階層地域協会']['facility_count'] == 2
    assert client.api(f'/associations/{district}/structure', {'parent_id': pref}, method='PATCH')[1]['parent_id'] == pref
    assert client.api(f'/associations/{town}/structure', {'parent_id': district}, method='PATCH')[0] == 200
    by, totals = overview(client)
    p = by['階層県協会']
    assert (p['facility_count'], p['own_facility_count'], p['organization_count'], p['user_count']) == (3, 1, 2, 1)           # 下位の協会の施設も入る。同じ施設（A）は1回だけ
    d = by['階層地区協会']
    assert (d['facility_count'], d['own_facility_count'], d['parent_id']) == (3, 1, pref)                                  # 地区 = 自分（B）＋地域（C, A）
    assert (by['階層地域協会']['facility_count'], by['階層地域協会']['parent_id']) == (2, district)
    assert by['階層県協会']['parent_id'] is None
    # 都道府県を指定すると、加盟施設の多数決より優先する。地区は都道府県から決まる
    assert client.api(f'/associations/{pref}/structure', {'prefecture': '東京都'}, method='PATCH')[1]['prefecture'] == '東京都'
    assert overview(client)[0]['階層県協会']['prefecture'] == '東京都' and overview(client)[0]['階層県協会']['prefecture_setting'] == '東京都'
    assert client.api(f'/associations/{pref}/structure', {'prefecture': '東京'}, method='PATCH')[0] == 400
    assert client.api(f'/associations/{pref}/structure', {'prefecture': None}, method='PATCH')[1]['prefecture'] is None
    # 自分自身・下位の協会は親にできない（ぐるぐる回らない）。存在しない親・存在しない協会は拒否
    assert client.api(f'/associations/{pref}/structure', {'parent_id': pref}, method='PATCH')[0] == 400
    assert client.api(f'/associations/{pref}/structure', {'parent_id': town}, method='PATCH')[0] == 400
    assert client.api(f'/associations/{pref}/structure', {'parent_id': 999999}, method='PATCH')[0] == 400
    assert client.api('/associations/999999/structure', {'parent_id': None}, method='PATCH')[0] == 404
    # 親を外す・付け替える
    assert client.api(f'/associations/{town}/structure', {'parent_id': other}, method='PATCH')[1]['parent_id'] == other
    by = overview(client)[0]
    assert by['階層県協会']['facility_count'] == 2 and by['階層別県協会']['facility_count'] == 2 and by['階層地区協会']['facility_count'] == 1
    assert client.api(f'/associations/{town}/structure', {'parent_id': None}, method='PATCH')[1]['parent_id'] is None
    # 変更は管理者のみ
    client.set_my_role('manager')
    try:
        assert client.api(f'/associations/{town}/structure', {'parent_id': pref}, method='PATCH')[0] == 403
    finally:
        client.set_my_role('admin')
    assert totals['association_count'] >= 4


def test_最上位の組織は複数登録でき_親と都道府県を持たず_親を選ぶと最上位から外れる(client):
    top1 = client.api('/associations', {'name': '最上位組織一'})[1]['id']
    top2 = client.api('/associations', {'name': '最上位組織二'})[1]['id']
    child = client.api('/associations', {'name': '最上位の下の協会'})[1]['id']
    assert client.api(f'/associations/{child}/structure', {'parent_id': top1, 'prefecture': '東京都'}, method='PATCH')[0] == 200
    # 最上位にすると、親・都道府県は外れる。何件でも登録できる
    r = client.api(f'/associations/{top1}/structure', {'is_top_level': True, 'prefecture': '神奈川県'}, method='PATCH')[1]
    assert (r['is_top_level'], r['parent_id'], r['prefecture']) == (1, None, None)
    assert client.api(f'/associations/{top2}/structure', {'is_top_level': True}, method='PATCH')[1]['is_top_level'] == 1
    by = overview(client)[0]
    assert by['最上位組織一']['is_top_level'] == 1 and by['最上位組織二']['is_top_level'] == 1 and by['最上位の下の協会']['is_top_level'] == 0
    assert by['最上位の下の協会']['parent_id'] == top1
    # 最上位の組織に親は指定できない。親を選ぶと最上位から外れる
    assert client.api(f'/associations/{top2}/structure', {'is_top_level': True, 'parent_id': top1}, method='PATCH')[0] == 400
    r = client.api(f'/associations/{top2}/structure', {'parent_id': top1}, method='PATCH')[1]
    assert (r['is_top_level'], r['parent_id']) == (0, top1)
    # 最上位をやめると、都道府県の協会に戻る
    r = client.api(f'/associations/{top1}/structure', {'is_top_level': False}, method='PATCH')[1]
    assert (r['is_top_level'], r['parent_id']) == (0, None)


def test_協会の位置をまとめて変更でき_1件でも入れられなければ全件変更しない(client):
    bulk = '/association-structure/bulk'
    parent = client.api('/associations', {'name': '一括親協会'})[1]['id']
    kids = [client.api('/associations', {'name': f'一括子協会{i}'})[1]['id'] for i in range(3)]
    sub = client.api('/associations', {'name': '一括子の下の協会'})[1]['id']
    assert client.api(f'/associations/{sub}/structure', {'parent_id': kids[0]}, method='PATCH')[0] == 200
    # まとめて同じ親にする
    status, r = client.api(bulk, {'association_ids': kids, 'parent_id': parent})
    assert (status, r['updated']) == (200, 3)
    by = overview(client)[0]
    assert all(by[f'一括子協会{i}']['parent_id'] == parent for i in range(3)) and by['一括子の下の協会']['parent_id'] == kids[0]
    # 親・都道府県・最上位を、まとめて外す／決める
    assert client.api(bulk, {'association_ids': kids[:2], 'parent_id': None, 'prefecture': '東京都'})[0] == 200
    by = overview(client)[0]
    assert (by['一括子協会0']['parent_id'], by['一括子協会0']['prefecture']) == (None, '東京都') and by['一括子協会2']['parent_id'] == parent
    assert client.api(bulk, {'association_ids': kids[:2], 'is_top_level': True})[0] == 200
    assert overview(client)[0]['一括子協会1']['is_top_level'] == 1
    # 下位の協会を親にする組み合わせは、全件とも変更しない
    assert client.api(bulk, {'association_ids': [kids[2], kids[0]], 'parent_id': sub})[0] == 400
    by = overview(client)[0]
    assert by['一括子協会2']['parent_id'] == parent and by['一括子協会0']['is_top_level'] == 1
    # 入力の誤り・存在しない協会
    assert client.api(bulk, {'association_ids': kids})[0] == 400
    assert client.api(bulk, {'association_ids': []})[0] == 400
    assert client.api(bulk, {'parent_id': parent})[0] == 400
    assert client.api(bulk, {'association_ids': [kids[2], 999999], 'parent_id': None})[0] == 404
    assert overview(client)[0]['一括子協会2']['parent_id'] == parent
    # 管理者のみ
    client.set_my_role('manager')
    try:
        assert client.api(bulk, {'association_ids': kids, 'parent_id': None})[0] == 403
    finally:
        client.set_my_role('admin')
