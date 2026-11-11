"""受注の支払い内容：商品（月額・回数）、サーバー（月額・回数）、CB（キャッシュバック料金）。返事待ち対応の受注・即決受注・契約情報に持つ"""

PAY = {'sales_product_monthly': 9800, 'sales_product_term': '36', 'sales_server_monthly': 1100, 'sales_server_term': 'inhouse', 'sales_cashback': 30000}
TERMS = ['cash', 'inhouse', '12', '24', '36', '48', '60', '72', '84']


def make_company(client, name):
    return client.sql('INSERT INTO telema_companies (company_name, company_name_normalized) VALUES (%s, %s) RETURNING id', (name, name))[0]['id']


def waiting_visit(client, cid):
    purposes = {r['name']: r['id'] for r in client.api('/visit-purposes')[1]}
    status, w = client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': '提案', 'visit_purpose_id': purposes['営業'],
                                                      'sales_result': 'waiting', 'sales_followup_at': '2026-11-20T01:00:00Z'})
    assert status == 201
    return w, purposes


def test_返事待ち対応の受注で支払い内容を残せ_契約情報へ引き継がれる(client):
    cid = make_company(client, '支払い返事園')
    w, _ = waiting_visit(client, cid)
    status, r = client.api(f'/companies/{cid}/calls', {'record_type': 'reply', 'raw_note': '受注', 'sales_result': 'won', 'sales_product': '支払い商材', 'sales_amount': 480000,
                                                     'sales_gross_profit': 150000, 'sales_units': 1, 'reply_to_id': w['id'], **PAY})
    assert status == 201 and {k: r[k] for k in PAY} == PAY
    contract = next(c for c in client.api(f'/companies/{cid}')[1]['contracts'] if c['product_name'] == '支払い商材')
    assert (contract['product_monthly'], contract['product_term'], contract['server_monthly'], contract['server_term'], contract['cashback']) == (9800, '36', 1100, 'inhouse', 30000)
    # 記録を直すと、契約情報にも反映される
    assert client.api(f'/calls/{r["id"]}', {'sales_product_monthly': 12000, 'sales_server_term': 'cash', 'sales_cashback': 0}, method='PATCH')[0] == 200
    contract = next(c for c in client.api(f'/companies/{cid}')[1]['contracts'] if c['product_name'] == '支払い商材')
    assert (contract['product_monthly'], contract['server_term'], contract['cashback']) == (12000, 'cash', 0)
    # 結果を受注以外に直すと、支払い内容は外れる
    row = client.api(f'/calls/{r["id"]}', {'sales_result': 'ng'}, method='PATCH')[1]
    assert all(row[k] is None for k in PAY)


def test_回数は決まった選択肢だけで_受注以外には付けられない(client):
    cid = make_company(client, '支払い選択肢園')
    w, purposes = waiting_visit(client, cid)
    reply = lambda **kw: client.api(f'/companies/{cid}/calls', {'record_type': 'reply', 'raw_note': '返事', 'sales_result': 'won', 'sales_product': '選択肢商材', **kw})
    for t in TERMS:
        assert reply(sales_product_term=t, sales_server_term=t)[0] == 201, t
    assert all(reply(sales_product_term=t)[0] == 400 for t in ('6', '120', 'cash1', '12回'))
    assert reply(sales_server_term='96')[0] == 400
    assert reply(sales_product_monthly=-1)[0] == 400 and reply(sales_cashback=-1)[0] == 400
    # 受注以外（NG・返事待ち）には付けられない
    assert client.api(f'/companies/{cid}/calls', {'record_type': 'reply', 'raw_note': 'x', 'sales_result': 'ng', 'sales_cashback': 100})[0] == 400
    visit = lambda **kw: client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': '営業', 'visit_purpose_id': purposes['営業'], **kw})
    assert visit(sales_result='waiting', sales_product_monthly=1000)[0] == 201                  # 営業の訪問記録は、結果によらず残せる（提案の内容）
    assert visit(sales_product_monthly=1000)[0] == 201
    # 即決受注（営業の訪問記録）でも残せる
    status, v = visit(sales_result='won', sales_product='即決商材', **PAY)
    assert status == 201 and {k: v[k] for k in PAY} == PAY
    assert next(c for c in client.api(f'/companies/{cid}')[1]['contracts'] if c['product_name'] == '即決商材')['server_term'] == 'inhouse'


def test_契約情報に支払い内容を登録して直せる(client):
    cid = make_company(client, '支払い契約園')
    body = {'product_name': '契約商材', 'contract_date': '2026-11-01', 'product_monthly': 9800, 'product_term': '24', 'server_monthly': 500, 'server_term': '84', 'cashback': 20000}
    status, c = client.api(f'/companies/{cid}/contracts', body)
    assert status == 201 and (c['product_monthly'], c['product_term'], c['server_monthly'], c['server_term'], c['cashback']) == (9800, '24', 500, '84', 20000)
    row = client.api(f'/contracts/{c["id"]}', {'product_term': 'inhouse', 'server_term': None, 'cashback': None}, method='PATCH')[1]
    assert (row['product_term'], row['server_term'], row['cashback'], row['product_monthly']) == ('inhouse', None, None, 9800)
    assert client.api(f'/contracts/{c["id"]}', {'product_term': '18'}, method='PATCH')[0] == 400
    assert client.api(f'/companies/{cid}/contracts', {**body, 'server_term': 'x'})[0] == 400
    assert client.api(f'/companies/{cid}/contracts', {**body, 'cashback': -5})[0] == 400
    # 何も入れなくても登録できる（今までどおり）
    ok = client.api(f'/companies/{cid}/contracts', {'product_name': '支払いなし', 'contract_date': '2026-11-02'})[1]
    assert ok['product_monthly'] is None and ok['cashback'] is None


def test_これまでの営業の月額と期間は商品の月額と回数に引き継がれる(client):
    from telema import schema  # noqa: F401
    cid = make_company(client, '引き継ぎ園')
    purposes = {r['name']: r['id'] for r in client.api('/visit-purposes')[1]}
    v = client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': '提案', 'visit_purpose_id': purposes['営業']})[1]
    client.sql('UPDATE telema_call_logs SET sales_monthly_fee = 9800, sales_term = %s WHERE id = %s', ('48', v['id']))
    client.sql('UPDATE telema_call_logs SET sales_product_monthly = sales_monthly_fee, sales_product_term = sales_term WHERE sales_monthly_fee IS NOT NULL OR sales_term IS NOT NULL')
    row = next(c for c in client.api(f'/companies/{cid}/calls')[1] if c['id'] == v['id'])
    assert (row['sales_product_monthly'], row['sales_product_term']) == (9800, '48')
