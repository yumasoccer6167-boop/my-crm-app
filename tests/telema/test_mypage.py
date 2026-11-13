"""マイページ1ページ（数字の自己認識）。今日を 2026-03-11（水）に固定して、その週・月の目標と実績を見る（2026年3月の稼働日は22日、週は 3/9〜3/15 で稼働日5日）"""
from datetime import date

import pytest

from telema import mypage

TODAY = date(2026, 3, 11)


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr(mypage, '_today', lambda: TODAY)


def make_company(client, name):
    return client.sql('INSERT INTO telema_companies (company_name, company_name_normalized) VALUES (%s, %s) RETURNING id', (name, name))[0]['id']


def me(client):
    return client.sql("SELECT id FROM users WHERE username = 'owner'")[0]['id']


def test_今日のコミットは自分の分だけ保存でき_定量と定性を持つ(client):
    api = client.api
    assert api('/mypage')[1]['commit'] is None
    status, r = api('/mypage/commit', {'commit_gp': 300000, 'commit_units': 3, 'commit_deals': 4, 'comment': '午前に2件訪問、午後は返事待ちの対応'}, method='PUT')
    assert status == 200 and r['day'] == '2026-03-11'
    got = api('/mypage')[1]['commit']
    assert (got['commit_gp'], got['commit_units'], got['commit_deals'], got['comment']) == (300000, 3, 4, '午前に2件訪問、午後は返事待ちの対応')
    # 送らなかった項目は今のまま。空にするときは null / 空文字
    assert api('/mypage/commit', {'commit_units': 5, 'comment': ''}, method='PUT')[0] == 200
    got = api('/mypage')[1]['commit']
    assert (got['commit_gp'], got['commit_units'], got['commit_deals'], got['comment']) == (300000, 5, 4, None)
    assert api('/mypage/commit', {'commit_gp': -1}, method='PUT')[0] == 400
    # 別の日のコミットは混ざらない
    client.sql("INSERT INTO telema_daily_commits (user_id, day, commit_gp) VALUES (%s, '2026-03-10', 1)", (me(client),))
    assert api('/mypage')[1]['commit']['commit_gp'] == 300000


def test_不足数と週間_月間の目標に対する実績(client):
    api = client.api
    owner = me(client)
    purposes = {r['name']: r['id'] for r in api('/visit-purposes')[1]}
    # 目標（3月）：粗利220P・台数22・商談数44・初回訪問22・時間設定66・スケジューリング44
    assert api(f'/targets/{owner}/2026-03', {'gross_profit': 2_200_000, 'units': 22, 'deals': 44, 'first_visits': 22, 'scheduled': 66, 'scheduling': 44}, method='PUT')[0] == 200
    # 商談数などを送らない保存は、今の値を変えない
    assert api(f'/targets/{owner}/2026-03', {'gross_profit': 2_200_000, 'units': 22}, method='PUT')[1]['deals'] == 44
    co = make_company(client, 'マイページ園')
    contract = lambda day, gp, units: api(f'/companies/{co}/contracts', {'product_name': 'SPマイ', 'contract_date': day, 'assigned_user_id': owner, 'gross_profit': gp, 'units': units})
    assert contract('2026-03-10', 700_000, 7)[0] == 201
    assert contract('2026-03-11', 50_000, 1)[0] == 201
    assert contract('2026-02-27', 999_000, 9)[0] == 201                                        # 先月の分は入らない
    visit = lambda purpose, at, **kw: api(f'/companies/{co}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': 'x', 'visit_purpose_id': purposes[purpose], 'called_at': at, **kw})
    for at in ('2026-03-09T01:00:00Z', '2026-03-09T02:00:00Z', '2026-03-10T01:00:00Z'):         # 今日より前の商談3件
        assert visit('営業', at)[0] == 201
    assert visit('営業', '2026-03-11T01:00:00Z')[0] == 201                                      # 今日の商談1件
    assert visit('初回訪問', '2026-03-09T03:00:00Z', first_result='scheduled')[0] == 201 and visit('初回訪問', '2026-03-11T03:00:00Z')[0] == 201     # 初回訪問2件のうち、時間設定は1件
    assert visit('営業', '2026-03-16T01:00:00Z')[0] == 201                                      # 来週の分は今週に入らない（今日より先）
    for status, at in (('初回訪問時間設定', '2026-03-09T05:00:00Z'), ('時間設定成立', '2026-03-10T05:00:00Z')):
        assert api(f'/companies/{co}/calls', {'raw_note': 'x', 'called_at': at, 'result_status_id': client.status_id(status)})[0] == 201

    status, r = api('/mypage')
    assert status == 200 and r['today'] == '2026-03-11' and r['today_workday'] is True and r['workdays_left'] == 15
    assert r['role'] == 'admin' and r['team_name'] == '全体'
    # 不足数：今月のコミット（＝月間目標）に対して。今日は（目標 − 今日より前の実績）÷ 残り稼働日15（今日を含む）。粗利は万円単位に切り上げ
    sh = r['shortage']
    assert set(sh) == {'gross_profit', 'units', 'deals', 'scheduled', 'first_visits', 'scheduling'}
    gp = sh['gross_profit']
    assert gp['month'] == {'target': 2_200_000, 'actual': 750_000, 'short': 1_450_000}
    assert gp['week'] == {'target': 500_000, 'actual': 750_000, 'short': 0}                      # 今週はもう達成。0未満は0
    assert gp['today'] == {'need': 100_000, 'done': 50_000, 'short': 50_000}                    # (220万 − 70万) ÷ 15 = 10万
    assert sh['units']['today'] == {'need': 1, 'done': 1, 'short': 0} and sh['units']['month']['short'] == 14        # (22 − 7) ÷ 15 = 1
    assert sh['deals']['today'] == {'need': 3, 'done': 1, 'short': 2}                           # (44 − 3) ÷ 15 = 2.73 → 3。来週（3/16）の1件は、実績に入らない
    assert sh['deals']['week'] == {'target': 10, 'actual': 4, 'short': 6} and sh['deals']['month']['short'] == 40
    assert sh['first_visits']['today'] == {'need': 2, 'done': 1, 'short': 1}                    # (22 − 1) ÷ 15 = 1.4 → 2
    assert sh['scheduled']['month'] == {'target': 66, 'actual': 1, 'short': 65} and sh['scheduled']['today'] == {'need': 5, 'done': 0, 'short': 5}
    assert sh['scheduling']['month'] == {'target': 44, 'actual': 1, 'short': 43} and sh['scheduling']['today'] == {'need': 3, 'done': 0, 'short': 3}
    # 週間（3/9〜3/15）の目標 = 月間 × 5/22。実績は今日まで
    wk = r['week']['personal']
    assert (r['week']['from'], r['week']['to']) == ('2026-03-09', '2026-03-15')
    assert wk['gross_profit'] == {'target': 500_000, 'actual': 750_000}
    assert wk['units'] == {'target': 5, 'actual': 8}
    assert wk['deals'] == {'target': 10, 'actual': 4}
    assert wk['first_visits'] == {'target': 5, 'actual': 2}
    assert wk['scheduled'] == {'target': 15, 'actual': 1}                                       # 時間設定件数 = 架電の結果が時間設定成立（アポ獲得）
    assert wk['scheduling'] == {'target': 10, 'actual': 1}                                      # スケジューリング数 = 架電の結果が初回訪問時間設定
    assert wk['scheduled_first'] == 1                                                           # 初回訪問時間設定件数 = 初回訪問の結果が営業時間設定（別の項目）
    # 月間の目標と実績
    mo = r['month']['personal']
    assert r['month']['month'] == '2026-03'
    assert mo['gross_profit'] == {'target': 2_200_000, 'actual': 750_000}
    assert mo['deals'] == {'target': 44, 'actual': 4} and mo['scheduled'] == {'target': 66, 'actual': 1} and mo['scheduled_first'] == 1 and mo['scheduling'] == {'target': 44, 'actual': 1}


def test_目標が0の項目は不足数を出さない(client):
    client.sql("UPDATE users SET role = 'general' WHERE username = 'owner'")
    try:
        client.sql('DELETE FROM telema_targets WHERE user_id = %s', (me(client),))
        r = client.api('/mypage')[1]
        assert r['shortage'] == dict.fromkeys(('gross_profit', 'units', 'deals', 'scheduled', 'first_visits', 'scheduling'))
        assert r['week']['personal']['gross_profit'] == {'target': 0, 'actual': 750_000}
        assert 'team' not in r['week'] and r['team_name'] is None                             # 一般は個人だけ
    finally:
        client.sql("UPDATE users SET role = 'owner' WHERE username = 'owner'")


def test_マネージャー以上はチーム_所属の部署と配下の全員_も出る(client):
    api = client.api
    owner = me(client)
    a, b, c = (client.add_user(n) for n in ('チームA', 'チームB', '他部署C'))
    biz = api('/org/departments', {'name': 'マイページ事業部'})[1]['id']
    team = api('/org/departments', {'name': 'マイページ一課', 'parent_id': biz})[1]['id']
    other = api('/org/departments', {'name': 'マイページ二課'})[1]['id']
    for u, dpt in ((owner, biz), (a, team), (b, team), (c, other)):
        assert api('/org/assignments', {'user_id': u, 'department_id': dpt, 'effective_date': '2025-01-01'})[0] == 201
    for u, gp in ((owner, 2_200_000), (a, 1_100_000), (b, 2_200_000), (c, 4_400_000)):
        assert api(f'/targets/{u}/2026-03', {'gross_profit': gp, 'units': 11}, method='PUT')[0] == 200
    co = make_company(client, 'チーム園')
    for u, gp in ((a, 100_000), (b, 200_000), (c, 900_000)):
        assert api(f'/companies/{co}/contracts', {'product_name': 'SPチーム', 'contract_date': '2026-03-10', 'assigned_user_id': u, 'gross_profit': gp, 'units': 1})[0] == 201

    r = api('/mypage')[1]
    assert r['team_name'] == 'マイページ事業部' and r['team_size'] == 4 - 1                      # 自分・A・B（他部署のCは入らない）
    # チーム＝自分 + A + B：目標 220万 + 110万 + 220万。月間実績 = A・Bの契約と、自分の分（前のテストで入れた契約）
    team_gp = r['month']['team']['gross_profit']
    assert team_gp['target'] == 5_500_000 and team_gp['actual'] == r['month']['personal']['gross_profit']['actual'] + 300_000
    assert r['week']['team']['gross_profit']['target'] == 1_250_000                           # 550万 × 5/22
    assert r['month']['personal']['gross_profit']['target'] == 2_200_000                      # 個人は自分の分だけ

    # マネージャーで所属がない人は、自分だけがチーム
    client.sql("UPDATE users SET role = 'mgr' WHERE username = 'owner'")
    client.sql('DELETE FROM telema_org_assignments WHERE user_id = %s', (owner,))
    try:
        r = api('/mypage')[1]
        assert r['team_name'] == '自分のみ' and r['team_size'] == 1
        assert r['month']['team']['gross_profit'] == r['month']['personal']['gross_profit']
    finally:
        client.sql("UPDATE users SET role = 'owner' WHERE username = 'owner'")


def test_翌週の予定は自分で入れ_翌週の目標に対する達成率として出る(client):
    api = client.api
    owner = me(client)
    assert api(f'/targets/{owner}/2026-03', {'gross_profit': 2_200_000, 'units': 22, 'deals': 44, 'first_visits': 22, 'scheduled': 66, 'scheduling': 44}, method='PUT')[0] == 200
    r = api('/mypage')[1]['next_week']
    # 今日は 3/11（水）→ 翌週は 3/16〜3/22（稼働日5日）。目標 = 月間 × 5/22。予定は未入力
    assert (r['from'], r['to']) == ('2026-03-16', '2026-03-22')
    assert r['personal']['gross_profit'] == {'target': 500_000, 'actual': 0} and r['personal']['deals'] == {'target': 10, 'actual': 0}
    assert r['plan'] == dict.fromkeys(('gross_profit', 'units', 'deals', 'first_visits', 'scheduled_first', 'scheduled', 'scheduling'))
    plan = {'gross_profit': 300_000, 'units': 3, 'deals': 6, 'first_visits': 4, 'scheduled_first': 2, 'scheduled': 5, 'scheduling': 7}
    assert api('/mypage/next-week', plan, method='PUT')[0] == 200
    r = api('/mypage')[1]['next_week']
    assert r['personal']['gross_profit'] == {'target': 500_000, 'actual': 300_000} and r['personal']['scheduled'] == {'target': 15, 'actual': 5}
    assert r['personal']['scheduling'] == {'target': 10, 'actual': 7}
    assert (r['personal']['first_visits']['actual'], r['personal']['scheduled_first']) == (4, 2) and r['plan'] == plan
    # 送らなかった項目は今のまま。空にするときは null
    assert api('/mypage/next-week', {'units': 4, 'deals': None}, method='PUT')[0] == 200
    got = api('/mypage')[1]['next_week']['plan']
    assert (got['units'], got['deals'], got['gross_profit']) == (4, None, 300_000)
    assert api('/mypage/next-week', {'units': -1}, method='PUT')[0] == 400
    # チームは全員の予定の合計（別の週の予定は入らない）
    other = client.add_user('翌週の予定の別の営業', 'sales')
    client.sql("INSERT INTO telema_week_plans (user_id, week_start, gross_profit, units) VALUES (%s, '2026-03-16', 100000, 1)", (other,))
    client.sql("INSERT INTO telema_week_plans (user_id, week_start, gross_profit) VALUES (%s, '2026-03-09', 999999)", (other,))       # 別の週は入らない
    team = api('/mypage')[1]['next_week']['team']
    assert (team['gross_profit']['actual'], team['units']['actual']) == (400_000, 5)
