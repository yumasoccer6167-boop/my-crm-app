"""リスト種類（「繋がりアプローチ」「群私幼」など）。加盟協会と同じ仕組み（telema/tags.py）で動くので、種類ごとの違いと主な流れを確かめる。"""


def make_company(client, name, assigned=None):
    return client.sql(
        'INSERT INTO telema_companies (company_name, company_name_normalized, assigned_user_id) VALUES (%s, %s, %s) RETURNING id',
        (name, name, assigned))[0]['id']


def names(client, cid):
    return [t['name'] for t in client.api(f'/companies/{cid}')[1]['list_types']]


def listed(client, query):
    status, body = client.api(f'/companies?per_page=100&{query}')
    assert status == 200
    return {i['company_name'] for i in body['items']}


def test_初期値は繋がりだけで_管理者が種類を増やせる(client):
    status, rows = client.api('/list-types')
    assert status == 200 and [r['name'] for r in rows] == ['繋がり'] and rows[0]['is_active'] == 1
    status, t = client.api('/list-types', {'name': '群私幼'})
    assert status == 201 and t['name'] == '群私幼' and t['sort_order'] == 20
    assert [r['name'] for r in client.api('/list-types')[1]] == ['繋がり', '群私幼']
    status, body = client.api('/list-types', {'name': '群私幼'})
    assert status == 409 and 'リスト種類「群私幼」は既にあります' in body['error']['message']
    assert client.api('/list-types', {'name': ' '})[0] == 400
    row = client.api(f'/list-types/{t["id"]}', {'name': '群私幼（旧）', 'is_active': False}, method='PATCH')[1]
    assert row['name'] == '群私幼（旧）' and row['is_active'] == 0
    assert client.api('/list-types/999999', {'name': 'x'}, method='PATCH')[0] == 404


def test_施設にリスト種類を複数付けられ_加盟協会とは別々に持つ(client):
    cid = make_company(client, '種類テスト園')
    gun = client.api('/list-types', {'name': '群私幼B'})[1]['id']
    tsunagari = client.api('/list-types')[1][0]['id']
    assoc = client.api('/associations', {'name': '種類テスト協会'})[1]['id']
    assert client.api(f'/companies/{cid}')[1]['list_types'] == []

    status, rows = client.api(f'/companies/{cid}/list-types', {'list_type_ids': [gun, tsunagari]}, method='PATCH')
    assert status == 200 and [r['name'] for r in rows] == ['繋がり', '群私幼B']
    client.api(f'/companies/{cid}/associations', {'association_ids': [assoc]}, method='PATCH')

    detail = client.api(f'/companies/{cid}')[1]
    assert [t['name'] for t in detail['list_types']] == ['繋がり', '群私幼B']
    assert [a['name'] for a in detail['associations']] == ['種類テスト協会']          # 互いに影響しない
    assert client.api(f'/companies/{cid}/list-types', {'list_type_ids': []}, method='PATCH')[0] == 200
    detail = client.api(f'/companies/{cid}')[1]
    assert detail['list_types'] == [] and len(detail['associations']) == 1
    # メッセージは「リスト種類」の名前で出る
    status, body = client.api(f'/companies/{cid}/list-types', {'list_type_ids': [999999]}, method='PATCH')
    assert status == 400 and 'リスト種類が見つかりません' in body['error']['message']
    log = client.sql("SELECT action FROM telema_audit_logs WHERE entity_type = 'company_list_types' AND entity_id = %s", (cid,))
    assert len(log) == 2


def test_一覧にリスト種類が出て_絞り込める(client):
    gun = client.api('/list-types', {'name': '群私幼C'})[1]['id']
    tsunagari = client.api('/list-types')[1][0]['id']
    both, only_t, none = (make_company(client, f'一覧種類_{n}') for n in ('両方', '繋がりのみ', '未設定'))
    client.api(f'/companies/{both}/list-types', {'list_type_ids': [gun, tsunagari]}, method='PATCH')
    client.api(f'/companies/{only_t}/list-types', {'list_type_ids': [tsunagari]}, method='PATCH')

    items = {i['company_name']: i for i in client.api('/companies?per_page=100')[1]['items']}
    assert items['一覧種類_両方']['list_types'] == ['繋がり', '群私幼C']
    assert items['一覧種類_未設定']['list_types'] == [] and items['一覧種類_未設定']['associations'] == []

    assert {'一覧種類_両方', '一覧種類_繋がりのみ'} <= listed(client, f'list_type={tsunagari}') and '一覧種類_未設定' not in listed(client, f'list_type={tsunagari}')
    only_gun = listed(client, f'list_type={gun}')
    assert '一覧種類_両方' in only_gun and '一覧種類_繋がりのみ' not in only_gun
    unset = listed(client, 'list_type=none')
    assert '一覧種類_未設定' in unset and '一覧種類_両方' not in unset
    # 加盟協会の絞り込みと同時に使える
    assert listed(client, f'list_type={tsunagari}&association=none&q=' + '繋がりのみ') == {'一覧種類_繋がりのみ'}
    for bad in ('abc', '0', '-1'):
        assert client.api(f'/companies?list_type={bad}')[0] == 400, bad


def test_一括割り振りで追加_外す_これだけにする_全部外す(client):
    a = client.api('/list-types', {'name': '一括種類A'})[1]['id']
    b = client.api('/list-types', {'name': '一括種類B'})[1]['id']
    c1, c2, c3 = (make_company(client, f'一括種類_{n}') for n in ('1', '2', '3'))
    client.api(f'/companies/{c1}/list-types', {'list_type_ids': [a]}, method='PATCH')
    client.api(f'/companies/{c2}/list-types', {'list_type_ids': [a, b]}, method='PATCH')
    url, ids = '/companies/bulk-list-types', [c1, c2, c3]

    r = client.api(url, {'company_ids': ids, 'list_type_id': b, 'mode': 'add'})[1]
    assert r == {'updated': 2, 'unchanged': 1, 'not_found': 0}
    assert [names(client, c) for c in ids] == [['一括種類A', '一括種類B'], ['一括種類A', '一括種類B'], ['一括種類B']]
    r = client.api(url, {'company_ids': ids, 'list_type_id': a, 'mode': 'remove'})[1]
    assert r == {'updated': 2, 'unchanged': 1, 'not_found': 0}
    assert [names(client, c) for c in ids] == [['一括種類B']] * 3
    r = client.api(url, {'company_ids': ids, 'list_type_id': a, 'mode': 'replace'})[1]
    assert r['updated'] == 3 and [names(client, c) for c in ids] == [['一括種類A']] * 3
    r = client.api(url, {'company_ids': ids, 'list_type_id': None, 'mode': 'replace'})[1]
    assert r['updated'] == 3 and [names(client, c) for c in ids] == [[], [], []]

    # 入力エラー・無効な種類・存在しない施設
    off = client.api('/list-types', {'name': '一括無効種類'})[1]['id']
    client.api(f'/list-types/{off}', {'is_active': False}, method='PATCH')
    assert client.api(url, {'company_ids': ids, 'list_type_id': None, 'mode': 'add'})[0] == 400
    assert client.api(url, {'company_ids': ids, 'list_type_id': 999999, 'mode': 'add'})[0] == 404
    status, body = client.api(url, {'company_ids': ids, 'list_type_id': off, 'mode': 'add'})
    assert status == 400 and '無効なリスト種類は割り当てられません' in body['error']['message']
    r = client.api(url, {'company_ids': [c1, 999999], 'list_type_id': a, 'mode': 'add'})[1]
    assert r == {'updated': 1, 'unchanged': 0, 'not_found': 1}


def test_リスト種類の変更は管理者のみ_一括はmanagerとadminだけ(client):
    me = client.api('/me')[1]['id']
    other = client.add_user('種類の別営業')
    t = client.api('/list-types', {'name': '権限種類'})[1]['id']
    mine = make_company(client, '種類自分の担当園', assigned=me)
    theirs = make_company(client, '種類他人の担当園', assigned=other)
    client.set_my_role('sales')
    try:
        assert client.api('/list-types', {'name': '営業が作る種類'})[0] == 403
        assert client.api(f'/list-types/{t}', {'name': '営業が改名'}, method='PATCH')[0] == 403
        assert client.api('/list-types')[0] == 200
        assert client.api(f'/companies/{mine}/list-types', {'list_type_ids': [t]}, method='PATCH')[0] == 200
        assert client.api(f'/companies/{theirs}/list-types', {'list_type_ids': [t]}, method='PATCH')[0] == 404
        assert client.api('/companies/bulk-list-types', {'company_ids': [mine], 'list_type_id': t, 'mode': 'add'})[0] == 403
    finally:
        client.set_my_role('admin')
    client.set_my_role('manager')
    try:
        assert client.api('/companies/bulk-list-types', {'company_ids': [theirs], 'list_type_id': t, 'mode': 'add'})[0] == 200
        assert client.api('/list-types', {'name': 'マネージャーが作る種類'})[0] == 403
    finally:
        client.set_my_role('admin')
    assert names(client, mine) == ['権限種類'] and names(client, theirs) == ['権限種類']


def test_ダッシュボードの今日の架電予定にもリスト種類が付く(client):
    """ダッシュボードは施設一覧と同じ表を使うので、list_types も配列で返す（返さないと表が落ちる）"""
    t = client.api('/list-types', {'name': 'ダッシュボード種類'})[1]['id']
    cid = make_company(client, 'ダッシュボード種類_要架電園')
    client.sql("UPDATE telema_companies SET next_call_at = '2020-01-01T00:00:00.000Z' WHERE id = %s", (cid,))
    client.api(f'/companies/{cid}/list-types', {'list_type_ids': [t]}, method='PATCH')
    today = {i['company_name']: i for i in client.api('/dashboard')[1]['today']}
    assert today['ダッシュボード種類_要架電園']['list_types'] == ['ダッシュボード種類']
    assert all(isinstance(i['list_types'], list) and isinstance(i['associations'], list) for i in today.values())
