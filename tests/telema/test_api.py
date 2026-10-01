from urllib.parse import quote


def test_未ログインは401(client):
    r = client.http.get('/api/telema/me')
    assert r.status_code == 401
    assert r.get_json()['error']['code'] == 'unauthenticated'
    r = client.http.get('/api/telema/me', headers={'Authorization': 'Bearer invalid'})
    assert r.status_code == 401


def test_CRMのユーザーとロールで動く(client):
    status, me = client.api('/me')
    assert status == 200
    assert me['role'] == 'admin' and me['name'] == 'オーナー'
    status, users = client.api('/users')
    assert status == 200
    assert {'name': 'オーナー', 'role': 'admin'}.items() <= users[0].items()


def test_会社を登録すると正規化列と情報源が入る(client):
    status, body = client.api('/companies', {
        'company_name': '古河保育園',
        'organization_name': '社会福祉法人せんだんの木会',
        'phone': '０２８０－２２－１７１７',
        'postal_code': '3060033.0',
        'address': '茨城県古河市中央町３‐１０‐６２',
        'website': 'https://www.example-hoiku.jp/about',
    })
    assert status == 201
    assert {
        'phone': '0280-22-1717',
        'phone_normalized': '0280221717',
        'postal_code': '3060033',
        'prefecture': '茨城県',
        'city': '古河市',
        'website_domain': 'example-hoiku.jp',
        'company_name_normalized': '古河保育園',
    }.items() <= body.items()
    assert 'search_text' not in body
    fs = client.sql('SELECT field, source FROM telema_company_field_sources WHERE company_id = %s', (body['id'],))
    assert {'field': 'phone', 'source': 'manual'} in fs


def total(client, q):
    return client.api(f'/companies?q={quote(q)}')[1]['total']


def test_会社名_電話番号_担当者名で検索できる(client):
    cid = client.api('/companies?q=' + quote('古河'))[1]['items'][0]['id']
    client.api(f'/companies/{cid}/contacts', {'name': '山田 太郎', 'role': '園長', 'is_decision_maker': True})
    assert total(client, '古河') == 1
    assert total(client, '0280-22') == 1
    assert total(client, '山田') == 1
    assert total(client, '存在しない') == 0
    # LIKE のワイルドカードは文字として扱う
    assert total(client, '%') == 0
    assert total(client, '_') == 0
    assert total(client, '古河保育') == 1
    assert total(client, 'せんだんの木') == 1
    assert total(client, '山田 太郎') == 1
    assert total(client, '0280221717') == 1
    assert total(client, '"古河') == 0
    skipped = client.api('/companies?q=' + quote('古河') + '&skip_count=1')[1]
    assert skipped['total'] is None
    assert len(skipped['items']) == 1


def test_架電を登録すると原文が残り会社の現在状態が更新される(client):
    cid = client.api('/companies?q=' + quote('古河'))[1]['items'][0]['id']
    recall = client.status_id('再コール')
    status, body = client.api(f'/companies/{cid}/calls', {
        'raw_note': '担当者不在。受付の方から15時以降ならつながりやすいと言われた。',
        'result_status_id': recall,
        'next_call_at': '2026-10-01T06:00:00Z',
    })
    assert status == 201
    assert '15時以降' in body['raw_note']
    assert body['ai_status'] == 'pending' and body['result_label'] == '再コール' and body['user_name'] == 'オーナー'

    detail = client.api(f'/companies/{cid}')[1]
    assert {'status_id': recall, 'call_count': 1, 'next_call_at': '2026-10-01T06:00:00.000Z'}.items() <= detail['company'].items()
    assert detail['contacts'][0]['name'] == '山田 太郎'
    assert detail['organization']['name'] == '社会福祉法人せんだんの木会'

    lst = client.api(f'/companies?status_id={recall}')[1]
    assert {'id': cid, 'status_label': '再コール', 'contact_name': '山田 太郎'}.items() <= lst['items'][0].items()


def test_架電履歴は無効化でき件数が再計算される(client):
    cid = client.api('/companies?q=' + quote('古河'))[1]['items'][0]['id']
    second = client.api(f'/companies/{cid}/calls', {'raw_note': '誤登録'})[1]
    assert client.api(f'/companies/{cid}')[1]['company']['call_count'] == 2
    assert client.api(f'/calls/{second["id"]}/deactivate', method='POST')[0] == 200
    assert client.api(f'/companies/{cid}')[1]['company']['call_count'] == 1
    assert len(client.api(f'/companies/{cid}/calls')[1]) == 1
    assert client.sql('SELECT is_active FROM telema_call_logs WHERE id = %s', (second['id'],)) == [{'is_active': 0}]


def test_ダッシュボードに今日の架電予定と件数が出る(client):
    d = client.api('/dashboard')[1]
    assert d['counts']['total'] == 1
    assert d['counts']['in_progress'] == 1
    assert d['calls_today']['calls_today'] == 1
    assert d['today'][0]['company_name'] == '古河保育園'


def test_絞り込み候補(client):
    f = client.api('/companies/facets')[1]
    assert {'value': '古河市', 'n': 1} in f['cities']


def test_不正な入力は日本語メッセージで400(client):
    for bad in ({'company_name': ''}, {}, {'company_name': 'x', 'corporate_number': '123'}, {'company_name': 'x', 'temperature': 'hot'}):
        status, body = client.api('/companies', bad)
        assert status == 400, bad
        assert '入力内容に誤りがあります' in body['error']['message']
    assert client.api('/companies/abc')[0] == 400
    assert client.api('/companies?sort=evil')[0] == 400
    assert client.api('/nope')[0] == 404


def test_カルテの編集で情報源が手入力になる(client):
    cid = client.api('/companies?q=' + quote('古河'))[1]['items'][0]['id']
    status, row = client.api(f'/companies/{cid}', {'phone': '029-111-2222', 'interest': '午睡チェック', 'temperature': 'high'}, method='PATCH')
    assert status == 200
    assert row['phone_normalized'] == '0291112222' and row['temperature'] == 'high'
    fs = client.sql("SELECT field FROM telema_company_field_sources WHERE company_id = %s AND field = 'interest'", (cid,))
    assert fs == [{'field': 'interest'}]
    assert total(client, '0291112222') == 1


def test_salesは他人の担当会社を見られない(client):
    other = client.add_user('他の営業')
    co = client.sql("INSERT INTO telema_companies (company_name, company_name_normalized, assigned_user_id) VALUES ('他人の会社', '他人の会社', %s) RETURNING id", (other,))[0]['id']
    client.set_my_role('sales')
    try:
        assert client.api(f'/companies/{co}')[0] == 404
        assert total(client, '他人') == 0
        assert client.api('/statuses', {'label': '新ステータス', 'category': 'in_progress'})[0] == 403
    finally:
        client.set_my_role('admin')
    assert client.api(f'/companies/{co}')[0] == 200


def test_取得元ごとの件数が返りsource_idで絞り込める(client):
    ls = client.sql("INSERT INTO telema_list_sources (name, source_type) VALUES ('茨城県 認可保育施設', 'public_data') RETURNING id")[0]['id']
    co = client.sql("INSERT INTO telema_companies (company_name, company_name_normalized) VALUES ('取込保育園', '取込保育園') RETURNING id")[0]['id']
    client.sql('INSERT INTO telema_company_sources (company_id, source_id, source_row) VALUES (%s, %s, 2)', (co, ls))
    sources = client.api('/list-sources')[1]
    assert {'name': '茨城県 認可保育施設', 'company_count': 1}.items() <= next(s for s in sources if s['id'] == ls).items()
    lst = client.api(f'/companies?source_id={ls}')[1]
    assert lst['total'] == 1 and lst['items'][0]['company_name'] == '取込保育園'
    assert {'source_id': ls, 'name': '茨城県 認可保育施設'}.items() <= client.api(f'/companies/{co}')[1]['sources'][0].items()


def test_検索用の文字列が施設名_法人名_担当者の変更に追従する(client):
    co = client.api('/companies', {'company_name': '索引テスト園', 'organization_name': '旧名称法人'})[1]
    contact = client.api(f'/companies/{co["id"]}/contacts', {'name': '検索花子'})[1]
    assert total(client, '索引テスト') == 1
    assert total(client, '検索花子') == 1

    client.api(f'/companies/{co["id"]}', {'company_name': '改名した園'}, method='PATCH')
    assert total(client, '索引テスト') == 0
    assert total(client, '改名した') == 1

    client.api(f'/contacts/{contact["id"]}', {'is_active': False}, method='PATCH')
    assert total(client, '検索花子') == 0

    client.sql("UPDATE telema_organizations SET name = '新名称法人' WHERE id = %s", (co['organization_id'],))
    assert total(client, '旧名称法人') == 0
    assert total(client, '新名称法人') == 1


def test_managerとadminは一括割当でき操作ログが残る(client):
    rep = client.add_user('一括営業')
    ids = [client.api('/companies', {'company_name': n})[1]['id'] for n in ('一括A', '一括B', '一括C')]
    status, body = client.api('/companies/bulk-assign', {'company_ids': [*ids, ids[0], 999999], 'assigned_user_id': rep})
    assert status == 200
    assert body == {'updated': 3, 'unchanged': 0, 'not_found': 1}
    assert client.api(f'/companies?assigned={rep}')[1]['total'] == 3
    assert client.api(f'/companies?assigned={rep}')[1]['items'][0]['assigned_user_name'] == '一括営業'
    assert client.sql("SELECT COUNT(*) AS n FROM telema_audit_logs WHERE action = 'assign'") == [{'n': 3}]
    assert client.api('/companies/bulk-assign', {'company_ids': ids[:2], 'assigned_user_id': None})[1]['updated'] == 2
    assert client.api(f'/companies?assigned={rep}')[1]['total'] == 1
    assert client.api('/companies/bulk-assign', {'company_ids': ids, 'assigned_user_id': 999999})[0] == 404


def test_salesは一括割当できない(client):
    co = client.api('/companies', {'company_name': '一括権限'})[1]
    client.set_my_role('sales')
    try:
        assert client.api('/companies/bulk-assign', {'company_ids': [co['id']], 'assigned_user_id': None})[0] == 403
    finally:
        client.set_my_role('admin')


def test_ステータスの追加と変更(client):
    status, row = client.api('/statuses', {'label': '資料送付', 'category': 'in_progress'})
    assert status == 201 and row['sort_order'] == 180
    assert client.api('/statuses', {'label': '資料送付', 'category': 'in_progress'})[0] == 409
    status, row = client.api(f'/statuses/{row["id"]}', {'is_active': False}, method='PATCH')
    assert status == 200 and row['is_active'] == 0 and row['label'] == '資料送付'


def test_エラー時は途中の書き込みを残さない(client):
    before = client.sql('SELECT COUNT(*) AS n FROM telema_organizations')[0]['n']
    # 法人は作られるが、会社の INSERT で失敗（存在しないステータス）→ まとめて取り消される
    status, _ = client.api('/companies', {'company_name': '失敗園', 'organization_name': '失敗法人', 'status_id': 999999})
    assert status == 500
    assert client.sql('SELECT COUNT(*) AS n FROM telema_organizations')[0]['n'] == before
