"""タイムラインの記録の編集で、記録の種類（架電・訪問・返事待ち対応）を変える"""


def make_company(client, name, phone='03-1111-2222'):
    return client.sql('INSERT INTO telema_companies (company_name, company_name_normalized, phone) VALUES (%s, %s, %s) RETURNING id', (name, name, phone))[0]['id']


def calls(client, cid):
    return {c['id']: c for c in client.api(f'/companies/{cid}/calls')[1]}


def company(client, cid):
    return client.api(f'/companies/{cid}')[1]['company']


def test_架電を訪問に変え_訪問を架電に戻せ_架電の件数が数え直される(client):
    cid = make_company(client, '種類変更園')
    purposes = {r['name']: r['id'] for r in client.api('/visit-purposes')[1]}
    status_id = client.status_id('再コール')
    call = client.api(f'/companies/{cid}/calls', {'raw_note': 'メモ', 'result_status_id': status_id, 'called_at': '2026-10-01T01:00:00Z'})[1]
    assert company(client, cid)['call_count'] == 1
    # 架電 → 訪問：方法が必要。結果・電話番号は外れ、AI整理は付かない。架電の件数は減る
    assert client.api(f'/calls/{call["id"]}', {'record_type': 'visit'}, method='PATCH')[0] == 400
    status, v = client.api(f'/calls/{call["id"]}', {'record_type': 'visit', 'visit_method': 'zoom', 'visit_purpose_id': purposes['初回訪問']}, method='PATCH')
    assert status == 200 and (v['record_type'], v['visit_method'], v['visit_purpose_id']) == ('visit', 'zoom', purposes['初回訪問'])
    assert v['result_status_id'] is None and v['phone_number'] is None and v['ai_status'] == 'skipped'
    assert company(client, cid)['call_count'] == 0 and company(client, cid)['last_called_at'] is None
    # 訪問 → 架電：訪問の内容・方法は外れ、電話番号は施設の番号になる。メモがあるのでAI整理できる状態になる。架電の件数が戻る
    status, c = client.api(f'/calls/{call["id"]}', {'record_type': 'call', 'result_status_id': status_id}, method='PATCH')
    assert status == 200 and (c['record_type'], c['visit_method'], c['visit_purpose_id'], c['result_status_id']) == ('call', None, None, status_id)
    assert c['phone_number'] == '03-1111-2222' and c['ai_status'] == 'pending'
    assert company(client, cid)['call_count'] == 1
    # 種類が同じなら、今までどおり
    assert client.api(f'/calls/{call["id"]}', {'record_type': 'call', 'raw_note': '直した'}, method='PATCH')[1]['raw_note'] == '直した'


def test_営業の訪問記録を返事待ち対応に変えると_返事待ちに紐づけられ_契約情報が作られる(client):
    cid = make_company(client, '種類変更返事園')
    purposes = {r['name']: r['id'] for r in client.api('/visit-purposes')[1]}
    visit = lambda **kw: client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': '営業', 'visit_purpose_id': purposes['営業'], **kw})
    waiting = visit(sales_result='waiting', sales_followup_at='2026-11-20T01:00:00Z', called_at='2026-10-01T01:00:00Z')[1]
    mistaken = client.api(f'/companies/{cid}/calls', {'raw_note': '間違えて架電で入れた', 'called_at': '2026-10-05T01:00:00Z'})[1]
    # 架電 → 返事待ち対応：結果が必要（受注・NG・再営業）。直近の返事待ちに紐づく
    assert client.api(f'/calls/{mistaken["id"]}', {'record_type': 'reply'}, method='PATCH')[0] == 400
    status, r = client.api(f'/calls/{mistaken["id"]}', {'record_type': 'reply', 'sales_result': 'won', 'sales_product': '種類変更商材', 'sales_amount': 100000,
                                                       'sales_product_monthly': 9800, 'sales_cashback': 1000}, method='PATCH')
    assert status == 200 and r['record_type'] == 'reply' and r['reply_to_id'] == waiting['id'] and r['phone_number'] is None
    assert next(c for c in client.api(f'/companies/{cid}')[1]['contracts'] if c['product_name'] == '種類変更商材')['product_monthly'] == 9800
    # 返事待ち対応が紐づいた訪問記録は、種類を変えられない
    assert client.api(f'/calls/{waiting["id"]}', {'record_type': 'call'}, method='PATCH')[0] == 400
    # 返事待ち対応 → 訪問：紐づけは外れる
    status, v = client.api(f'/calls/{mistaken["id"]}', {'record_type': 'visit', 'visit_method': 'visit', 'visit_purpose_id': purposes['営業'], 'sales_result': 'waiting'}, method='PATCH')
    assert status == 200 and v['record_type'] == 'visit' and v['reply_to_id'] is None
    # 紐づけがなくなれば、元の訪問記録の種類も変えられる
    assert client.api(f'/calls/{waiting["id"]}', {'record_type': 'call'}, method='PATCH')[0] == 200


def test_種類を変えた先で付けられない項目は弾かれる(client):
    cid = make_company(client, '種類変更権限園')
    purposes = {r['name']: r['id'] for r in client.api('/visit-purposes')[1]}
    call = client.api(f'/companies/{cid}/calls', {'raw_note': 'x'})[1]
    # 架電のまま、営業の項目は付けられない／訪問に変えても、訪問の内容が営業でなければ付けられない
    assert client.api(f'/calls/{call["id"]}', {'record_type': 'visit', 'visit_method': 'visit', 'visit_purpose_id': purposes['初回訪問'], 'sales_product_monthly': 1}, method='PATCH')[0] == 400
    # 返事待ち対応にできる結果は受注・NG・再営業だけ。受注以外には支払い内容は付けられない
    assert client.api(f'/calls/{call["id"]}', {'record_type': 'reply', 'sales_result': 'waiting'}, method='PATCH')[0] == 400
    assert client.api(f'/calls/{call["id"]}', {'record_type': 'reply', 'sales_result': 'ng', 'sales_cashback': 1}, method='PATCH')[0] == 400
    assert client.api(f'/calls/{call["id"]}', {'record_type': 'reply', 'sales_result': 'ng'}, method='PATCH')[0] == 200
    assert client.api(f'/calls/{call["id"]}', {'record_type': 'bogus'}, method='PATCH')[0] == 400
