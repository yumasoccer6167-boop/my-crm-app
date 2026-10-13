"""契約リスト：全施設の契約情報の一覧と絞り込み。"""


def make_company(client, name, assigned=None, org=None):
    org_id = client.sql('INSERT INTO telema_organizations (name, name_normalized) VALUES (%s, %s) RETURNING id', (org, org))[0]['id'] if org else None
    return client.sql(
        '''INSERT INTO telema_companies (company_name, company_name_normalized, search_text, assigned_user_id, organization_id, prefecture, city)
           VALUES (%s, %s, %s, %s, %s, '神奈川県', '相模原市') RETURNING id''',
        (name, name, f'{name} {org or ""}', assigned, org_id))[0]['id']


def add(client, cid, product, date, user=None, url=None, appo=None):
    body = {'product_name': product, 'contract_date': date}
    if user:
        body['assigned_user_id'] = user
    if url:
        body['product_url'] = url
    if appo:
        body['appointment_user_name'] = appo
    status, row = client.api(f'/companies/{cid}/contracts', body)
    assert status == 201
    return row


def listing(client, query=''):
    status, d = client.api(f'/contracts{query}')
    assert status == 200
    return d


def test_全施設の契約情報が契約日の新しい順に並び_リストの項目が返る(client):
    sales = client.add_user('契約営業')
    a = make_company(client, '契約リストA園', org='学校法人A')
    b = make_company(client, '契約リストB園')
    add(client, a, 'SP-MEO', '2025-03-27', user=sales, url='https://example.com/meo', appo='山田太郎')
    add(client, b, 'Movie Premium', '2026-01-10')
    add(client, a, 'あとから入れた古い契約', '2020-01-01')      # 登録順ではなく契約日の順に並ぶ
    d = listing(client, '?q=契約リスト')
    assert d['total'] == 3
    first, second, third = d['items']
    assert third['product_name'] == 'あとから入れた古い契約'
    assert (first['product_name'], first['contract_date']) == ('Movie Premium', '2026-01-10')       # 新しい順
    assert {'company_id': a, 'company_name': '契約リストA園', 'organization_name': '学校法人A', 'product_name': 'SP-MEO', 'product_url': 'https://example.com/meo',
            'contract_date': '2025-03-27', 'assigned_user_name': '契約営業', 'appointment_user_name': '山田太郎'}.items() <= second.items()
    assert [i['product_name'] for i in listing(client, '?q=契約リスト&order=asc')['items']] == ['あとから入れた古い契約', 'SP-MEO', 'Movie Premium']


def test_商材_営業担当_アポ担当者名_契約日_キーワードで絞り込める(client):
    u1, u2 = client.add_user('絞込営業1'), client.add_user('絞込営業2')
    a = make_company(client, '絞込園A')
    b = make_company(client, '絞込園B')
    add(client, a, '絞込商材X', '2025-01-05', user=u1, appo='アポ甲')
    add(client, a, '絞込商材Y', '2025-06-05', user=u2, appo='アポ乙')
    add(client, b, '絞込商材X', '2026-02-01')
    names = lambda q: sorted((i['company_name'], i['product_name']) for i in listing(client, q)['items'])   # noqa: E731
    assert names('?q=絞込園&product=絞込商材X') == [('絞込園A', '絞込商材X'), ('絞込園B', '絞込商材X')]
    assert names(f'?q=絞込園&assigned={u2}') == [('絞込園A', '絞込商材Y')]
    assert names('?q=絞込園&assigned=none') == [('絞込園B', '絞込商材X')]
    assert names('?q=絞込園&appointment=アポ甲') == [('絞込園A', '絞込商材X')]
    assert names('?q=絞込園&appointment=__none__') == [('絞込園B', '絞込商材X')]
    assert names('?q=絞込園&date_from=2025-06-01&date_to=2025-12-31') == [('絞込園A', '絞込商材Y')]
    assert names('?q=絞込園&date_from=2025-01-05&date_to=2025-06-05') == [('絞込園A', '絞込商材X'), ('絞込園A', '絞込商材Y')]   # 境界の日付を含む
    assert names('?q=アポ乙') == [('絞込園A', '絞込商材Y')]               # キーワードはアポ担当者名・商材名にも効く
    assert listing(client, '?q=絞込園&product=絞込商材X&assigned=' + str(u1))['total'] == 1
    for bad in ('?date_from=2025/01/01', '?assigned=abc', '?page=0', '?per_page=1000'):
        assert client.api(f'/contracts{bad}')[0] == 400


def test_ページ送りと_無効な契約_削除した施設は出ない(client):
    c = make_company(client, 'ページ園')
    rows = [add(client, c, f'ページ商材{i}', f'2024-01-{i + 1:02d}') for i in range(5)]
    d = listing(client, '?q=ページ園&per_page=2&page=2')
    assert d['total'] == 5 and [i['product_name'] for i in d['items']] == ['ページ商材2', 'ページ商材1']
    client.api(f'/contracts/{rows[4]["id"]}', {'is_active': False}, method='PATCH')
    assert listing(client, '?q=ページ園')['total'] == 4
    client.sql('UPDATE telema_companies SET is_active = 0 WHERE id = %s', (c,))
    assert listing(client, '?q=ページ園')['total'] == 0


def test_選択肢の一覧と_営業は見える範囲の契約だけ(client):
    other = client.add_user('他の営業X')
    mine = make_company(client, '見える園')
    theirs = make_company(client, '見えない園', assigned=other)
    add(client, mine, '可視商材', '2025-05-05', appo='可視アポ')
    add(client, theirs, '不可視商材', '2025-05-06', appo='不可視アポ')
    f = client.api('/contracts/facets')[1]
    assert {'可視商材', '不可視商材'} <= {p['value'] for p in f['products']} and '可視アポ' in {a['value'] for a in f['appointments']}
    client.set_my_role('sales')
    try:
        assert listing(client, '?q=見える園')['total'] == 1 and listing(client, '?q=見えない園')['total'] == 0
        f = client.api('/contracts/facets')[1]
        assert '不可視商材' not in {p['value'] for p in f['products']} and '不可視アポ' not in {a['value'] for a in f['appointments']}
    finally:
        client.set_my_role('admin')


def test_施設一覧とマイページの一覧に契約件数が付く(client):
    from datetime import datetime, timedelta, timezone
    with_contract = make_company(client, '件数あり園')
    without = make_company(client, '件数なし園')
    add(client, with_contract, '件数商材A', '2025-01-01')
    add(client, with_contract, '件数商材B', '2025-02-01')
    gone = add(client, with_contract, '件数商材C', '2025-03-01')
    client.api(f'/contracts/{gone["id"]}', {'is_active': False}, method='PATCH')     # 無効な契約は数えない
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    client.sql('UPDATE telema_companies SET next_call_at = %s, is_user = 1 WHERE id = ANY(%s)', (yesterday, [with_contract, without]))
    counts = {i['company_name']: i['contract_count'] for i in client.api('/companies?q=件数&per_page=50')[1]['items']}
    assert counts == {'件数あり園': 2, '件数なし園': 0}
    today = {i['company_name']: i['contract_count'] for i in client.api('/dashboard')[1]['today']}
    assert today['件数あり園'] == 2 and today['件数なし園'] == 0


def join_assoc(client, cid, name):
    existing = next((a['id'] for a in client.api('/associations')[1] if a['name'] == name), None)
    aid = existing or client.api('/associations', {'name': name})[1]['id']
    cur = [a['id'] for a in client.api(f'/companies/{cid}')[1]['associations']]
    client.api(f'/companies/{cid}/associations', {'association_ids': [*cur, aid]}, method='PATCH')
    return aid


def test_加盟協会で絞り込め_一覧に協会名が付く_選択肢に件数が出る(client):
    a = make_company(client, '協会絞込A園')
    b = make_company(client, '協会絞込B園')
    c = make_company(client, '協会絞込C園')          # どの協会にも入っていない
    sagami = join_assoc(client, a, '絞込相模原協会')
    join_assoc(client, b, '絞込相模原協会')
    pref = join_assoc(client, a, '絞込県連合会')
    for cid, p in ((a, 'P1'), (a, 'P2'), (b, 'P3'), (c, 'P4')):
        add(client, cid, f'協会商材{p}', '2025-05-05')
    names = lambda q: sorted(i['product_name'] for i in listing(client, q)['items'])   # noqa: E731
    assert names(f'?q=協会絞込&association={sagami}') == ['協会商材P1', '協会商材P2', '協会商材P3']
    assert names(f'?q=協会絞込&association={pref}') == ['協会商材P1', '協会商材P2']
    assert names('?q=協会絞込&association=none') == ['協会商材P4']
    assert names(f'?q=協会絞込&association={pref}&product=協会商材P2') == ['協会商材P2']
    a_row = next(i for i in listing(client, '?q=協会絞込A')['items'] if i['product_name'] == '協会商材P1')
    assert a_row['associations'] == ['絞込相模原協会', '絞込県連合会']
    gone = add(client, a, '協会商材P5', '2025-06-06')
    client.api(f'/contracts/{gone["id"]}', {'is_active': False}, method='PATCH')      # 無効な契約は件数に入れない
    f = {x['name']: x['n'] for x in client.api('/contracts/facets')[1]['associations']}
    assert f['絞込相模原協会'] == 3 and f['絞込県連合会'] == 2          # 複数の協会に入っている施設の契約は、それぞれに数える
    assert client.api('/contracts?association=abc')[0] == 400
    client.api(f'/associations/{pref}', {'is_active': False}, method='PATCH')
    assert '絞込県連合会' not in {x['name'] for x in client.api('/contracts/facets')[1]['associations']}
