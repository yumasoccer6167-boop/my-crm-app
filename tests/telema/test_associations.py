"""加盟協会：マスタ（設定画面）と、施設ごとの加盟協会（複数）。"""


def make_company(client, name, assigned=None):
    return client.sql(
        'INSERT INTO telema_companies (company_name, company_name_normalized, assigned_user_id) VALUES (%s, %s, %s) RETURNING id',
        (name, name, assigned))[0]['id']


def names(client, cid):
    return [a['name'] for a in client.api(f'/companies/{cid}')[1]['associations']]


def test_管理者は加盟協会を追加でき_重複は409_空は400(client):
    assert client.api('/associations')[1] == []
    status, a = client.api('/associations', {'name': '全国私立保育連盟'})
    assert status == 201 and a['name'] == '全国私立保育連盟' and a['is_active'] == 1 and a['sort_order'] == 10
    b = client.api('/associations', {'name': '日本保育協会'})[1]
    assert b['sort_order'] == 20
    status, body = client.api('/associations', {'name': '日本保育協会'})
    assert status == 409 and '既にあります' in body['error']['message']
    assert client.api('/associations', {'name': '  '})[0] == 400
    assert client.api('/associations', {'name': 'あ' * 101})[0] == 400
    assert [x['name'] for x in client.api('/associations')[1]] == ['全国私立保育連盟', '日本保育協会']
    log = client.sql("SELECT action FROM telema_audit_logs WHERE entity_type = 'association' AND entity_id = %s", (a['id'],))
    assert log == [{'action': 'create'}]


def test_名称変更と無効化ができ_他の協会と同じ名前には変えられない(client):
    a = client.api('/associations', {'name': '改名前協会'})[1]
    other = client.api('/associations', {'name': '別の協会'})[1]
    status, row = client.api(f'/associations/{a["id"]}', {'name': '改名後協会'}, method='PATCH')
    assert status == 200 and row['name'] == '改名後協会'
    assert client.api(f'/associations/{a["id"]}', {'name': '別の協会'}, method='PATCH')[0] == 409
    # 同じ名前のまま保存しても衝突扱いにならない
    assert client.api(f'/associations/{a["id"]}', {'name': '改名後協会'}, method='PATCH')[0] == 200
    assert client.api(f'/associations/{other["id"]}', {'is_active': False}, method='PATCH')[1]['is_active'] == 0
    assert client.api('/associations/999999', {'name': 'x'}, method='PATCH')[0] == 404


def test_施設に加盟協会を複数付けて置き換えられる(client):
    cid = make_company(client, '協会テスト園')
    a, b, c = (client.api('/associations', {'name': n})[1]['id'] for n in ('協会A', '協会B', '協会C'))
    assert client.api(f'/companies/{cid}')[1]['associations'] == []

    status, rows = client.api(f'/companies/{cid}/associations', {'association_ids': [c, a, a]}, method='PATCH')
    assert status == 200
    assert [r['name'] for r in rows] == ['協会A', '協会C']          # 重複は1つにまとめ、マスタの並び順で返る
    assert names(client, cid) == ['協会A', '協会C']

    client.api(f'/companies/{cid}/associations', {'association_ids': [b]}, method='PATCH')
    assert names(client, cid) == ['協会B']                            # 送った一覧に置き換わる
    client.api(f'/companies/{cid}/associations', {'association_ids': []}, method='PATCH')
    assert names(client, cid) == []
    log = client.sql("SELECT action FROM telema_audit_logs WHERE entity_type = 'company_associations' AND entity_id = %s", (cid,))
    assert len(log) == 3


def test_無効な協会は新規に付けられないが_すでに付いているものは残せる(client):
    cid = make_company(client, '無効協会テスト園')
    keep = client.api('/associations', {'name': '付けたまま無効にする協会'})[1]['id']
    fresh = client.api('/associations', {'name': '後から無効にする協会'})[1]['id']
    client.api(f'/companies/{cid}/associations', {'association_ids': [keep]}, method='PATCH')
    client.api(f'/associations/{keep}', {'is_active': False}, method='PATCH')
    client.api(f'/associations/{fresh}', {'is_active': False}, method='PATCH')

    # 無効にしても、付いている間は施設に表示される
    assert client.api(f'/companies/{cid}')[1]['associations'] == [{'id': keep, 'name': '付けたまま無効にする協会', 'is_active': 0}]
    status, body = client.api(f'/companies/{cid}/associations', {'association_ids': [keep, fresh]}, method='PATCH')
    assert status == 400 and '無効な加盟協会は追加できません' in body['error']['message']
    assert names(client, cid) == ['付けたまま無効にする協会']       # 失敗したら変更されない
    assert client.api(f'/companies/{cid}/associations', {'association_ids': [keep]}, method='PATCH')[0] == 200


def test_加盟協会の入力エラー(client):
    cid = make_company(client, '協会入力エラー園')
    a = client.api('/associations', {'name': '入力エラー用協会'})[1]['id']
    url = f'/companies/{cid}/associations'
    assert client.api(url, {}, method='PATCH')[0] == 400
    assert client.api(url, {'association_ids': 'x'}, method='PATCH')[0] == 400
    assert client.api(url, {'association_ids': [0]}, method='PATCH')[0] == 400
    status, body = client.api(url, {'association_ids': [a, 999999]}, method='PATCH')
    assert status == 400 and '加盟協会が見つかりません' in body['error']['message']
    assert client.api('/companies/999999/associations', {'association_ids': [a]}, method='PATCH')[0] == 404
    assert names(client, cid) == []


def test_協会マスタの変更は管理者のみ_salesは自分の担当会社だけ付け外しできる(client):
    me = client.api('/me')[1]['id']
    other = client.add_user('協会の別営業')
    a = client.api('/associations', {'name': '権限テスト協会'})[1]['id']
    mine = make_company(client, '協会自分の担当園', assigned=me)
    theirs = make_company(client, '協会他人の担当園', assigned=other)
    client.set_my_role('sales')
    try:
        assert client.api('/associations', {'name': '営業が作る協会'})[0] == 403
        assert client.api(f'/associations/{a}', {'name': '営業が改名'}, method='PATCH')[0] == 403
        assert client.api('/associations')[0] == 200                                   # 一覧は誰でも見られる
        assert client.api(f'/companies/{mine}/associations', {'association_ids': [a]}, method='PATCH')[0] == 200
        assert client.api(f'/companies/{theirs}/associations', {'association_ids': [a]}, method='PATCH')[0] == 404
    finally:
        client.set_my_role('admin')
    assert names(client, mine) == ['権限テスト協会']
    assert names(client, theirs) == []
