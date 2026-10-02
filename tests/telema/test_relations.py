def add_company(client, name, address=None, status=None, assigned_user_id=None):
    import re
    pref = re.match(r'^.{2,3}?[都道府県]', address).group(0) if address else None
    return client.sql(
        '''INSERT INTO telema_companies (company_name, company_name_normalized, address, prefecture, status_id, assigned_user_id)
           VALUES (%s, %s, %s, %s, %s, %s) RETURNING id''',
        (name, name, address, pref, client.status_id(status) if status else None, assigned_user_id))[0]['id']


def add_contact(client, company_id, name):
    return client.api(f'/companies/{company_id}/contacts', {'name': name, 'role': '園長', 'is_decision_maker': True})[1]['id']


def test_担当者どうしをつなぎ両方の施設から相手が見える(client):
    a = add_company(client, 'ひかり保育園', '茨城県水戸市1-1', '受注成立')
    b = add_company(client, 'さくら幼稚園', '茨城県つくば市2-2')
    ta = add_contact(client, a, '田中')
    sb = add_contact(client, b, '佐藤')

    # id の大きい側から登録しても向きは揃えて保存される
    status, body = client.api(f'/companies/{b}/relations', {'other_company_id': a, 'contact_id': sb, 'other_contact_id': ta, 'label': '園長会'})
    assert status == 201
    assert {'company_a_id': a, 'company_b_id': b, 'contact_a_id': ta, 'contact_b_id': sb, 'label': '園長会'}.items() <= body.items()

    from_a = client.api(f'/companies/{a}/relations')[1]
    assert len(from_a) == 1
    assert {'other_company_id': b, 'other_company_name': 'さくら幼稚園', 'my_contact_name': '田中', 'other_contact_name': '佐藤', 'label': '園長会'}.items() <= from_a[0].items()
    from_b = client.api(f'/companies/{b}/relations')[1]
    assert {'other_company_id': a, 'other_status_label': '受注成立', 'my_contact_name': '佐藤', 'other_contact_name': '田中'}.items() <= from_b[0].items()

    # 同じ組の二重登録は 409、自分自身・他施設の担当者は 400
    assert client.api(f'/companies/{a}/relations', {'other_company_id': b})[0] == 409
    assert client.api(f'/companies/{a}/relations', {'other_company_id': a})[0] == 400
    c = add_company(client, 'みどり園')
    assert client.api(f'/companies/{a}/relations', {'other_company_id': c, 'other_contact_id': sb})[0] == 400


def test_相関図は点と線を返しつながりの無いユーザーも点で出せる(client):
    lonely = add_company(client, 'ひとり保育園', status='受注成立')
    client.sql('UPDATE telema_companies SET is_user = 1 WHERE id = %s', (lonely,))
    g = client.api('/relations/graph')[1]
    names = [n['company_name'] for n in g['nodes']]
    assert {'ひかり保育園', 'さくら幼稚園', 'ひとり保育園'} <= set(names)
    assert 'みどり園' not in names
    assert {'status_label': '受注成立', 'is_user': 1}.items() <= next(n for n in g['nodes'] if n['id'] == lonely).items()
    hikari = next(n for n in g['nodes'] if n['company_name'] == 'ひかり保育園')
    assert {'address': '茨城県水戸市1-1', 'prefecture': '茨城県', 'contact_name': '田中', 'contact_role': '園長'}.items() <= hikari.items()
    assert len(g['edges']) == 1
    assert {'source_contact_name': '田中', 'target_contact_name': '佐藤', 'label': '園長会'}.items() <= g['edges'][0].items()

    only_linked = client.api('/relations/graph?customers=0')[1]
    assert lonely not in [n['id'] for n in only_linked['nodes']]


def test_無効化すると一覧と相関図から消え同じ組を登録し直せる(client):
    edge = client.api('/relations/graph')[1]['edges'][0]
    assert client.api(f'/relations/{edge["id"]}', {'is_active': False}, method='PATCH')[0] == 200
    assert client.api(f'/companies/{edge["source"]}/relations')[1] == []
    assert client.api('/relations/graph')[1]['edges'] == []
    assert client.sql('SELECT is_active FROM telema_company_relations WHERE id = %s', (edge['id'],)) == [{'is_active': 0}]
    assert client.api(f'/companies/{edge["source"]}/relations', {'other_company_id': edge['target']})[0] == 201


def test_営業は他人の担当の施設とはつなげず相関図にも出ない(client):
    other = client.add_user('他の営業')
    mine = add_company(client, '自分の園')
    theirs = add_company(client, '他人の園', assigned_user_id=other)
    client.api(f'/companies/{mine}/relations', {'other_company_id': theirs})
    client.set_my_role('sales')
    try:
        assert client.api(f'/companies/{theirs}/relations')[0] == 404
        g = client.api('/relations/graph')[1]
        assert theirs not in [n['id'] for n in g['nodes']]
        assert not any(theirs in (e['source'], e['target']) for e in g['edges'])
        assert client.api(f'/companies/{mine}/relations')[1] == []
    finally:
        client.set_my_role('admin')
