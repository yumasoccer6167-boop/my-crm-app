"""営業成績ダッシュボード。過去の月（2026-03）を使い、月末までの実績を見る"""


def add_user(client, name):
    return client.sql("INSERT INTO users (username, password_hash, display_name, role) VALUES (%s, 'x', %s, 'general') RETURNING id", (name, name))[0]['id']


def make_company(client, name):
    return client.sql('INSERT INTO telema_companies (company_name, company_name_normalized) VALUES (%s, %s) RETURNING id', (name, name))[0]['id']


def test_部署ごとに目標_必要数_実数_達成率を小計つきで並べる(client):
    api = client.api
    purposes = {r['name']: r['id'] for r in api('/visit-purposes')[1]}
    biz = api('/org/departments', {'name': 'テスト事業部'})[1]['id']
    bu = api('/org/departments', {'name': 'テスト部', 'parent_id': biz})[1]['id']
    k1 = api('/org/departments', {'name': 'テスト一課', 'parent_id': bu})[1]['id']
    k2 = api('/org/departments', {'name': 'テスト二課', 'parent_id': bu})[1]['id']
    k3 = api('/org/departments', {'name': '空の課', 'parent_id': bu})[1]['id']
    a, b, c = (add_user(client, f'ボード{x}') for x in 'ABC')
    for u, k in ((a, k1), (b, k1), (c, k2)):
        assert api('/org/assignments', {'user_id': u, 'department_id': k, 'effective_date': '2025-01-01'})[0] == 201
    for u, gp, units in ((a, 2000000, 5), (b, 1000000, 3), (c, 500000, 2)):
        assert api(f'/targets/{u}/2026-03', {'gross_profit': gp, 'units': units}, method='PUT')[0] == 200
    # 受注：Aが 54P・1台（契約日 3/10）。Bは4月の契約（3月の実数には入らない）
    co = make_company(client, 'ボード園')
    contract = lambda uid, day, gp: api(f'/companies/{co}/contracts', {'product_name': 'SPボード', 'contract_date': day, 'assigned_user_id': uid, 'gross_profit': gp, 'units': 1})
    assert contract(a, '2026-03-10', 540000)[0] == 201 and contract(b, '2026-04-02', 100000)[0] == 201

    status, r = api('/sales-board?month=2026-03')
    assert status == 200 and r['workdays_total'] == 22 and r['workdays_elapsed'] == 22          # 過ぎた月は月末まで
    names = [(x['kind'], x['level'], x['name']) for x in r['rows']]
    assert names == [('member', 'member', 'ボードA'), ('member', 'member', 'ボードB'), ('dept', 'unit', 'テスト一課'),
                     ('member', 'member', 'ボードC'), ('dept', 'unit', 'テスト二課'), ('dept', 'group', 'テスト部'), ('dept', 'total', 'テスト事業部 合計')]
    by = {x['name']: x for x in r['rows']}
    assert (by['ボードA']['target_gp'], by['ボードA']['need_gp'], by['ボードA']['act_gp'], by['ボードA']['contracts']) == (2000000, 2000000, 540000, 1)
    assert by['ボードA']['rate_gp'] == 27.0 and by['ボードA']['rate_units'] == 20.0
    assert by['ボードB']['act_gp'] == 0 and by['ボードB']['rate_gp'] == 0.0
    one = by['テスト一課']
    assert (one['target_gp'], one['target_units'], one['act_gp'], one['rate_gp']) == (3000000, 8, 540000, 18.0)
    tot = by['テスト事業部 合計']
    assert (tot['target_gp'], tot['act_gp'], tot['contracts']) == (3500000, 540000, 1) and tot['rate_gp'] == round(54 / 350 * 100, 1)
    assert tot['depth'] == 0 and by['テスト部']['depth'] == 1 and by['テスト一課']['depth'] == 2 and by['ボードA']['depth'] == 3
    assert '空の課' not in by                                                                  # メンバーのいない部署は載せない

    # 所属のない人は、目標か実績があるときだけ「未所属」に載る。複数の最上位があるときは全体合計が付く
    owner = client.sql("SELECT id FROM users WHERE username = 'owner'")[0]['id']
    assert not [x for x in api('/sales-board?month=2026-03')[1]['rows'] if x['name'] == '未所属']
    # 決アポ・担アポ・商談数・落ち率（記録をつけたのは owner）
    visit = lambda cid, **kw: api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': 'x', 'visit_purpose_id': purposes['営業'], **kw})
    x, y, z, w = (make_company(client, f'ボード電話{i}') for i in 'XYZW')
    cx = client.sql('INSERT INTO telema_contacts (company_id, name, is_decision_maker) VALUES (%s, %s, 1) RETURNING id', (x, '園長'))[0]['id']
    cy = client.sql('INSERT INTO telema_contacts (company_id, name, is_decision_maker) VALUES (%s, %s, 0) RETURNING id', (y, '主任'))[0]['id']
    assert api(f'/companies/{x}/calls', {'raw_note': 'x', 'called_at': '2026-03-05T01:00:00Z', 'contact_id': cx, 'result_status_id': client.status_id('初回訪問時間設定')})[0] == 201
    assert api(f'/companies/{y}/calls', {'raw_note': 'x', 'called_at': '2026-03-05T02:00:00Z', 'contact_id': cy, 'result_status_id': client.status_id('時間設定成立')})[0] == 201
    assert visit(z, called_at='2026-03-06T02:00:00Z', sales_result='ng')[0] == 201
    waiting = visit(w, called_at='2026-03-06T03:00:00Z', sales_result='waiting', sales_followup_at='2026-03-20T02:00:00Z')[1]
    assert api(f'/companies/{w}/calls', {'record_type': 'reply', 'raw_note': '返事', 'sales_result': 'ng', 'reply_to_id': waiting['id'], 'called_at': '2026-03-09T03:00:00Z'})[0] == 201
    api(f'/targets/{owner}/2026-03', {'gross_profit': 100000, 'units': 1}, method='PUT')
    mine = {x['name']: x for x in api('/sales-board?month=2026-03')[1]['rows']}[client.sql("SELECT display_name FROM users WHERE username = 'owner'")[0]['display_name']]
    assert (mine['appo_dm'], mine['appo_staff'], mine['deals'], mine['ng'], mine['rate_fall']) == (1, 1, 2, 2, 100.0)
    assert by['ボードA']['rate_fall'] is None and by['ボードA']['deals'] == 0
    rows = api('/sales-board?month=2026-03')[1]['rows']
    assert [x['name'] for x in rows][-3:] == ['未所属', '全体 合計'] or [x['name'] for x in rows][-2:] == ['未所属', '全体 合計']
    assert {x['name']: x['level'] for x in rows}['テスト事業部'] == 'group' and rows[-1]['level'] == 'total' and rows[-1]['target_gp'] == 3600000

    # 先の月は、必要数も実数も0。月が違えば目標も違う
    future = api('/sales-board?month=2099-01')[1]
    assert future['workdays_elapsed'] == 0 and all(x['need_gp'] == 0 and x['act_gp'] == 0 for x in future['rows'])
    assert api('/sales-board?month=2026-3')[0] == 400

    # 一般の営業は自分の行だけ（所属の小計も自分だけの数）
    client.sql("UPDATE users SET role = 'general' WHERE username = 'owner'")
    try:
        own = api('/sales-board?month=2026-03')[1]['rows']
        assert [x['name'] for x in own if x['kind'] == 'member'] == [client.sql("SELECT display_name FROM users WHERE username = 'owner'")[0]['display_name']]
        assert own[-1]['target_gp'] == 100000
    finally:
        client.sql("UPDATE users SET role = 'owner' WHERE username = 'owner'")
