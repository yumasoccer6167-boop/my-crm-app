"""部署（営業部・制作部・CS など）。タイムラインの記録（架電履歴）ごとに1つ付け、ユーザーの施設で部署別に表示を切り替える。"""


def make_company(client, name, is_user=0):
    return client.sql(
        'INSERT INTO telema_companies (company_name, company_name_normalized, is_user) VALUES (%s, %s, %s) RETURNING id',
        (name, name, is_user))[0]['id']


def calls(client, cid):
    status, rows = client.api(f'/companies/{cid}/calls')
    assert status == 200
    return rows


def section_id(client, name):
    return next(s['id'] for s in client.api('/sections')[1] if s['name'] == name)


def test_初期値は営業部_制作部_CSで_管理者が増やせる(client):
    status, rows = client.api('/sections')
    assert status == 200 and [r['name'] for r in rows] == ['営業部', '制作部', 'CS']
    assert all(r['is_active'] == 1 for r in rows)
    status, s = client.api('/sections', {'name': 'カスタマーサクセス'})
    assert status == 201 and s['sort_order'] == 40
    status, body = client.api('/sections', {'name': 'CS'})
    assert status == 409 and '部署「CS」は既にあります' in body['error']['message']
    assert client.api('/sections', {'name': ' '})[0] == 400
    row = client.api(f'/sections/{s["id"]}', {'name': 'サクセス', 'is_active': False}, method='PATCH')[1]
    assert row['name'] == 'サクセス' and row['is_active'] == 0
    assert client.api('/sections/999999', {'name': 'x'}, method='PATCH')[0] == 404


def test_部署の変更は管理者のみ(client):
    sec = section_id(client, '営業部')
    for role in ('sales', 'manager'):
        client.set_my_role(role)
        try:
            assert client.api('/sections', {'name': f'{role}が作る部署'})[0] == 403
            assert client.api(f'/sections/{sec}', {'name': f'{role}が改名'}, method='PATCH')[0] == 403
            assert client.api('/sections')[0] == 200            # 一覧は誰でも見られる
        finally:
            client.set_my_role('admin')
    assert section_id(client, '営業部') == sec


def test_記録に部署を付けて登録でき_一覧に部署名が返る(client):
    cid = make_company(client, '部署テスト園', is_user=1)
    sales, prod = section_id(client, '営業部'), section_id(client, '制作部')
    a = client.api(f'/companies/{cid}/calls', {'raw_note': '営業の記録', 'section_id': sales, 'called_at': '2026-10-01T01:00:00Z'})
    b = client.api(f'/companies/{cid}/calls', {'raw_note': '制作の記録', 'section_id': prod, 'called_at': '2026-10-02T01:00:00Z'})
    c = client.api(f'/companies/{cid}/calls', {'raw_note': '部署なしの記録', 'called_at': '2026-10-03T01:00:00Z'})
    assert (a[0], b[0], c[0]) == (201, 201, 201)
    assert {'section_id': sales, 'section_name': '営業部'}.items() <= a[1].items()
    assert c[1]['section_id'] is None and c[1]['section_name'] is None          # 省略は未分類
    rows = {r['raw_note']: r for r in calls(client, cid)}
    assert rows['営業の記録']['section_name'] == '営業部' and rows['制作の記録']['section_name'] == '制作部'
    assert rows['部署なしの記録']['section_name'] is None


def test_記録を作るときの部署の入力エラー(client):
    cid = make_company(client, '部署エラー園')
    url = f'/companies/{cid}/calls'
    assert client.api(url, {'raw_note': 'x', 'section_id': 999999})[0] == 400
    assert client.api(url, {'raw_note': 'x', 'section_id': 'abc'})[0] == 400
    off = client.api('/sections', {'name': '作ってすぐ無効にする部署'})[1]['id']
    client.api(f'/sections/{off}', {'is_active': False}, method='PATCH')
    status, body = client.api(url, {'raw_note': 'x', 'section_id': off})
    assert status == 400 and '無効な部署は選べません' in body['error']['message']
    assert calls(client, cid) == []                       # 失敗した記録は残らない
    assert client.api(url, {'raw_note': 'x', 'section_id': None})[0] == 201


def test_過去の記録の部署を直せる_無効にした部署は付いている間は残せる(client):
    cid = make_company(client, '部署編集園', is_user=1)
    cs, prod = section_id(client, 'CS'), section_id(client, '制作部')
    call = client.api(f'/companies/{cid}/calls', {'raw_note': 'もとは部署なし'})[1]['id']

    status, row = client.api(f'/calls/{call}', {'section_id': cs}, method='PATCH')
    assert status == 200 and {'section_id': cs, 'section_name': 'CS'}.items() <= row.items()
    assert client.api(f'/calls/{call}', {'section_id': None}, method='PATCH')[1]['section_name'] is None
    assert client.api(f'/calls/{call}', {'section_id': 999999}, method='PATCH')[0] == 400

    # CS を無効にしても、すでに CS が付いている記録は、そのままメモなどを直せる（部署を変えない保存も通る）
    client.api(f'/calls/{call}', {'section_id': cs}, method='PATCH')
    client.api(f'/sections/{cs}', {'is_active': False}, method='PATCH')
    status, row = client.api(f'/calls/{call}', {'section_id': cs, 'raw_note': '無効な部署のままメモを修正'}, method='PATCH')
    assert status == 200 and row['section_name'] == 'CS'
    # 無効な部署を、別の記録に新しく付けることはできない。有効な部署への付け替えはできる
    other = client.api(f'/companies/{cid}/calls', {'raw_note': '別の記録'})[1]['id']
    assert client.api(f'/calls/{other}', {'section_id': cs}, method='PATCH')[0] == 400
    assert client.api(f'/calls/{call}', {'section_id': prod}, method='PATCH')[1]['section_name'] == '制作部'
    log = client.sql("SELECT after_json FROM telema_audit_logs WHERE entity_type = 'call_log' AND entity_id = %s ORDER BY id DESC LIMIT 1", (call,))
    assert str(prod) in log[0]['after_json']


def test_salesは自分の記録の部署だけ直せる(client):
    cid = make_company(client, '部署権限園')
    sec = section_id(client, '営業部')
    mine = client.api(f'/companies/{cid}/calls', {'raw_note': '自分の記録'})[1]['id']
    other_user = client.add_user('部署の別営業')
    theirs = client.sql(
        "INSERT INTO telema_call_logs (company_id, user_id, called_at, raw_note) VALUES (%s, %s, '2026-09-01T00:00:00.000Z', '他人の記録') RETURNING id",
        (cid, other_user))[0]['id']
    client.set_my_role('sales')
    try:
        assert client.api(f'/calls/{mine}', {'section_id': sec}, method='PATCH')[0] == 200
        assert client.api(f'/calls/{theirs}', {'section_id': sec}, method='PATCH')[0] == 403
    finally:
        client.set_my_role('admin')
    assert client.api(f'/calls/{theirs}', {'section_id': sec}, method='PATCH')[0] == 200


def test_既存の記録は未分類のまま(client):
    """部署を入れる前に作られた記録（section_id の列が無かった頃の記録）は、未分類として扱う"""
    cid = make_company(client, '既存記録園', is_user=1)
    client.sql("INSERT INTO telema_call_logs (company_id, called_at, raw_note) VALUES (%s, '2026-01-01T00:00:00.000Z', '昔の記録')", (cid,))
    row = calls(client, cid)[0]
    assert row['raw_note'] == '昔の記録' and row['section_id'] is None and row['section_name'] is None
