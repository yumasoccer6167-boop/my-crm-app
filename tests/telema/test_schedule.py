"""マイページの「今日の予定」（訪問予定・訪問前連絡予定・再コール）と、対応済み。"""
from datetime import datetime, timedelta, timezone

JST = timezone(timedelta(hours=9))


def at(days=0, hour=10):
    """日本時間の「今日 + days 日」の hour 時（UTCのISO文字列）"""
    j = datetime.now(JST)
    t = datetime(j.year, j.month, j.day, hour, 0, tzinfo=JST) + timedelta(days=days)
    return t.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')


def make_company(client, name, assigned=None, next_call=None):
    return client.sql(
        'INSERT INTO telema_companies (company_name, company_name_normalized, assigned_user_id, next_call_at, next_action) VALUES (%s, %s, %s, %s, %s) RETURNING id',
        (name, name, assigned, next_call, '次の連絡' if next_call else None))[0]['id']


def appo(client, cid, visit=None, precheck=None, user=None):
    row = client.sql(
        '''INSERT INTO telema_call_logs (company_id, user_id, called_at, result_status_id, raw_note, record_type, visit_at, precheck_at, ai_status, input_method)
           VALUES (%s, %s, %s, %s, '時間設定', 'call', %s, %s, 'skipped', 'text') RETURNING id''',
        (cid, user, at(-3), client.status_id('時間設定成立'), visit, precheck))
    return row[0]['id']


def today(client):
    return client.api('/schedule/today')[1]


def labels(items):
    return sorted(i['company_name'] for i in items)


def test_今日の予定は_自分の分だけ_今日と期限超過を出し_明日以降は出さない(client):
    me = client.api('/me')[1]['id']
    other = client.add_user('予定の別営業')
    a = make_company(client, '予定今日園', assigned=me, next_call=at(0, 15))
    b = make_company(client, '予定超過園', assigned=me, next_call=at(-2, 9))
    c = make_company(client, '予定明日園', assigned=me, next_call=at(1, 9))
    d_ = make_company(client, '予定他人園', assigned=other, next_call=at(0, 9))
    appo(client, a, visit=at(0, 10), precheck=at(0, 9), user=me)
    appo(client, b, visit=at(-1, 10), precheck=at(1, 9), user=me)          # 訪問は昨日（期限超過）・事前確認は明日（出さない）
    appo(client, c, visit=at(1, 10), user=me)                               # 明日（出さない）
    appo(client, d_, visit=at(0, 10), user=other)                           # 他人の担当・他人の記録（出さない）
    s = today(client)
    mine = lambda items: [i for i in items if i['company_name'].startswith('予定')]   # noqa: E731
    assert labels(mine(s['visit'])) == ['予定今日園', '予定超過園']
    assert labels(mine(s['precheck'])) == ['予定今日園']
    assert labels(mine(s['recall'])) == ['予定今日園', '予定超過園']
    over = {i['company_name']: i['overdue'] for i in mine(s['visit'])}
    assert over == {'予定今日園': False, '予定超過園': True}
    assert [i['company_name'] for i in mine(s['visit'])] == ['予定超過園', '予定今日園']     # 古い順


def test_対応済みにすると表示から消え_再コールは次回架電が空になる_まとめても押せる(client):
    me = client.api('/me')[1]['id']
    a = make_company(client, '済み今日園', assigned=me, next_call=at(0, 15))
    b = make_company(client, '済み二つ目園', assigned=me, next_call=at(0, 16))
    v1 = appo(client, a, visit=at(0, 10), precheck=at(0, 9), user=me)
    v2 = appo(client, b, visit=at(0, 11), user=me)
    ids = lambda kind: sorted(i['id'] for i in today(client)[kind] if i['company_name'].startswith('済み'))   # noqa: E731
    assert ids('visit') == sorted([v1, v2]) and ids('recall') == sorted([a, b])
    status, r = client.api('/schedule/done', {'items': [{'kind': 'visit', 'id': v1}]})
    assert status == 200 and r == {'done': 1, 'skipped': 0}
    assert ids('visit') == [v2] and ids('precheck') == [v1]                                  # 訪問だけ済み。事前確認は残る
    r = client.api('/schedule/done', {'items': [{'kind': 'precheck', 'id': v1}, {'kind': 'visit', 'id': v2}, {'kind': 'recall', 'id': a}, {'kind': 'recall', 'id': b}]})[1]
    assert r == {'done': 4, 'skipped': 0}
    assert ids('visit') == [] and ids('precheck') == [] and ids('recall') == []
    row = client.sql('SELECT next_call_at, next_action FROM telema_companies WHERE id = %s', (a,))[0]
    assert row == {'next_call_at': None, 'next_action': None}
    log = client.sql("SELECT before_json FROM telema_audit_logs WHERE entity_type = 'company' AND entity_id = %s AND action = 'update' ORDER BY id DESC LIMIT 1", (a,))[0]
    assert '次の連絡' in log['before_json']                                                    # 変更前は操作ログに残る
    # もう一度押しても何も起きない（済みのものは skipped）。タイムラインの記録には済みの時刻が返る
    assert client.api('/schedule/done', {'items': [{'kind': 'visit', 'id': v1}, {'kind': 'recall', 'id': a}]})[1] == {'done': 0, 'skipped': 2}
    call = next(c for c in client.api(f'/companies/{a}/calls')[1] if c['id'] == v1)
    assert call['visit_done_at'] and call['precheck_done_at']


def test_日時を直すと対応済みが外れ_編集できない施設の予定は対応済みにできない(client):
    me = client.api('/me')[1]['id']
    a = make_company(client, '直す園', assigned=me)
    v = appo(client, a, visit=at(0, 10), user=me)
    client.api('/schedule/done', {'items': [{'kind': 'visit', 'id': v}]})
    assert [i['id'] for i in today(client)['visit'] if i['company_name'] == '直す園'] == []
    assert client.api(f'/calls/{v}', {'visit_at': at(0, 14)}, method='PATCH')[1]['visit_done_at'] is None      # 新しい予定として、また出る
    assert [i['id'] for i in today(client)['visit'] if i['company_name'] == '直す園'] == [v]
    # 他の営業の担当で、自分が記録したものではない予定は、一般は対応済みにできない
    other = client.add_user('予定の別営業2')
    theirs = make_company(client, '他人の予定園', assigned=other, next_call=at(0, 9))
    t = appo(client, theirs, visit=at(0, 9), user=other)
    client.set_my_role('sales')
    try:
        r = client.api('/schedule/done', {'items': [{'kind': 'visit', 'id': t}, {'kind': 'recall', 'id': theirs}]})[1]
        assert r == {'done': 0, 'skipped': 2}
    finally:
        client.set_my_role('admin')
    assert client.sql('SELECT next_call_at FROM telema_companies WHERE id = %s', (theirs,))[0]['next_call_at'] is not None
    assert client.api('/schedule/done', {'items': []})[0] == 400
    assert client.api('/schedule/done', {'items': [{'kind': 'x', 'id': 1}]})[0] == 400
