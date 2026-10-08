"""結果が「時間設定」の架電に付ける、訪問する日時と事前確認の日時。"""


def make_company(client, name):
    return client.sql(
        'INSERT INTO telema_companies (company_name, company_name_normalized) VALUES (%s, %s) RETURNING id', (name, name))[0]['id']


VISIT, PRECHECK = '2026-10-20T01:00:00Z', '2026-10-18T06:00:00Z'


def test_時間設定の架電に訪問日時と事前確認日時を付けて登録でき_一覧に返る(client):
    cid = make_company(client, '時間設定園')
    appo = client.status_id('時間設定成立')
    status, row = client.api(f'/companies/{cid}/calls', {'raw_note': '訪問が決まった', 'result_status_id': appo, 'visit_at': VISIT, 'precheck_at': PRECHECK})
    assert status == 201
    assert {'visit_at': '2026-10-20T01:00:00.000Z', 'precheck_at': '2026-10-18T06:00:00.000Z', 'result_label': '時間設定成立'}.items() <= row.items()
    assert client.api(f'/companies/{cid}/calls')[1][0]['visit_at'] == '2026-10-20T01:00:00.000Z'
    # 片方だけでも、どちらも無くても登録できる
    only = client.api(f'/companies/{cid}/calls', {'raw_note': 'x', 'result_status_id': appo, 'visit_at': VISIT})[1]
    assert only['visit_at'] and only['precheck_at'] is None
    none = client.api(f'/companies/{cid}/calls', {'raw_note': 'y', 'result_status_id': appo})[1]
    assert none['visit_at'] is None and none['precheck_at'] is None


def test_時間設定以外の結果や訪問の記録には付けられない(client):
    cid = make_company(client, '検証園')
    recall = client.status_id('再コール')
    for body in ({'result_status_id': recall, 'visit_at': VISIT}, {'visit_at': VISIT}, {'result_status_id': recall, 'precheck_at': PRECHECK}):
        status, err = client.api(f'/companies/{cid}/calls', {'raw_note': 'x', **body})
        assert status == 400 and '時間設定' in err['error']['message'], body
    assert client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': 'x', 'visit_at': VISIT})[0] == 400
    assert client.sql('SELECT COUNT(*) AS n FROM telema_call_logs WHERE company_id = %s', (cid,))[0]['n'] == 0
    assert client.api(f'/companies/{cid}/calls', {'raw_note': 'x', 'result_status_id': recall, 'visit_at': None})[0] == 201      # null は付けないのと同じ


def test_編集で日時を直せて_結果を時間設定以外に直すと日時は外れる(client):
    cid = make_company(client, '編集園')
    appo, recall = client.status_id('時間設定成立'), client.status_id('再コール')
    call = client.api(f'/companies/{cid}/calls', {'raw_note': 'x', 'result_status_id': appo, 'visit_at': VISIT})[1]
    row = client.api(f'/calls/{call["id"]}', {'visit_at': '2026-10-25T01:00:00Z', 'precheck_at': PRECHECK}, method='PATCH')[1]
    assert row['visit_at'] == '2026-10-25T01:00:00.000Z' and row['precheck_at'] == '2026-10-18T06:00:00.000Z'
    # 時間設定のままメモだけ直しても日時は残る
    assert client.api(f'/calls/{call["id"]}', {'raw_note': '直した'}, method='PATCH')[1]['visit_at'] == '2026-10-25T01:00:00.000Z'
    # 結果を直すと日時は外れる。同時に日時を送ると拒否
    assert client.api(f'/calls/{call["id"]}', {'result_status_id': recall, 'visit_at': VISIT}, method='PATCH')[0] == 400
    row = client.api(f'/calls/{call["id"]}', {'result_status_id': recall}, method='PATCH')[1]
    assert row['visit_at'] is None and row['precheck_at'] is None and row['result_label'] == '再コール'
    # 時間設定でない記録には、あとからも付けられない。時間設定に直すときは同時に付けられる
    assert client.api(f'/calls/{call["id"]}', {'visit_at': VISIT}, method='PATCH')[0] == 400
    row = client.api(f'/calls/{call["id"]}', {'result_status_id': appo, 'visit_at': VISIT}, method='PATCH')[1]
    assert row['visit_at'] == '2026-10-20T01:00:00.000Z'
    log = client.sql("SELECT before_json FROM telema_audit_logs WHERE entity_type = 'call_log' AND entity_id = %s ORDER BY id", (call['id'],))
    assert any(r['before_json'] and 'visit_at' in r['before_json'] for r in log)
