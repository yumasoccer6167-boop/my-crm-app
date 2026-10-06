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


# ---------- 一覧への表示・絞り込み・一括割り振り ----------
def listed(client, query):
    status, body = client.api(f'/companies?per_page=100&{query}')
    assert status == 200
    return {i['company_name'] for i in body['items']}


def test_一覧に加盟協会が出て_協会と未設定で絞り込める(client):
    a = client.api('/associations', {'name': '一覧協会A'})[1]['id']
    b = client.api('/associations', {'name': '一覧協会B'})[1]['id']
    both = make_company(client, '一覧_両方に加盟')
    only_b = make_company(client, '一覧_Bのみ')
    none = make_company(client, '一覧_未加盟')
    client.api(f'/companies/{both}/associations', {'association_ids': [b, a]}, method='PATCH')
    client.api(f'/companies/{only_b}/associations', {'association_ids': [b]}, method='PATCH')

    items = {i['company_name']: i for i in client.api('/companies?per_page=100')[1]['items']}
    assert items['一覧_両方に加盟']['associations'] == ['一覧協会A', '一覧協会B']   # マスタの並び順
    assert items['一覧_未加盟']['associations'] == []

    assert {'一覧_両方に加盟'} <= listed(client, f'association={a}') and '一覧_Bのみ' not in listed(client, f'association={a}')
    assert {'一覧_両方に加盟', '一覧_Bのみ'} <= listed(client, f'association={b}') and '一覧_未加盟' not in listed(client, f'association={b}')
    unset = listed(client, 'association=none')
    assert '一覧_未加盟' in unset and '一覧_両方に加盟' not in unset and '一覧_Bのみ' not in unset
    # ほかの条件と組み合わせられる
    assert listed(client, f'association={b}&q=' + 'Bのみ') == {'一覧_Bのみ'}
    for bad in ('abc', '0', '-1'):
        assert client.api(f'/companies?association={bad}')[0] == 400, bad


def test_一括割り振りで追加_外す_置き換え_全部外すができる(client):
    a = client.api('/associations', {'name': '一括協会A'})[1]['id']
    b = client.api('/associations', {'name': '一括協会B'})[1]['id']
    c1, c2, c3 = (make_company(client, f'一括_{n}') for n in ('1', '2', '3'))
    client.api(f'/companies/{c1}/associations', {'association_ids': [a]}, method='PATCH')
    client.api(f'/companies/{c2}/associations', {'association_ids': [a, b]}, method='PATCH')
    url = '/companies/bulk-associations'
    ids = [c1, c2, c3]

    # 追加：すでに付いている施設は変更なし。既存の協会は残る
    status, r = client.api(url, {'company_ids': ids, 'association_id': b, 'mode': 'add'})
    assert status == 200 and r == {'updated': 2, 'unchanged': 1, 'not_found': 0}
    assert [names(client, c) for c in ids] == [['一括協会A', '一括協会B'], ['一括協会A', '一括協会B'], ['一括協会B']]

    # 外す：その協会だけ外れる。付いていない施設は変更なし
    r = client.api(url, {'company_ids': ids, 'association_id': a, 'mode': 'remove'})[1]
    assert r == {'updated': 2, 'unchanged': 1, 'not_found': 0}
    assert [names(client, c) for c in ids] == [['一括協会B'], ['一括協会B'], ['一括協会B']]

    # 置き換え：その協会だけにする
    client.api(f'/companies/{c1}/associations', {'association_ids': [a, b]}, method='PATCH')
    r = client.api(url, {'company_ids': ids, 'association_id': a, 'mode': 'replace'})[1]
    assert r == {'updated': 3, 'unchanged': 0, 'not_found': 0}
    assert [names(client, c) for c in ids] == [['一括協会A']] * 3

    # 全部外す（association_id = null の置き換え）
    r = client.api(url, {'company_ids': ids, 'association_id': None, 'mode': 'replace'})[1]
    assert r == {'updated': 3, 'unchanged': 0, 'not_found': 0}
    assert [names(client, c) for c in ids] == [[], [], []]
    assert client.api(url, {'company_ids': ids, 'association_id': None, 'mode': 'replace'})[1]['updated'] == 0

    # 操作ログ：変更があった施設ごとに、前後の協会が残る
    log = client.sql("SELECT before_json, after_json FROM telema_audit_logs WHERE entity_type = 'company_associations' AND entity_id = %s ORDER BY id DESC LIMIT 1", (c1,))[0]
    assert str(a) in log['before_json'] and '[]' in log['after_json']


def test_一括割り振りの入力エラーと対象外の施設(client):
    a = client.api('/associations', {'name': '一括エラー協会'})[1]['id']
    off = client.api('/associations', {'name': '一括無効協会'})[1]['id']
    live, deleted = make_company(client, '一括エラー_有効'), make_company(client, '一括エラー_削除済み')
    client.sql('UPDATE telema_companies SET is_active = 0 WHERE id = %s', (deleted,))
    client.api(f'/companies/{live}/associations', {'association_ids': [off]}, method='PATCH')
    client.api(f'/associations/{off}', {'is_active': False}, method='PATCH')
    url = '/companies/bulk-associations'

    # 削除済み・存在しない施設は not_found に数える
    r = client.api(url, {'company_ids': [live, deleted, 999999], 'association_id': a, 'mode': 'add'})[1]
    assert r == {'updated': 1, 'unchanged': 0, 'not_found': 2}
    assert client.api(url, {'company_ids': [], 'association_id': a, 'mode': 'add'})[0] == 400
    assert client.api(url, {'company_ids': [live], 'association_id': a, 'mode': 'zzz'})[0] == 400
    assert client.api(url, {'company_ids': [live], 'mode': 'add'})[0] == 400
    for mode in ('add', 'remove'):
        status, body = client.api(url, {'company_ids': [live], 'association_id': None, 'mode': mode})
        assert status == 400 and '加盟協会を指定してください' in body['error']['message'], mode
    assert client.api(url, {'company_ids': [live], 'association_id': 999999, 'mode': 'add'})[0] == 404

    # 無効な協会は割り当てられない（追加・置き換え）が、外すことはできる
    for mode in ('add', 'replace'):
        status, body = client.api(url, {'company_ids': [live], 'association_id': off, 'mode': mode})
        assert status == 400 and '無効な加盟協会' in body['error']['message'], mode
    assert client.api(url, {'company_ids': [live], 'association_id': off, 'mode': 'remove'})[1]['updated'] == 1
    assert 'は割り当てられません' not in str(names(client, live))
    assert names(client, live) == ['一括エラー協会']


def test_一括割り振りはmanagerとadminだけ(client):
    a = client.api('/associations', {'name': '一括権限協会'})[1]['id']
    cid = make_company(client, '一括権限園')
    body = {'company_ids': [cid], 'association_id': a, 'mode': 'add'}
    client.set_my_role('sales')
    try:
        assert client.api('/companies/bulk-associations', body)[0] == 403
    finally:
        client.set_my_role('admin')
    assert names(client, cid) == []
    client.set_my_role('manager')
    try:
        assert client.api('/companies/bulk-associations', body)[0] == 200
    finally:
        client.set_my_role('admin')
    assert names(client, cid) == ['一括権限協会']


def test_ダッシュボードの今日の架電予定にも加盟協会が付く(client):
    """ダッシュボードは施設一覧と同じ表を使うので、同じ形（associations の配列）で返す"""
    a = client.api('/associations', {'name': 'ダッシュボード協会'})[1]['id']
    cid = make_company(client, 'ダッシュボード_要架電園')
    client.sql("UPDATE telema_companies SET next_call_at = '2020-01-01T00:00:00.000Z' WHERE id = %s", (cid,))
    client.api(f'/companies/{cid}/associations', {'association_ids': [a]}, method='PATCH')
    today = {i['company_name']: i for i in client.api('/dashboard')[1]['today']}
    assert today['ダッシュボード_要架電園']['associations'] == ['ダッシュボード協会']
    assert all(isinstance(i['associations'], list) for i in today.values())
