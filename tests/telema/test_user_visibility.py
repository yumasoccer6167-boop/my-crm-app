"""ユーザー（導入済み）の施設は、担当が決まっていない一般（sales）のメンバーでも、誰でも検索・閲覧できる（編集は担当者のみ）。"""
from datetime import datetime, timedelta, timezone


def make_company(client, name, assigned=None, is_user=0):
    return client.sql(
        '''INSERT INTO telema_companies (company_name, company_name_normalized, search_text, assigned_user_id, is_user)
           VALUES (%s, %s, %s, %s, %s) RETURNING id''', (name, name, name, assigned, is_user))[0]['id']


def sales(client):
    """営業ロールとして操作する（with で使う）"""
    class Ctx:
        def __enter__(self):
            client.set_my_role('sales')

        def __exit__(self, *a):
            client.set_my_role('admin')
    return Ctx()


def names(client, q):
    return sorted(i['company_name'] for i in client.api(f'/companies?q={q}&per_page=100')[1]['items'])


def test_一般はほかの人の担当のユーザーを検索_閲覧でき_ユーザー以外は見えないまま(client):
    other = client.add_user('別の営業A')
    u = make_company(client, '閲覧ユーザー園', assigned=other, is_user=1)
    n = make_company(client, '閲覧ユーザー以外園', assigned=other, is_user=0)
    pool = make_company(client, '閲覧未割当園', assigned=None, is_user=0)
    client.api(f'/companies/{u}/contracts', {'product_name': '閲覧商材', 'contract_date': '2025-05-05'})
    with sales(client):
        assert names(client, '閲覧') == ['閲覧ユーザー園', '閲覧未割当園']              # 他人の担当のユーザー以外は出ない
        status, body = client.api(f'/companies/{u}')
        assert status == 200 and body['company']['company_name'] == '閲覧ユーザー園' and body['contracts'][0]['product_name'] == '閲覧商材'
        assert client.api(f'/companies/{u}/calls')[0] == 200
        assert client.api(f'/companies/{n}')[0] == 404
        assert [i['product_name'] for i in client.api('/contracts?q=閲覧')[1]['items']] == ['閲覧商材']
        assert client.api(f'/companies/{pool}')[0] == 200


def test_一般は見られるだけで_他の人のユーザーを編集_削除できない(client):
    other = client.add_user('別の営業B')
    u = make_company(client, '編集不可ユーザー園', assigned=other, is_user=1)
    with sales(client):
        assert client.api(f'/companies/{u}', {'temperature': 'high'}, method='PATCH')[0] == 403
        assert client.api(f'/companies/{u}/calls', {'raw_note': 'メモ'})[0] == 403
        assert client.api(f'/companies/{u}/contracts', {'product_name': 'x', 'contract_date': '2025-01-01'})[0] == 403
        assert client.api(f'/companies/{u}/associations', {'association_ids': []}, method='PATCH')[0] == 403
        assert client.api(f'/companies/{u}/leave-organization', {})[0] == 403
        r = client.api('/companies/bulk-delete', {'company_ids': [u]})[1]
        assert r['deleted'] == 0
    assert client.sql('SELECT is_active, temperature FROM telema_companies WHERE id = %s', (u,))[0] == {'is_active': 1, 'temperature': 'unrated'}


def test_マイページの件数と今日の予定_訪問ルートには_他の人のユーザーを含めない(client):
    other = client.add_user('別の営業C')
    u = make_company(client, '件数外ユーザー園', assigned=other, is_user=1)
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    client.sql('UPDATE telema_companies SET next_call_at = %s WHERE id = %s', (yesterday, u))
    with sales(client):
        d = client.api('/dashboard')[1]
        assert '件数外ユーザー園' not in [i['company_name'] for i in d['today']]
        assert '件数外ユーザー園' not in [i['company_name'] for i in client.api('/visit-targets')[1]]
    assert '件数外ユーザー園' in [i['company_name'] for i in client.api('/dashboard')[1]['today']]      # 管理者は全体


def test_管理者とマネージャーは従来どおり全件(client):
    other = client.add_user('別の営業D')
    make_company(client, '全件確認園', assigned=other, is_user=0)
    client.set_my_role('manager')
    try:
        assert names(client, '全件確認') == ['全件確認園']
    finally:
        client.set_my_role('admin')
