"""姉妹園（同じ法人の施設）の手動まとめ。"""


def make_company(client, name, assigned=None, org=None):
    org_id = client.sql('INSERT INTO telema_organizations (name, name_normalized) VALUES (%s, %s) RETURNING id', (org, org))[0]['id'] if org else None
    return client.sql(
        'INSERT INTO telema_companies (company_name, company_name_normalized, assigned_user_id, organization_id) VALUES (%s, %s, %s, %s) RETURNING id',
        (name, name, assigned, org_id))[0]['id']


def detail(client, cid):
    return client.api(f'/companies/{cid}')[1]


def org_of(client, cid):
    return client.sql('SELECT organization_id FROM telema_companies WHERE id = %s', (cid,))[0]['organization_id']


def test_既存のカルテどうしを法人名なしで連携でき_姉妹園として表示される(client):
    a, b = make_company(client, '姉妹A園'), make_company(client, '姉妹B園')
    status, body = client.api(f'/companies/{a}/siblings', {'company_id': b})            # 法人名の入力は要らない（新しい法人を登録しなくてよい）
    assert status == 200 and [s['company_name'] for s in body['siblings']] == ['姉妹B園']
    assert org_of(client, a) is not None and org_of(client, a) == org_of(client, b)
    d = detail(client, a)
    assert d['organization']['name'] == '' and [s['company_name'] for s in d['siblings']] == ['姉妹B園']
    # 法人名は後から付けられる（連携していないカルテには付けられない）
    assert client.api(f'/companies/{a}/organization-name', {'name': '学校法人姉妹会'})[0] == 200
    assert detail(client, b)['organization']['name'] == '学校法人姉妹会'
    lonely = make_company(client, '連携なし園')
    assert client.api(f'/companies/{lonely}/organization-name', {'name': 'x'})[0] == 400
    assert client.api(f'/companies/{a}/organization-name', {'name': ' '})[0] == 400
    # 法人名を付けて連携することもできる。同じ名前の法人があれば、その法人に入る（法人が増えない）
    c, d2 = make_company(client, '姉妹C園'), make_company(client, '姉妹D園')
    assert client.api(f'/companies/{c}/siblings', {'company_id': d2, 'organization_name': '学校法人姉妹会'})[0] == 200
    assert org_of(client, c) == org_of(client, d2) == org_of(client, a)
    assert client.sql('SELECT COUNT(*) AS n FROM telema_organizations WHERE name = %s', ('学校法人姉妹会',))[0]['n'] == 1
    assert [s['company_name'] for s in detail(client, b)['siblings']] == ['姉妹A園', '姉妹C園', '姉妹D園']       # 相手のカルテにも出る（切り替えられる）
    assert client.sql("SELECT COUNT(*) AS n FROM telema_audit_logs WHERE entity_type = 'company_organization' AND entity_id IN (%s, %s)", (a, b))[0]['n'] == 2
    # 同じ法人どうしをもう一度まとめても何も変わらない
    assert client.api(f'/companies/{a}/siblings', {'company_id': b})[0] == 200 and org_of(client, a) == org_of(client, b)


def test_片方に法人があればそこへ入り_別の法人なら確認してから移す(client):
    a = make_company(client, '法人あり園', org='学校法人既存会')
    c = make_company(client, '法人なし園')
    assert client.api(f'/companies/{c}/siblings', {'company_id': a})[0] == 200          # 自分に法人が無ければ、相手の法人に入る
    assert org_of(client, c) == org_of(client, a)
    other = make_company(client, '別法人園', org='学校法人別会')
    status, body = client.api(f'/companies/{a}/siblings', {'company_id': other})
    assert status == 409 and '学校法人別会' in body['error']['message'] and org_of(client, other) != org_of(client, a)
    assert client.api(f'/companies/{a}/siblings', {'company_id': other, 'force': True})[0] == 200
    assert org_of(client, other) == org_of(client, a)
    assert sorted(s['company_name'] for s in detail(client, a)['siblings']) == ['別法人園', '法人なし園']


def test_姉妹園から外しても施設は残り_権限と入力を検証する(client):
    a, b = make_company(client, '外す元園', org='学校法人外す会'), make_company(client, '外す先園', org='学校法人外す会')
    assert client.api(f'/companies/{b}/leave-organization', {})[0] == 200
    assert org_of(client, b) is None and detail(client, b)['company']['company_name'] == '外す先園'
    assert detail(client, a)['siblings'] == []
    assert client.api(f'/companies/{a}/siblings', {'company_id': a})[0] == 400
    assert client.api(f'/companies/{a}/siblings', {'company_id': 999999})[0] == 404

    other = client.add_user('姉妹の営業')
    mine = make_company(client, '自分の姉妹園')
    theirs = make_company(client, '他人の姉妹園', assigned=other)
    client.set_my_role('sales')
    try:
        assert client.api(f'/companies/{mine}/siblings', {'company_id': theirs, 'organization_name': 'x'})[0] in (403, 404)
        assert client.api(f'/companies/{theirs}/leave-organization', {})[0] in (403, 404)
    finally:
        client.set_my_role('admin')
