"""マイページ2ページ（自己分析）。自己クローズ（営業担当が自分）と自己ユーザー（営業担当か台数担当が自分）。今日を 2026-03-15 に固定する"""
from datetime import date

import pytest

from telema import mypage


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr(mypage, '_today', lambda: date(2026, 3, 15))


def make_company(client, name, industry=None):
    return client.sql('INSERT INTO telema_companies (company_name, company_name_normalized, industry) VALUES (%s, %s, %s) RETURNING id', (name, name, industry))[0]['id']


def test_自己クローズと自己ユーザーで切り替えて集計する(client):
    api = client.api
    owner = client.sql("SELECT id FROM users WHERE username = 'owner'")[0]['id']
    other = client.add_user('別の営業')
    a, b, c, e = (make_company(client, n, i) for n, i in (('保育園A', '保育園'), ('幼稚園B', '幼稚園'), ('業種なしC', None), ('他人園E', '保育園')))
    contract = lambda co, product, day, **kw: api(f'/companies/{co}/contracts', {'product_name': product, 'contract_date': day, **kw})
    # A：同じ日（1/10）に2件 → 1契約。台数は 2 + 1
    assert contract(a, 'Site', '2026-01-10', assigned_user_id=owner, gross_profit=100_000, units=2)[0] == 201
    assert contract(a, 'Movie', '2026-01-10', assigned_user_id=owner, gross_profit=50_000, units=1)[0] == 201
    # B：営業担当は別の人、台数担当が自分
    status, row = contract(b, 'Site', '2026-02-05', assigned_user_id=other, units_user_id=owner, gross_profit=300_000, units=4)
    assert status == 201 and row['units_user_id'] == owner and row['units_user_name'] and row['assigned_user_name'] == '別の営業'
    # C：粗利・台数が未入力の契約（平均には入れない）
    assert contract(c, 'Site', '2026-02-20', assigned_user_id=owner)[0] == 201
    # E：自分は関係ない
    assert contract(e, 'Site', '2026-02-21', assigned_user_id=other, gross_profit=900_000, units=9)[0] == 201
    assert contract(a, 'Site', '2026-02-22', assigned_user_id=owner, units_user_id=999999)[0] == 400          # 台数担当が実在しない

    status, r = api('/mypage/analysis?scope=closed')
    assert status == 200 and r['scope'] == 'closed'
    s = r['summary']
    assert (s['orders'], s['deals'], s['gross_profit'], s['units'], s['months']) == (3, 2, 150_000, 3, 3)          # 1〜3月（今月まで）
    assert s['avg_gross_profit'] == 75_000                                                                       # 粗利のある2件の平均
    assert s['units_per_deal'] == 3                                                                              # 台数のある契約（A の1契約＝3台）だけで割る
    assert s['monthly_gross_profit'] == 50_000 and s['monthly_units'] == 1
    assert [(p['name'], p['orders'], p['avg_gross_profit']) for p in r['products']] == [('Site', 2, 100_000), ('Movie', 1, 50_000)]
    assert r['industries'] == [{'name': '保育園', 'orders': 2}, {'name': '未設定', 'orders': 1}]
    assert [(m['month'], m['orders'], m['gross_profit'], m['units']) for m in r['months']] == [('2026-01', 2, 150_000, 3), ('2026-02', 1, 0, 0), ('2026-03', 0, 0, 0)]

    r = api('/mypage/analysis?scope=user')[1]
    s = r['summary']
    assert (s['orders'], s['deals'], s['gross_profit'], s['units']) == (4, 3, 450_000, 7)                        # 営業担当 または 台数担当が自分
    assert s['avg_gross_profit'] == 150_000 and s['units_per_deal'] == 3.5
    assert s['monthly_gross_profit'] == 150_000 and round(s['monthly_units'], 2) == round(7 / 3, 2)
    assert {i['name']: i['orders'] for i in r['industries']} == {'保育園': 2, '幼稚園': 1, '未設定': 1}

    assert api('/mypage/analysis?scope=all')[0] == 400
    assert api('/mypage/analysis')[1]['scope'] == 'closed'                                                       # 省略は自己クローズ


def test_契約がまだない人は空の集計を返す(client):
    client.sql('UPDATE telema_contracts SET is_active = 0')
    r = client.api('/mypage/analysis?scope=user')[1]
    assert r['summary']['orders'] == 0 and r['summary']['months'] == 0 and r['summary']['avg_gross_profit'] is None
    assert r['summary']['units_per_deal'] is None and r['summary']['monthly_gross_profit'] is None
    assert r['products'] == [] and r['industries'] == [] and r['months'] == []
