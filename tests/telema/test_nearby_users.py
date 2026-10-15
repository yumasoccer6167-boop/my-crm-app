"""カルテに、同じ市区町村のユーザーを自動で表示する（理事長名・園長名・法人名・園名）。"""


def make_company(client, name, city='相模原市', pref='神奈川県', is_user=1, assigned=None, org=None, org_title=None, org_rep=None):
    org_id = None
    if org:
        org_id = client.sql('INSERT INTO telema_organizations (name, name_normalized, representative_name, representative_title) VALUES (%s, %s, %s, %s) RETURNING id',
                            (org, org, org_rep, org_title))[0]['id']
    return client.sql(
        '''INSERT INTO telema_companies (company_name, company_name_normalized, prefecture, city, is_user, assigned_user_id, organization_id)
           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id''', (name, name, pref, city, is_user, assigned, org_id))[0]['id']


def contact(client, cid, name, role):
    client.api(f'/companies/{cid}/contacts', {'name': name, 'role': role})


def nearby(client, cid):
    status, body = client.api(f'/companies/{cid}/nearby-users')
    assert status == 200
    return body


def test_同じ市区町村のユーザーだけを_理事長名_園長名_法人名_園名つきで返す(client):
    me = make_company(client, '近隣の起点園', is_user=0)
    a = make_company(client, '近隣ユーザーA園', org='学校法人A会')
    contact(client, a, '山田 理事', '理事長'); contact(client, a, '鈴木 園長', '園長'); contact(client, a, '佐藤 主任', '主任')
    b = make_company(client, '近隣ユーザーB園', org='学校法人B会', org_title='理事長', org_rep='高橋 太郎')      # 理事長は法人の代表から
    make_company(client, '近隣ユーザー以外園', is_user=0)                                                  # ユーザーではない
    make_company(client, '別の市のユーザー園', city='横浜市')                                              # 別の市区町村
    make_company(client, '同じ市の別の区のユーザー園', city='相模原市緑区')                                 # 政令指定都市は、区が違っても同じ市として出す
    make_company(client, '別の県の同名市ユーザー園', pref='東京都')                                         # 市の名前が同じでも別の県
    r = nearby(client, me)
    assert (r['prefecture'], r['city'], r['total']) == ('神奈川県', '相模原市', 3)
    rows = {i['company_name']: i for i in r['items']}
    assert set(rows) == {'近隣ユーザーA園', '近隣ユーザーB園', '同じ市の別の区のユーザー園'}
    assert rows['同じ市の別の区のユーザー園']['city'] == '相模原市緑区'
    assert {'organization_name': '学校法人A会', 'chairman_name': '山田 理事', 'principal_name': '鈴木 園長'}.items() <= rows['近隣ユーザーA園'].items()
    assert rows['近隣ユーザーB園']['chairman_name'] == '高橋 太郎' and rows['近隣ユーザーB園']['principal_name'] is None
    assert rows['近隣ユーザーA園']['id'] == a and rows['近隣ユーザーB園']['id'] == b


def test_自分自身は除き_市区町村が無い施設は空_法人の担当者も使う(client):
    me = make_company(client, '起点ユーザー園', is_user=1)
    assert [i['company_name'] for i in nearby(client, me)['items'] if i['company_name'] == '起点ユーザー園'] == []
    none = make_company(client, '市なし園', city=None)
    assert nearby(client, none) == {'prefecture': '神奈川県', 'city': None, 'total': 0, 'items': []}
    c = make_company(client, '法人担当者の園', org='学校法人C会')
    org_id = client.sql('SELECT organization_id FROM telema_companies WHERE id = %s', (c,))[0]['organization_id']
    client.sql("INSERT INTO telema_contacts (organization_id, name, role) VALUES (%s, '法人の園長', '園長')", (org_id,))
    row = next(i for i in nearby(client, me)['items'] if i['company_name'] == '法人担当者の園')
    assert row['principal_name'] == '法人の園長'
    contact(client, c, '施設の園長', '園長')                                   # 施設に登録された担当者を、法人のものより優先する
    row = next(i for i in nearby(client, me)['items'] if i['company_name'] == '法人担当者の園')
    assert row['principal_name'] == '施設の園長'


def test_一般はほかの人の担当のユーザーも見え_ユーザー以外は出ない(client):
    other = client.add_user('近隣の別営業')
    me = make_company(client, '一般の起点園', is_user=0)
    make_company(client, '他人のユーザー園', assigned=other)
    make_company(client, '他人のユーザー以外園', is_user=0, assigned=other)
    client.set_my_role('sales')
    try:
        names = [i['company_name'] for i in nearby(client, me)['items']]
        assert '他人のユーザー園' in names and '他人のユーザー以外園' not in names
    finally:
        client.set_my_role('admin')
    assert client.api('/companies/999999/nearby-users')[0] == 404


def test_政令指定都市は市の単位で_区だけの市や特別区はそのまま(client):
    ku = make_company(client, '区の起点園', city='相模原市中央区', is_user=0)
    other_ku = make_company(client, '別の区のユーザー園', city='相模原市南区')
    assert other_ku in [i['id'] for i in nearby(client, ku)['items']] and nearby(client, ku)['city'] == '相模原市'
    # 区のない市（市川市）は、先頭の「市」で切らない。東京23区は区のまま（新宿区と渋谷区は別）
    a = make_company(client, '市川の起点園', city='市川市', pref='千葉県', is_user=0)
    make_company(client, '市川のユーザー園', city='市川市', pref='千葉県')
    make_company(client, '千葉市のユーザー園', city='千葉市中央区', pref='千葉県')
    assert [i['company_name'] for i in nearby(client, a)['items']] == ['市川のユーザー園'] and nearby(client, a)['city'] == '市川市'
    s1 = make_company(client, '新宿の起点園', city='新宿区', pref='東京都', is_user=0)
    make_company(client, '新宿のユーザー園', city='新宿区', pref='東京都')
    make_company(client, '渋谷のユーザー園', city='渋谷区', pref='東京都')
    assert [i['company_name'] for i in nearby(client, s1)['items']] == ['新宿のユーザー園'] and nearby(client, s1)['city'] == '新宿区'
