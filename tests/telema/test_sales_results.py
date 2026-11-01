"""営業結果管理・初回訪問結果管理・営業成績表。期間は他のテストと重ならない過去の月を使う"""

Q = 'date_from=2025-04-01&date_to=2025-04-30'


def make_company(client, name):
    return client.sql('INSERT INTO telema_companies (company_name, company_name_normalized) VALUES (%s, %s) RETURNING id', (name, name))[0]['id']


def visit(client, cid, purpose, at, **kw):
    status, row = client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': '訪問', 'visit_purpose_id': purpose, 'called_at': at, **kw})
    assert status == 201, row
    return row


def test_営業結果管理と初回訪問結果管理は訪問記録がそのまま一覧に出る(client):
    p = {r['name']: r['id'] for r in client.api('/visit-purposes')[1]}
    a, b = make_company(client, '結果管理園A'), make_company(client, '結果管理園B')
    visit(client, a, p['初回訪問'], '2025-04-02T01:00:00Z')
    visit(client, a, p['営業'], '2025-04-10T01:00:00Z', sales_result='waiting', sales_followup_at='2025-04-20T01:00:00Z', sales_product='SP')
    visit(client, a, p['営業'], '2025-04-15T01:00:00Z', sales_result='won', sales_product='SP', sales_amount=300000, sales_gross_profit=90000, sales_units=2)
    visit(client, b, p['初回訪問'], '2025-04-03T01:00:00Z')
    visit(client, b, p['営業'], '2025-04-05T01:00:00Z', sales_result='ng')
    visit(client, b, p['ユーザー訪問'], '2025-04-06T01:00:00Z')
    visit(client, b, p['営業'], '2025-05-05T01:00:00Z', sales_result='won', sales_product='SP')                    # 期間外

    status, body = client.api(f'/sales-results?kind=sales&{Q}')
    items = body['items']
    assert status == 200 and [i['sales_result'] for i in items] == ['won', 'waiting', 'ng'] and not body['truncated']     # 新しい順
    assert (items[0]['company_name'], items[0]['sales_amount'], items[0]['sales_gross_profit'], items[0]['sales_units']) == ('結果管理園A', 300000, 90000, 2)
    assert items[1]['sales_followup_at'] == '2025-04-20T01:00:00.000Z'
    assert [i['sales_result'] for i in client.api(f'/sales-results?kind=sales&result=ng&{Q}')[1]['items']] == ['ng']
    assert client.api(f'/sales-results?kind=sales&result=bad&{Q}')[0] == 400
    assert client.api(f'/sales-results?kind=other&{Q}')[0] == 400

    first = {i['company_name']: i for i in client.api(f'/sales-results?kind=first&{Q}')[1]['items']}
    assert set(first) == {'結果管理園A', '結果管理園B'}
    assert (first['結果管理園A']['later_sales_visits'], first['結果管理園A']['later_won']) == (2, True)              # その後に営業があり、受注した
    assert (first['結果管理園B']['later_sales_visits'], first['結果管理園B']['later_won']) == (2, True)              # 期間外の訪問も「その後」に数える


def test_営業成績表は営業担当ごとに件数と結果の内訳_受注の粗利と台数を数える(client):
    p = {r['name']: r['id'] for r in client.api('/visit-purposes')[1]}
    other = client.add_user('成績表の別の営業', 'sales')
    c = make_company(client, '成績表園')
    q = 'date_from=2025-06-01&date_to=2025-06-30'
    visit(client, c, p['初回訪問'], '2025-06-02T01:00:00Z')
    visit(client, c, p['ユーザー訪問'], '2025-06-03T01:00:00Z')
    visit(client, c, p['営業'], '2025-06-04T01:00:00Z', sales_result='won', sales_product='SP', sales_amount=100000, sales_gross_profit=30000, sales_units=1)
    visit(client, c, p['営業'], '2025-06-05T01:00:00Z', sales_result='ng')
    visit(client, c, p['営業'], '2025-06-06T01:00:00Z', sales_result='resales')
    visit(client, c, p['営業'], '2025-06-07T01:00:00Z')                                                          # 結果なしの営業も営業件数には数える
    mine = client.api(f'/sales-scorecard?{q}')[1]['items']
    assert len(mine) == 1
    row = mine[0]
    assert {k: row[k] for k in ('first_visits', 'user_visits', 'sales_visits', 'won', 'waiting', 'ng', 'resales', 'amount', 'gross_profit', 'units')} == {
        'first_visits': 1, 'user_visits': 1, 'sales_visits': 4, 'won': 1, 'waiting': 0, 'ng': 1, 'resales': 1, 'amount': 100000, 'gross_profit': 30000, 'units': 1}
    # 別の営業担当の記録に付け替えると、その人の行になる。担当者で絞り込める
    sid = client.api(f'/sales-results?kind=sales&{q}')[1]['items'][0]['id']
    client.api(f'/calls/{sid}', {'user_id': other}, method='PATCH')
    assert len(client.api(f'/sales-scorecard?{q}')[1]['items']) == 2
    assert [r['user_id'] for r in client.api(f'/sales-scorecard?{q}&user_id={other}')[1]['items']] == [other]
    assert client.api(f'/sales-scorecard?{q}&user_id=x')[0] == 400
    # 一般は自分の分だけ
    client.set_my_role('sales')
    try:
        assert [r['sales_visits'] for r in client.api(f'/sales-scorecard?{q}&user_id={other}')[1]['items']] == [3]
        assert all(i['user_id'] != other for i in client.api(f'/sales-results?kind=sales&{q}')[1]['items'])
    finally:
        client.set_my_role('admin')
