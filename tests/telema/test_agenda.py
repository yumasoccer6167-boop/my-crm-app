"""カレンダー（予定の自動表示・稼働日の設定・訪問の時間帯の再コール禁止）と日報の自動作成。他のテストと重ならない先の月（2027-03）を使う"""
from datetime import datetime

from telema.analytics import is_workday, workdays


def make_company(client, name):
    return client.sql('INSERT INTO telema_companies (company_name, company_name_normalized) VALUES (%s, %s) RETURNING id', (name, name))[0]['id']


def me(client):
    return client.sql("SELECT id FROM users WHERE username = 'owner'")[0]['id']


def test_カレンダーに記録の予定が種類ごとに出る(client):
    p = {r['name']: r['id'] for r in client.api('/visit-purposes')[1]}
    a, b, c, d, e, f = (make_company(client, f'予定園{x}') for x in 'ABCDEF')
    call = lambda cid, **kw: client.api(f'/companies/{cid}/calls', {'raw_note': 'x', **kw})
    visit = lambda cid, **kw: client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': 'x', **kw})
    # 初回訪問予定＝結果「初回訪問時間設定」の訪問日時。営業予定＝結果「時間設定」の訪問日時と、初回訪問の「営業時間設定」の営業の日時
    assert call(a, result_status_id=client.status_id('時間設定成立'), visit_at='2027-03-10T01:00:00Z', precheck_at='2027-03-09T06:00:00Z')[0] == 201
    assert call(f, result_status_id=client.status_id('初回訪問時間設定'), visit_at='2027-03-11T02:00:00Z')[0] == 201
    assert visit(b, visit_purpose_id=p['初回訪問'], first_result='scheduled', first_followup_at='2027-03-12T05:00:00Z')[0] == 201
    waiting = visit(c, visit_purpose_id=p['営業'], sales_result='waiting', sales_followup_at='2027-03-15T01:00:00Z')[1]
    assert visit(d, visit_purpose_id=p['営業'], sales_result='resales', sales_followup_at='2027-03-16T01:00:00Z')[0] == 201
    client.sql('UPDATE telema_companies SET assigned_user_id = %s WHERE id = %s', (me(client), e))
    assert call(e, next_call_at='2027-03-20T06:00:00Z', next_action='資料送付の確認')[0] == 201          # 再コールはカレンダーに出ない

    status, cal = client.api('/calendar?month=2027-03')
    assert status == 200 and cal['user_id'] == me(client)
    got = {(i['kind'], i['company_name']): i for i in cal['items']}
    assert set(got) == {('visit', '予定園A'), ('precheck', '予定園A'), ('first_visit', '予定園F'), ('visit', '予定園B'), ('followup', '予定園C'), ('followup', '予定園D')}
    assert got[('first_visit', '予定園F')]['label'] == '初回訪問予定' and got[('visit', '予定園A')]['label'] == '営業予定'
    assert got[('visit', '予定園A')]['detail'] == '時間設定' and got[('visit', '予定園B')]['detail'] == '営業時間設定'
    assert got[('followup', '予定園C')]['detail'] == '返事待ち' and got[('followup', '予定園D')]['detail'] == '再営業'
    assert [i['at'] for i in cal['items']] == sorted(i['at'] for i in cal['items'])
    # 返事待ちに対応したら、その営業フォローは出ない。月が違えば出ない
    assert client.api(f'/companies/{c}/calls', {'record_type': 'reply', 'raw_note': '返事', 'sales_result': 'ng', 'reply_to_id': waiting['id']})[0] == 201
    assert ('followup', '予定園C') not in {(i['kind'], i['company_name']) for i in client.api('/calendar?month=2027-03')[1]['items']}
    assert not [i for i in client.api('/calendar?month=2027-04')[1]['items'] if i['company_name'].startswith('予定園')]
    assert client.api('/calendar?month=2027-13')[0] == 400
    # 訪問日時は「時間設定」「初回訪問時間設定」だけに付けられる
    assert call(a, result_status_id=client.status_id('再コール'), visit_at='2027-03-11T02:00:00Z')[0] == 400


def test_稼働日は日ごとに設定でき_設定のない日は平日(client):
    mid = me(client)
    days = {x['day']: x for x in client.api('/calendar?month=2027-03')[1]['days']}
    assert len(days) == 31 and days['2027-03-01']['is_workday'] and not days['2027-03-06']['is_workday'] and not days['2027-03-01']['custom']       # 2027-03-01 は月曜
    assert client.api(f'/workdays/{mid}/2027-03-06', {'is_workday': True}, method='PUT')[1] == {'user_id': mid, 'day': '2027-03-06', 'is_workday': True, 'custom': True}
    assert client.api(f'/workdays/{mid}/2027-03-03', {'is_workday': False}, method='PUT')[0] == 200
    days = {x['day']: x for x in client.api('/calendar?month=2027-03')[1]['days']}
    assert days['2027-03-06']['is_workday'] and days['2027-03-06']['custom'] and not days['2027-03-03']['is_workday']
    # 設定を外すと平日に戻る
    assert client.api(f'/workdays/{mid}/2027-03-03', {'is_workday': None}, method='PUT')[1]['is_workday'] is True
    assert client.api(f'/workdays/{mid}/2027-03-3', {'is_workday': True}, method='PUT')[0] == 400
    assert client.api(f'/workdays/{mid}/2027-03-03', {'is_workday': 'yes'}, method='PUT')[0] == 400
    # 関数にも効く
    over = {datetime(2027, 3, 3).date(): False}
    assert not is_workday(datetime(2027, 3, 3).date(), over) and workdays(datetime(2027, 3, 1).date(), datetime(2027, 3, 5).date(), over) == 4
    # 管理者は誰の分も、それ以外は自分の分だけ
    other = client.add_user('稼働日の別の営業', 'sales')
    assert client.api(f'/workdays/{other}/2027-03-08', {'is_workday': False}, method='PUT')[0] == 200
    client.set_my_role('manager')
    try:
        assert client.api(f'/workdays/{other}/2027-03-09', {'is_workday': False}, method='PUT')[0] == 403
        assert client.api(f'/workdays/{mid}/2027-03-09', {'is_workday': False}, method='PUT')[0] == 200
        theirs = {x['day']: x for x in client.api(f'/calendar?month=2027-03&user_id={other}')[1]['days']}
        assert not theirs['2027-03-08']['is_workday'] and theirs['2027-03-09']['is_workday']
        assert client.api('/calendar?month=2027-03&user_id=all')[1]['days'] == []                         # 全員分は稼働日を持たない
    finally:
        client.set_my_role('admin')
    client.set_my_role('sales')
    try:
        assert client.api(f'/calendar?month=2027-03&user_id={other}')[1]['user_id'] == mid               # 営業は自分の分だけ
    finally:
        client.set_my_role('admin')


def test_稼働日の設定が今週のペースの残り稼働日に効く(client):
    from datetime import timedelta, timezone
    jst = timezone(timedelta(hours=9))
    today = datetime.now(timezone.utc).astimezone(jst).date()
    month_end = (today.replace(day=1) + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    sid = client.add_user('稼働日ペースの営業', 'sales')
    before = client.api(f'/analytics/pace?user_id={sid}')[1]['month_workdays_left']
    d = today
    while d <= month_end:                                                                             # 今日以降を全部休みにする
        client.api(f'/workdays/{sid}/{d.isoformat()}', {'is_workday': False}, method='PUT')
        d += timedelta(days=1)
    r = client.api(f'/analytics/pace?user_id={sid}')[1]
    assert before == workdays(today, month_end) and r['month_workdays_left'] == 0 and r['week_workdays_left'] == 0


def test_訪問の時間帯には再コールを入れられない(client):
    p = {r['name']: r['id'] for r in client.api('/visit-purposes')[1]}
    a, b, c = make_company(client, '時間帯園A'), make_company(client, '時間帯園B'), make_company(client, '時間帯園C')
    assert client.api(f'/companies/{a}/calls', {'raw_note': 'x', 'result_status_id': client.status_id('時間設定成立'), 'visit_at': '2027-04-05T01:00:00Z'})[0] == 201       # 10:00〜11:00 JST
    recall = lambda cid, at: client.api(f'/companies/{cid}/calls', {'raw_note': '再コール', 'next_call_at': at})
    status, err = recall(b, '2027-04-05T01:30:00Z')
    assert status == 400 and '10:00' in err['error']['message']
    assert recall(b, '2027-04-05T01:00:00Z')[0] == 400                                                   # 開始ちょうども不可
    assert recall(b, '2027-04-05T02:00:00Z')[0] == 201                                                   # 11:00 は時間帯の外
    assert recall(c, '2027-04-05T00:59:00Z')[0] == 201
    # 施設の次回架電を直接直す・架電の記録を直すときも同じ
    assert client.api(f'/companies/{b}', {'next_call_at': '2027-04-05T01:15:00Z'}, method='PATCH')[0] == 400
    row = recall(c, '2027-04-06T01:00:00Z')[1]
    assert client.api(f'/calls/{row["id"]}', {'next_call_at': '2027-04-05T01:45:00Z'}, method='PATCH')[0] == 400
    assert client.api(f'/calls/{row["id"]}', {'next_call_at': '2027-04-05T03:00:00Z'}, method='PATCH')[0] == 200
    # 営業の訪問（返事待ち・営業時間設定）の日時も訪問の時間帯。別の営業の訪問は関係ない
    assert client.api(f'/companies/{a}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': 'x', 'visit_purpose_id': p['営業'], 'sales_result': 'waiting', 'sales_followup_at': '2027-04-07T05:00:00Z'})[0] == 201
    assert recall(b, '2027-04-07T05:30:00Z')[0] == 400
    other = client.add_user('時間帯の別の営業', 'sales')
    client.sql('UPDATE telema_companies SET assigned_user_id = %s WHERE id = %s', (other, c))
    assert recall(c, '2027-04-07T05:30:00Z')[0] == 201                                                   # c の担当は other で、その訪問は a のみ（me の訪問）。other の時間帯ではない
