"""営業の訪問記録・返事待ち対応に、商材を複数登録できる（sales_items）。記録側の sales_* は先頭の商材・金額の合計にそろう。受注は商材ごとに契約ができる"""

PAY_A = {'product_monthly': 9800, 'product_term': '36', 'server_monthly': 1100, 'server_term': 'inhouse', 'cashback': 30000}


def make_company(client, name):
    return client.sql('INSERT INTO telema_companies (company_name, company_name_normalized) VALUES (%s, %s) RETURNING id', (name, name))[0]['id']


def setup(client, name):
    purposes = {r['name']: r['id'] for r in client.api('/visit-purposes')[1]}
    cid = make_company(client, name)
    visit = lambda **kw: client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': '提案', 'visit_purpose_id': purposes['営業'], **kw})
    contracts = lambda: sorted(((c['product_name'], c['amount'], c['gross_profit'], c['units']) for c in client.api(f'/companies/{cid}')[1]['contracts']), key=lambda t: t[0])
    return cid, purposes, visit, contracts


def item(product, **kw):
    return {'product': product, 'product_monthly': None, 'product_term': None, 'server_monthly': None, 'server_term': None, 'cashback': None,
            'amount': None, 'gross_profit': None, 'units': None, **kw}


def test_商材を複数登録でき_記録側は先頭の商材と合計にそろう(client):
    cid, _, visit, contracts = setup(client, '複数商材園')
    status, v = visit(sales_result='waiting', sales_followup_at='2026-11-20T01:00:00Z', sales_items=[item('商材A', **PAY_A), item('商材B', product_monthly=5000), item('', cashback=None)])
    assert status == 201
    assert [i['product'] for i in v['sales_items']] == ['商材A', '商材B']                          # 何も入っていない行は除かれる
    assert (v['sales_product'], v['sales_product_monthly'], v['sales_server_term'], v['sales_cashback']) == ('商材A', 9800, 'inhouse', 30000)
    assert v['sales_items'][1]['product_monthly'] == 5000
    assert contracts() == []                                                                    # 受注ではないので契約はできない
    assert client.api(f'/companies/{cid}/calls')[1][0]['sales_items'][0]['product'] == '商材A'
    # 商材なしで保存でき、行は空
    status, w = visit(sales_result='waiting', sales_items=[])
    assert status == 201 and w['sales_items'] == [] and w['sales_product'] is None


def test_即決受注は商材ごとに契約ができ_行を直すと契約にも反映_減らすと契約は外れる(client):
    cid, _, visit, contracts = setup(client, '受注複数商材園')
    status, v = visit(sales_result='won', sales_items=[item('商材A', amount=300000, gross_profit=90000, units=2, **PAY_A), item('商材B', amount=100000, gross_profit=30000, units=1)])
    assert status == 201
    assert (v['sales_amount'], v['sales_gross_profit'], v['sales_units']) == (400000, 120000, 3)       # 合計
    assert contracts() == [('商材A', 300000, 90000, 2), ('商材B', 100000, 30000, 1)]
    co = {c['product_name']: c for c in client.api(f'/companies/{cid}')[1]['contracts']}
    assert (co['商材A']['product_monthly'], co['商材A']['cashback']) == (9800, 30000)
    # 2番目の商材の金額を直す → 契約にも反映。合計も変わる
    status, v2 = client.api(f'/calls/{v["id"]}', {'sales_items': [item('商材A', amount=300000, gross_profit=90000, units=2, **PAY_A), item('商材B', amount=150000, gross_profit=45000, units=1)]}, method='PATCH')
    assert status == 200 and v2['sales_amount'] == 450000 and contracts() == [('商材A', 300000, 90000, 2), ('商材B', 150000, 45000, 1)]
    # 商材を1つに減らす → 2番目の契約は外れる
    status, v3 = client.api(f'/calls/{v["id"]}', {'sales_items': [item('商材A', amount=300000, gross_profit=90000, units=2, **PAY_A)]}, method='PATCH')
    assert status == 200 and len(v3['sales_items']) == 1 and contracts() == [('商材A', 300000, 90000, 2)]
    # 結果を受注以外にしても契約は消さない。行の金額は外れる
    status, v4 = client.api(f'/calls/{v["id"]}', {'sales_result': 'ng', 'sales_items': [item('商材A', **PAY_A)]}, method='PATCH')
    assert status == 200 and v4['sales_amount'] is None and v4['sales_items'][0]['amount'] is None and len(contracts()) == 1


def test_受注のときはすべての商材を選ぶ_営業以外の記録には付けられない(client):
    cid, purposes, visit, _ = setup(client, '商材チェック園')
    assert visit(sales_result='won', sales_items=[item('商材A', amount=1), item(None, cashback=100)])[0] == 400
    assert visit(sales_result='waiting', sales_items=[item('商材A', amount=1)])[0] == 400                 # 金額は即決受注のときだけ
    assert visit(sales_items=[item(f'商材{i}') for i in range(11)])[0] == 400                            # 10件まで
    assert visit(sales_items=[{'product': 'A', 'product_term': '6'}])[0] == 400                           # 回数は決まった選択肢だけ
    status, _ = client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': 'x', 'visit_purpose_id': purposes['初回訪問'], 'sales_items': [item('商材A')]})
    assert status == 400


def test_返事待ち対応の受注も商材ごとに契約ができる(client):
    cid, purposes, visit, contracts = setup(client, '返事複数商材園')
    w = visit(sales_result='waiting', sales_followup_at='2026-11-20T01:00:00Z', sales_items=[item('商材A'), item('商材B')])[1]
    reply = lambda **kw: client.api(f'/companies/{cid}/calls', {'record_type': 'reply', 'raw_note': '返事', 'reply_to_id': w['id'], **kw})
    assert reply(sales_result='ng', sales_items=[item('商材A', cashback=1)])[0] == 400                    # 返事待ち対応の支払い内容は受注のときだけ
    status, r = reply(sales_result='won', sales_items=[item('商材A', amount=200000, gross_profit=60000, units=1), item('商材B', amount=100000, gross_profit=30000, units=1)])
    assert status == 201 and r['sales_amount'] == 300000 and contracts() == [('商材A', 200000, 60000, 1), ('商材B', 100000, 30000, 1)]
    # 受注を取り消して NG にすると、行の金額・支払い内容は外れる
    row = client.api(f'/calls/{r["id"]}', {'sales_result': 'ng'}, method='PATCH')[1]
    assert all(i['amount'] is None for i in row['sales_items']) and row['sales_amount'] is None


def test_これまでの記録は行が無くても_商材の行として扱え_記録側だけ直しても行がそろう(client):
    cid, _, visit, contracts = setup(client, '従来記録園')
    v = visit(sales_result='won', sales_product='従来商材', sales_amount=100000, sales_gross_profit=30000, sales_units=1, sales_product_monthly=9800)[1]
    assert v['sales_items'] == [] and contracts() == [('従来商材', 100000, 30000, 1)]                # 行を送らなければ、これまでどおり1件
    # 行で保存し直す（同じ内容）→ 契約は増えない
    status, v2 = client.api(f'/calls/{v["id"]}', {'sales_items': [item('従来商材', amount=100000, gross_profit=30000, units=1, product_monthly=9800), item('追加商材', amount=50000, gross_profit=10000, units=1)]}, method='PATCH')
    assert status == 200 and contracts() == [('従来商材', 100000, 30000, 1), ('追加商材', 50000, 10000, 1)]
    # 行があるとき、記録側の商材・月額だけ直すと先頭の行にそろう
    client.api(f'/calls/{v["id"]}', {'sales_product_monthly': 12000}, method='PATCH')
    assert client.api(f'/companies/{cid}/calls')[1][0]['sales_items'][0]['product_monthly'] == 12000
    # 記録を無効にすると、商材ごとの契約もすべて外れる
    assert client.api(f'/calls/{v["id"]}/deactivate', {}, method='POST')[0] == 200 and contracts() == []


def test_営業結果管理の一覧にも商材の行が出る(client):
    cid, _, visit, _ = setup(client, '一覧複数商材園')
    visit(called_at='2025-03-05T01:00:00Z', sales_result='waiting', sales_items=[item('商材A'), item('商材B')])
    rows = [i for i in client.api('/sales-results?kind=sales&date_from=2025-03-01&date_to=2025-03-31')[1]['items'] if i['company_id'] == cid]
    assert [i['product'] for i in rows[0]['sales_items']] == ['商材A', '商材B']
