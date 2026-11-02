"""再コール一覧：担当の施設の次回架電を日時順に。件数は範囲で絞る前の全体"""
from datetime import datetime, timedelta, timezone


def make_company(client, name, assigned=None):
    return client.sql('INSERT INTO telema_companies (company_name, company_name_normalized, assigned_user_id) VALUES (%s, %s, %s) RETURNING id', (name, name, assigned))[0]['id']


def test_再コールは担当の施設を日時順に並べ_件数と範囲で絞れる(client):
    sid = client.add_user('再コールの営業', 'sales')
    other = client.add_user('再コールの別の営業', 'sales')
    now = datetime.now(timezone.utc)
    at = lambda **kw: (now + timedelta(**kw)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    a, b, c, d, e = (make_company(client, f'再コール園{x}', sid) for x in 'ABCDE')
    make_company(client, '再コール園なし', sid)
    x = make_company(client, '再コール園別担当', other)
    client.sql('UPDATE telema_companies SET next_call_at = %s, next_action = %s WHERE id = %s', (at(days=-3), '見積の確認', a))     # 期限超過
    client.sql('UPDATE telema_companies SET next_call_at = %s WHERE id = %s', (at(days=60), b))
    client.sql('UPDATE telema_companies SET next_call_at = %s WHERE id = %s', (at(days=30), c))
    client.sql('UPDATE telema_companies SET next_call_at = %s WHERE id = %s', (at(days=-1), d))
    client.sql('UPDATE telema_companies SET next_call_at = %s WHERE id = %s', (at(days=90), x))
    client.sql('UPDATE telema_companies SET next_call_at = %s, is_active = 0 WHERE id = %s', (at(days=-2), e))                       # 無効な施設は出ない

    status, r = client.api(f'/recalls?user_id={sid}')
    assert status == 200 and r['user_id'] == sid and r['range'] == 'all'
    assert [i['company_name'] for i in r['items']] == ['再コール園A', '再コール園D', '再コール園C', '再コール園B']
    assert r['items'][0]['overdue'] and r['items'][0]['next_action'] == '見積の確認' and r['items'][0]['assigned_user_name'] == '再コールの営業' and not r['items'][2]['overdue']
    assert r['counts']['overdue'] == 2 and r['counts']['total'] == 4 and r['counts']['week'] >= 2 and r['counts']['today'] <= r['counts']['week']
    overdue = client.api(f'/recalls?user_id={sid}&range=overdue')[1]
    assert [i['company_name'] for i in overdue['items']] == ['再コール園A', '再コール園D'] and overdue['counts'] == r['counts']
    assert all(i['company_name'] != '再コール園B' for i in client.api(f'/recalls?user_id={sid}&range=week')[1]['items'])
    assert client.api('/recalls?range=x')[0] == 400 and client.api('/recalls?user_id=abc')[0] == 400
    everyone = client.api('/recalls?user_id=all')[1]
    assert '再コール園別担当' in [i['company_name'] for i in everyone['items']] and everyone['user_id'] is None

    # 営業は自分の分だけ。対応済みにすると一覧から消える
    client.set_my_role('sales')
    try:
        mid = client.sql("SELECT id FROM users WHERE username = 'owner'")[0]['id']
        assert client.api(f'/recalls?user_id={sid}')[1]['user_id'] == mid
    finally:
        client.set_my_role('admin')
    assert client.api('/schedule/done', {'items': [{'kind': 'recall', 'id': a}]})[1]['done'] == 1
    assert [i['company_name'] for i in client.api(f'/recalls?user_id={sid}')[1]['items']] == ['再コール園D', '再コール園C', '再コール園B']
