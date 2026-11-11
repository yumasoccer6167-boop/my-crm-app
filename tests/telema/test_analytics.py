"""数値分析：目標・ペース（今週の必要粗利・必要訪問件数）と、期間の実績。期間は他のテストと重ならない過去の月を使う"""
from datetime import datetime, timedelta, timezone

from telema.analytics import is_workday, workdays

Q = 'date_from=2025-08-01&date_to=2025-08-31'


def make_company(client, name, org=None):
    return client.sql('INSERT INTO telema_companies (company_name, company_name_normalized, organization_id) VALUES (%s, %s, %s) RETURNING id', (name, name, org))[0]['id']


def test_稼働日はいまは平日(client):
    assert [is_workday(datetime(2026, 11, d).date()) for d in range(2, 9)] == [True] * 5 + [False] * 2         # 2026-11-02 は月曜
    assert workdays(datetime(2026, 11, 2).date(), datetime(2026, 11, 30).date()) == 21


def test_目標は管理者が誰の分も_それ以外は自分の分だけ設定できる(client):
    other = client.add_user('目標の別の営業', 'sales')
    assert client.api(f'/targets/{other}/2025-08', {'gross_profit': 1_000_000, 'units': 10}, method='PUT')[0] == 200      # 管理者
    mine = client.sql("SELECT id FROM users WHERE username = 'owner'")[0]['id']
    assert client.api(f'/targets/{mine}/2025-08', {'gross_profit': 500_000, 'units': 5}, method='PUT')[0] == 200
    items = {i['user_id']: i for i in client.api('/targets?month=2025-08')[1]['items']}
    assert (items[other]['gross_profit'], items[mine]['units']) == (1_000_000, 5)
    assert client.api(f'/targets/{mine}/2025-13', {'gross_profit': 1, 'units': 1}, method='PUT')[0] == 400
    assert client.api(f'/targets/{mine}/2025-08', {'gross_profit': -1, 'units': 1}, method='PUT')[0] == 400
    client.set_my_role('sales')
    try:
        assert client.api(f'/targets/{other}/2025-08', {'gross_profit': 1, 'units': 1}, method='PUT')[0] == 403
        assert client.api(f'/targets/{mine}/2025-08', {'gross_profit': 700_000, 'units': 7}, method='PUT')[0] == 200
        assert [i['user_id'] for i in client.api('/targets?month=2025-08')[1]['items']] == [mine]            # 一般は自分の分だけ見える
    finally:
        client.set_my_role('admin')


def test_期間の実績は訪問_受注_単価_商材別の粗利_テレアポを数える(client):
    p = {r['name']: r['id'] for r in client.api('/visit-purposes')[1]}
    org = client.sql("INSERT INTO telema_organizations (name, name_normalized) VALUES ('分析法人', '分析法人') RETURNING id")[0]['id']
    a, b, c = make_company(client, '分析園A', org), make_company(client, '分析園B', org), make_company(client, '分析園C')
    visit = lambda cid, purpose, at, **kw: client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': 'x', 'visit_purpose_id': p[purpose], 'called_at': at, **kw})[0]
    assert [visit(a, '初回訪問', '2025-08-02T01:00:00Z'), visit(a, 'ユーザー訪問', '2025-08-03T01:00:00Z'),
            visit(a, '営業', '2025-08-04T01:00:00Z', sales_result='ng'), visit(b, '営業', '2025-08-05T01:00:00Z', sales_result='waiting'),
            visit(b, '営業', '2025-08-06T01:00:00Z', sales_result='won', sales_product='SP', sales_amount=400000, sales_gross_profit=120000, sales_units=2)] == [201] * 5
    # 契約：同じ法人の2施設＋別の法人の1施設。台数・金額・粗利あり／なしを混ぜる
    client.api(f'/companies/{c}/contracts', {'product_name': 'SP-MEO', 'contract_date': '2025-08-10', 'amount': 300000, 'gross_profit': 90000, 'units': 1})
    client.api(f'/companies/{c}/contracts', {'product_name': 'SP-MEO', 'contract_date': '2025-08-11', 'gross_profit': 30000})     # 金額・台数なし
    # テレアポ：架電
    contact_rep = client.api(f'/companies/{a}/contacts', {'name': '代表者', 'role': '園長', 'is_decision_maker': True})[1]['id']
    contact_staff = client.api(f'/companies/{a}/contacts', {'name': '担当者', 'role': '事務'})[1]['id']
    status = lambda cat: client.sql('SELECT id FROM telema_call_statuses WHERE category = %s ORDER BY id LIMIT 1', (cat,))[0]['id']
    scheduling = client.sql("SELECT id FROM telema_call_statuses WHERE label = '初回訪問時間設定'")[0]['id']
    call = lambda **kw: client.api(f'/companies/{a}/calls', {'raw_note': 'x', 'called_at': '2025-08-12T01:00:00Z', **kw})[0]
    assert [call(contact_id=contact_rep, result_status_id=scheduling), call(contact_id=contact_staff, result_status_id=status('appointment')),
            call(result_status_id=status('in_progress')), call(result_status_id=status('lost'))] == [201] * 4         # 進行中の区分でも、初回訪問時間設定でなければスケジューリングに数えない

    status_code, body = client.api(f'/analytics?{Q}')
    assert status_code == 200
    v = body['visits']
    assert {k: v[k] for k in ('first_visits', 'user_visits', 'sales_visits', 'won', 'waiting', 'ng', 'resales')} == {'first_visits': 1, 'user_visits': 1, 'sales_visits': 3, 'won': 1, 'waiting': 1, 'ng': 1, 'resales': 0}
    assert abs(v['fall_rate'] - 1 / 3) < 1e-9                                                           # 営業落ち率＝NG ÷ 営業件数
    o = body['orders']
    # 契約：訪問から自動登録された1件（8/6・金額40万・粗利12万・2台）＋手入力の2件
    assert (o['orders'], o['amount'], o['gross_profit'], o['units']) == (3, 700000, 240000, 3)
    assert o['unit_price'] == 700000 / 3                                                                # 1台あたり受注単価＝金額 ÷ 台数（金額のある契約）
    assert o['corporation_price'] == 700000 / 2                                                         # 1法人あたり＝金額 ÷ 金額のある契約の法人数（同じ法人の施設は1法人）
    prod = {r['product_name']: r for r in body['products']}
    assert (prod['SP']['avg_gross_profit'], prod['SP-MEO']['avg_gross_profit'], prod['SP-MEO']['orders']) == (120000, 60000, 2)
    assert 'teleappt' not in body                                                                       # テレアポの集計は別ページ（/teleappt）
    assert client.api('/analytics?date_from=2025-08-31&date_to=2025-08-01')[0] == 400
    # 期間外・別の担当者で絞ると 0
    assert client.api('/analytics?date_from=2025-09-01&date_to=2025-09-30')[1]['visits']['sales_visits'] == 0
    other = client.add_user('分析の別の営業', 'sales')
    assert client.api(f'/analytics?{Q}&user_id={other}')[1]['visits']['sales_visits'] == 0


def test_ペースは月の残を残り稼働日で割り_直近の実績から必要な訪問件数に直す(client):
    mine = client.sql("SELECT id FROM users WHERE username = 'owner'")[0]['id']
    today = datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=9))).date()
    month = today.strftime('%Y-%m')
    client.api(f'/targets/{mine}/{month}', {'gross_profit': 0, 'units': 0}, method='PUT')
    first = client.api('/analytics/pace')[1]
    assert first['target'] == {'gross_profit': 0, 'units': 0, 'deals': 0, 'first_visits': 0, 'scheduled': 0} and first['week_need'] == {'gross_profit': 0, 'units': 0}
    # 目標を置くと、月の残と今週の必要粗利が出る。直近90日に訪問と受注の実績が無ければ、必要訪問件数は出さない
    client.api(f'/targets/{mine}/{month}', {'gross_profit': 3_000_000, 'units': 30}, method='PUT')
    r = client.api('/analytics/pace')[1]
    got = r['month_actual']['gross_profit']
    assert r['month_remaining']['gross_profit'] == 3_000_000 - got and r['week_need']['gross_profit'] <= r['month_remaining']['gross_profit']
    if r['basis']['visits'] == 0 or r['basis']['gross_profit'] == 0:
        assert r['week_visits_need'] is None and r['today_visits_need'] is None
    assert client.api('/analytics/pace?user_id=all')[0] == 400                                          # ペースは営業を1人選ぶ


def test_ペースの計算(client):
    """月目標300万円・30台、今月の受注60万円・6台、直近の訪問10件 → 1訪問あたり粗利6万円で必要訪問件数を割り戻す"""
    from math import ceil
    jst = timezone(timedelta(hours=9))
    today = datetime.now(timezone.utc).astimezone(jst).date()
    month = today.strftime('%Y-%m')
    sid = client.add_user('ペースの営業', 'sales')
    client.api(f'/targets/{sid}/{month}', {'gross_profit': 3_000_000, 'units': 30}, method='PUT')
    cid = make_company(client, 'ペース園')
    ct = client.api(f'/companies/{cid}/contracts', {'product_name': 'SP', 'contract_date': today.isoformat(), 'gross_profit': 600_000, 'units': 6, 'assigned_user_id': sid})[1]
    assert ct['assigned_user_id'] == sid
    purpose = {r['name']: r['id'] for r in client.api('/visit-purposes')[1]}['初回訪問']
    ago = (datetime.now(timezone.utc) - timedelta(days=10)).strftime('%Y-%m-%dT%H:%M:%SZ')
    for _ in range(10):
        row = client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': 'x', 'visit_purpose_id': purpose, 'called_at': ago})[1]
        client.api(f'/calls/{row["id"]}', {'user_id': sid}, method='PATCH')

    r = client.api(f'/analytics/pace?user_id={sid}')[1]
    month_end = (today.replace(day=1) + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    week_end = min(today + timedelta(days=6 - today.weekday()), month_end)
    month_days, week_days = workdays(today, month_end), workdays(today, week_end)
    assert (r['month_actual']['gross_profit'], r['month_actual']['units']) == (600_000, 6)
    assert r['month_remaining'] == {'gross_profit': 2_400_000, 'units': 24}
    share = week_days / month_days if month_days else 1
    assert r['week_need'] == {'gross_profit': ceil(2_400_000 * share), 'units': ceil(24 * share)}
    assert r['basis']['visits'] == 10 and r['basis']['gross_profit_per_visit'] == 60_000
    need = ceil(r['week_need']['gross_profit'] / 60_000)
    assert r['week_visits_need'] == need
    assert r['today_visits_need'] == (ceil(need / week_days) if week_days else need) and r['today_visits_left'] == r['today_visits_need']
