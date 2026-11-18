"""地域分析。他のテストと重ならない先の月（2027-08）と、専用の地名を使う"""


def make(client, name, pref, city, industry, called=0, user=0):
    return client.sql(
        'INSERT INTO telema_companies (company_name, company_name_normalized, prefecture, city, industry, call_count, is_user) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id',
        (name, name, pref, city, industry, called, user))[0]['id']


def test_地域で絞り込んで業種別の事業所数と地域別の数字を見る(client):
    a = make(client, '日立私学A', '茨城県', '日立市', '私学助成の幼稚園', called=2)
    make(client, '日立私学B', '茨城県', '日立市', '私学助成の幼稚園')
    c = make(client, '日立給付C', '茨城県', '日立市', '施設給付型の幼稚園', called=1, user=1)
    make(client, '水戸D', '茨城県', '水戸市', '私学助成の幼稚園', called=1)
    make(client, '住所なしE', None, None, None)
    # 8/10：日立私学Aに架電2件（1件が時間設定成立）。日立給付Cに初回訪問・営業の訪問記録。8/20：契約
    p = {r['name']: r['id'] for r in client.api('/visit-purposes')[1]}
    st = client.status_id('時間設定成立')
    assert client.api(f'/companies/{a}/calls', {'raw_note': 'x', 'called_at': '2027-08-10T01:00:00Z', 'result_status_id': st})[0] == 201
    assert client.api(f'/companies/{a}/calls', {'raw_note': 'x', 'called_at': '2027-08-10T02:00:00Z', 'result_status_id': client.status_id('見込み')})[0] == 201
    v = lambda purpose: client.api(f'/companies/{c}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': 'x', 'visit_purpose_id': p[purpose], 'called_at': '2027-08-11T01:00:00Z'})[0]
    assert v('初回訪問') == 201 and v('営業') == 201
    assert client.api(f'/companies/{c}/contracts', {'product_name': '地域商材', 'contract_date': '2027-08-20', 'gross_profit': 300000, 'units': 2})[0] == 201

    q = '/region-analysis?from=2027-08-01&to=2027-08-31'
    s, r = client.api(q)
    assert s == 200 and r['level'] == 'prefecture'
    by = {x['area']: x for x in r['areas']}
    assert by['茨城県']['total'] == 4 and by['不明']['total'] == 1
    assert by['茨城県']['calls'] >= 2 and by['茨城県']['scheduled'] >= 1 and by['茨城県']['first_visits'] == 1 and by['茨城県']['sales'] == 1
    assert by['茨城県']['contracts'] == 1 and by['茨城県']['gross_profit'] == 300000 and by['茨城県']['units'] == 2
    assert {x['name'] for x in r['options']['prefectures']} >= {'茨城県', '不明'} and r['options']['cities'] == []

    # 日立市で絞ると、日立市内の業種別の事業所数が出る（水戸の施設は入らない）
    s, r = client.api(q + '&prefecture=茨城県&city=日立市')
    assert s == 200 and r['level'] == 'city'
    ind = {x['industry']: x for x in r['industries']}
    assert ind['私学助成の幼稚園']['total'] == 2 and ind['私学助成の幼稚園']['called'] == 1
    assert ind['施設給付型の幼稚園']['total'] == 1 and ind['施設給付型の幼稚園']['users'] == 1 and set(ind) == {'私学助成の幼稚園', '施設給付型の幼稚園'}
    assert [x['area'] for x in r['areas']] == ['日立市'] and r['areas'][0]['total'] == 3

    # 都道府県だけ選ぶと市区町村ごと。業種を絞ると、地域の行はその業種だけの数になり、業種表は絞り込まない
    s, r = client.api(q + '&prefecture=茨城県&industry=施設給付型の幼稚園')
    by = {x['area']: x for x in r['areas']}
    assert set(by) == {'日立市'} and by['日立市']['total'] == 1 and by['日立市']['sales'] == 1 and {c['name'] for c in r['options']['cities']} == {'日立市', '水戸市'}
    assert {x['industry'] for x in r['industries']} == {'私学助成の幼稚園', '施設給付型の幼稚園'}

    # 業種が空の施設は「未設定」
    s, r = client.api(q + '&prefecture=不明')
    assert {x['industry'] for x in r['industries']} == {'未設定'}
    # 期間の外の活動は数えない
    s, r = client.api('/region-analysis?from=2027-09-01&to=2027-09-30&prefecture=茨城県&city=日立市')
    assert r['areas'][0]['calls'] == 0 and r['areas'][0]['contracts'] == 0 and r['areas'][0]['total'] == 3


def test_地域分析の入力チェック(client):
    assert client.api('/region-analysis?city=日立市')[0] == 400
    assert client.api('/region-analysis?from=2027-9-1')[0] == 400
    assert client.api('/region-analysis?from=2027-09-30&to=2027-09-01')[0] == 400
    assert client.api('/region-analysis')[0] == 200
