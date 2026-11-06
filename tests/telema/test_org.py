"""組織図：部署のツリー・所属（異動）・旧ユーザーの部署への反映"""


def add_user(client, name):
    return client.sql("INSERT INTO users (username, password_hash, display_name, role) VALUES (%s, 'x', %s, 'general') RETURNING id", (name, name))[0]['id']


def test_部署のツリーを作り_メンバーを配属し_異動できる(client):
    api = client.api
    status, biz = api('/org/departments', {'name': '事業部'})
    assert status == 201 and biz['parent_id'] is None
    sales = api('/org/departments', {'name': '営業部', 'parent_id': biz['id']})[1]
    k1 = api('/org/departments', {'name': '一課', 'parent_id': sales['id']})[1]
    k2 = api('/org/departments', {'name': '二課', 'parent_id': sales['id']})[1]
    assert k2['sort_order'] > k1['sort_order']
    # 同じ階層の同じ名前、自分の配下への付け替え、存在しない親
    assert api('/org/departments', {'name': '一課', 'parent_id': sales['id']})[0] == 409
    assert api(f'/org/departments/{biz["id"]}', {'parent_id': k1['id']}, method='PATCH')[0] == 400
    assert api('/org/departments', {'name': 'x', 'parent_id': 999999})[0] == 404
    assert api('/org/departments', {'name': ''})[0] == 400

    u = add_user(client, '組織テスト太郎')
    assert api('/org/assignments', {'user_id': u, 'department_id': k1['id'], 'effective_date': '2026-01-01'})[0] == 201
    org = api('/org?date=2026-06-01')[1]
    me = next(m for m in org['members'] if m['user_id'] == u)
    assert me['department_id'] == k1['id'] and me['since'] == '2026-01-01'
    assert {x['name'] for x in org['departments']} >= {'事業部', '営業部', '一課', '二課'}
    assert client.sql('SELECT department FROM users WHERE id = %s', (u,))[0]['department'] == '一課'
    # 異動：日付で所属が変わる（過去の日付は元のまま）。旧ユーザーの部署は今の所属に変わる
    assert api('/org/assignments', {'user_id': u, 'department_id': k2['id'], 'effective_date': '2026-04-01', 'note': '二課へ異動'})[0] == 201
    on = lambda day: next(m for m in api(f'/org?date={day}')[1]['members'] if m['user_id'] == u)['department_id']
    assert on('2026-03-31') == k1['id'] and on('2026-04-01') == k2['id']
    assert client.sql('SELECT department FROM users WHERE id = %s', (u,))[0]['department'] == '二課'
    hist = api(f'/org/history?user_id={u}')[1]['items']
    assert [h['department_name'] for h in hist] == ['二課', '一課'] and hist[0]['note'] == '二課へ異動'
    # 名前を変えると旧ユーザーの部署も変わる。所属なしにもできる
    assert api(f'/org/departments/{k2["id"]}', {'name': '第二課'}, method='PATCH')[0] == 200
    assert client.sql('SELECT department FROM users WHERE id = %s', (u,))[0]['department'] == '第二課'
    # 今のメンバーがいる部署・下に部署がある部署は消せない
    assert api(f'/org/departments/{k2["id"]}', method='DELETE')[0] == 409
    assert api(f'/org/departments/{sales["id"]}', method='DELETE')[0] == 409
    assert api('/org/assignments', {'user_id': u, 'department_id': None, 'effective_date': '2026-05-01'})[0] == 201
    assert client.sql('SELECT department FROM users WHERE id = %s', (u,))[0]['department'] is None
    assert api(f'/org/departments/{k2["id"]}', method='DELETE')[0] == 200
    assert k2['id'] not in {x['id'] for x in api('/org')[1]['departments']}
    assert api('/org/assignments', {'user_id': u, 'department_id': k2['id']})[0] == 404          # 無効な部署には配属できない
    assert api('/org/assignments', {'user_id': 999999, 'department_id': None})[0] == 400


def test_組織図の変更は管理者だけ(client):
    client.sql("UPDATE users SET role = 'general' WHERE username = 'owner'")
    try:
        assert client.api('/org/departments', {'name': '権限テスト'})[0] == 403
        assert client.api('/org')[0] == 200
    finally:
        client.sql("UPDATE users SET role = 'owner' WHERE username = 'owner'")
