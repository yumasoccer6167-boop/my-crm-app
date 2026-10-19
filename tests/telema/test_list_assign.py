"""リストを担当者に割り振ったとき、ステータスを自動で「未アプローチ」にし、タイムラインに「リスト割り振り」を残す。"""


def make_company(client, name, status=None, assigned=None):
    return client.sql(
        'INSERT INTO telema_companies (company_name, company_name_normalized, status_id, assigned_user_id) VALUES (%s, %s, %s, %s) RETURNING id',
        (name, name, status, assigned))[0]['id']


def status_label(client, cid):
    return client.sql('SELECT s.label FROM telema_companies c LEFT JOIN telema_call_statuses s ON s.id = c.status_id WHERE c.id = %s', (cid,))[0]['label']


def add_status(client):
    """アプリの設定・管理で登録する「未アプローチ」（未対応の区分）"""
    client.sql("INSERT INTO telema_call_statuses (label, category, sort_order) VALUES ('未アプローチ', 'not_started', 5) ON CONFLICT (label) DO NOTHING RETURNING id")


def test_一括割り振りでステータスが未アプローチになり_タイムラインに残る(client):
    add_status(client)
    rep = client.add_user('割り振り先', 'sales')
    recall = client.status_id('再コール')
    a, b = make_company(client, '割振園A', status=client.status_id('未コール')), make_company(client, '割振園B')
    assert client.api('/companies/bulk-assign', {'company_ids': [a, b], 'assigned_user_id': rep})[1]['updated'] == 2
    assert status_label(client, a) == status_label(client, b) == '未アプローチ'          # ステータスが未設定・未対応の施設は、未アプローチになる
    d = client.api(f'/companies/{a}')[1]
    assert [(x['assignee_name']) for x in d['assignments']] == ['割り振り先'] and d['assignments'][0]['at']
    # 同じ担当者への割り振りは何も変えない。担当者を外しても、ステータスは変えず記録もしない
    client.api(f'/companies/{a}', {'status_id': recall}, method='PATCH')
    assert client.api('/companies/bulk-assign', {'company_ids': [a], 'assigned_user_id': rep})[1]['unchanged'] == 1
    assert status_label(client, a) == '再コール'
    assert client.api('/companies/bulk-assign', {'company_ids': [a], 'assigned_user_id': None})[1]['updated'] == 1
    d = client.api(f'/companies/{a}')[1]
    assert d['company']['assigned_user_id'] is None and status_label(client, a) == '再コール' and len(d['assignments']) == 1


def test_すでに進んでいる施設は_ステータスをそのままにして_割り振りだけ残る(client):
    add_status(client)
    rep, rep2 = client.add_user('担当甲', 'sales'), client.add_user('担当乙', 'sales')
    won, recall = client.status_id('受注成立'), client.status_id('再コール')
    a, b, c = make_company(client, '進行園A', status=won), make_company(client, '進行園B', status=recall), make_company(client, '未着手園C')
    assert client.api('/companies/bulk-assign', {'company_ids': [a, b, c], 'assigned_user_id': rep})[1]['updated'] == 3
    assert [status_label(client, x) for x in (a, b, c)] == ['受注成立', '再コール', '未アプローチ']
    assert all(len(client.api(f'/companies/{x}')[1]['assignments']) == 1 for x in (a, b, c))       # 進んでいる施設にも、割り振りの記録は残る
    for x in (a, b):
        assert client.api(f'/companies/{x}', {'assigned_user_id': rep2}, method='PATCH')[0] == 200
    assert [status_label(client, x) for x in (a, b)] == ['受注成立', '再コール']


def test_カルテで担当者を変えたときも同じ_ステータスを同時に指定すればそちらが優先(client):
    add_status(client)
    rep, rep2 = client.add_user('担当甲', 'sales'), client.add_user('担当乙', 'sales')
    a, b = make_company(client, '個別割振園A'), make_company(client, '個別割振園B')
    assert client.api(f'/companies/{a}', {'assigned_user_id': rep}, method='PATCH')[0] == 200
    assert status_label(client, a) == '未アプローチ'
    assert client.api(f'/companies/{a}', {'assigned_user_id': rep2}, method='PATCH')[0] == 200      # 別の担当者に替えても、また割り振りとして残る
    assert [x['assignee_name'] for x in client.api(f'/companies/{a}')[1]['assignments']] == ['担当乙', '担当甲']
    recall = client.status_id('再コール')
    assert client.api(f'/companies/{b}', {'assigned_user_id': rep, 'status_id': recall}, method='PATCH')[0] == 200
    assert status_label(client, b) == '再コール' and len(client.api(f'/companies/{b}')[1]['assignments']) == 1
    # 担当者以外の項目を直しても、割り振りにはならない
    assert client.api(f'/companies/{a}', {'notes': 'メモ'}, method='PATCH')[0] == 200 and len(client.api(f'/companies/{a}')[1]['assignments']) == 2
    # 「未アプローチ」が登録されていなければ、ステータスは変えず、割り振りだけ残す
    client.sql("UPDATE telema_call_statuses SET label = '未アプローチ（名前を変更）' WHERE label = '未アプローチ' RETURNING id")
    c = make_company(client, '登録なし園')
    assert client.api(f'/companies/{c}', {'assigned_user_id': rep}, method='PATCH')[0] == 200
    assert status_label(client, c) is None and len(client.api(f'/companies/{c}')[1]['assignments']) == 1


def test_ステータスを一括で変更できる_マネージャー以上だけ(client):
    a, b = make_company(client, '一括ステータス園A', status=client.status_id('再コール')), make_company(client, '一括ステータス園B')
    won = client.status_id('受注成立')
    status, r = client.api('/companies/bulk-status', {'company_ids': [a, b, 999999], 'status_id': won})
    assert status == 200 and r == {'updated': 2, 'unchanged': 0, 'not_found': 1}
    assert status_label(client, a) == status_label(client, b) == '受注成立'
    assert client.api('/companies/bulk-status', {'company_ids': [a, b], 'status_id': won})[1] == {'updated': 0, 'unchanged': 2, 'not_found': 0}
    assert client.api('/companies/bulk-status', {'company_ids': [a], 'status_id': None})[1]['updated'] == 1 and status_label(client, a) is None
    assert client.api('/companies/bulk-status', {'company_ids': [a], 'status_id': 999999})[0] == 404
    assert client.api('/companies/bulk-status', {'company_ids': [], 'status_id': won})[0] == 400
    assert len(client.sql("SELECT 1 FROM telema_audit_logs WHERE entity_type = 'company' AND entity_id = %s AND action = 'update'", (a,))) == 2
    # 一括ステータス変更は担当割り振りではないので、タイムラインの「リスト割り振り」にはならない
    assert client.api(f'/companies/{a}')[1]['assignments'] == []
    client.set_my_role('sales')
    try:
        assert client.api('/companies/bulk-status', {'company_ids': [a], 'status_id': won})[0] == 403
    finally:
        client.set_my_role('admin')
