"""リストの絞り込み：協会会長・協会役員の園だけ／姉妹園を表示しない。"""


def make_company(client, name, org=None, hq=0, assigned=None):
    org_id = None
    if org:
        found = client.sql('SELECT id FROM telema_organizations WHERE name = %s', (org,))
        org_id = found[0]['id'] if found else client.sql('INSERT INTO telema_organizations (name, name_normalized) VALUES (%s, %s) RETURNING id', (org, org))[0]['id']
    return client.sql(
        'INSERT INTO telema_companies (company_name, company_name_normalized, search_text, organization_id, is_headquarters, assigned_user_id) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id',
        (name, name, name, org_id, hq, assigned))[0]['id']


def names(client, qs, q='絞込園'):
    return sorted(i['company_name'][-1] for i in client.api(f'/companies?q={q}&per_page=100&{qs}')[1]['items'])


def test_協会会長_協会役員の園だけを絞り込める(client):
    a, b, c, d = (make_company(client, f'絞込園{x}') for x in 'ABCD')
    client.api(f'/companies/{a}/contacts', {'name': '会長', 'is_association_chair': True})
    client.api(f'/companies/{b}/contacts', {'name': '役員', 'is_association_officer': True})
    client.api(f'/companies/{c}/contacts', {'name': '両方', 'is_association_chair': True, 'is_association_officer': True})
    client.api(f'/companies/{d}/contacts', {'name': '普通', 'is_decision_maker': True})
    assert names(client, '') == ['A', 'B', 'C', 'D']
    assert names(client, 'association_role=chair') == ['A', 'C']
    assert names(client, 'association_role=officer') == ['B', 'C']
    assert names(client, 'association_role=any') == ['A', 'B', 'C']
    assert client.api('/companies?association_role=x')[0] == 400
    # ほかの絞り込みと組み合わせられる。件数も合う
    body = client.api('/companies?q=絞込園&association_role=any&per_page=100')[1]
    assert body['total'] == 3
    # 法人に登録した会長は、同じ法人の施設にも効く
    e, f = make_company(client, '絞込園E', org='学校法人絞込会'), make_company(client, '絞込園F', org='学校法人絞込会')
    org_id = client.sql('SELECT organization_id FROM telema_companies WHERE id = %s', (e,))[0]['organization_id']
    client.sql("INSERT INTO telema_contacts (organization_id, name, is_association_chair) VALUES (%s, '法人会長', 1)", (org_id,))
    assert names(client, 'association_role=chair') == ['A', 'C', 'E', 'F']


def test_姉妹園を表示しない設定では_会社ごとに1施設だけ出る(client):
    Q = '姉妹絞込園'
    a, b = make_company(client, '姉妹絞込園A', org='学校法人姉妹絞込'), make_company(client, '姉妹絞込園B', org='学校法人姉妹絞込')
    c = make_company(client, '姉妹絞込園C', org='学校法人姉妹絞込', hq=1)
    d, e = make_company(client, '姉妹絞込園D'), make_company(client, '姉妹絞込園E')           # 会社に属していない施設は、そのまま出る
    g1, g2 = make_company(client, '姉妹絞込園F', org='学校法人別絞込'), make_company(client, '姉妹絞込園G', org='学校法人別絞込')
    assert names(client, '', Q) == ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    assert names(client, 'hide_siblings=1', Q) == ['C', 'D', 'E', 'F']                    # 本部（C）、本部が無い会社は先に登録された施設（F）
    assert client.api('/companies?q=姉妹絞込園&hide_siblings=1&per_page=100')[1]['total'] == 4
    # ほかの絞り込みに合う施設の中から選ぶ（本部が絞り込みから外れても、会社が消えない）
    client.sql("UPDATE telema_companies SET city = '絞込市' WHERE id IN (%s, %s)", (a, b))
    assert names(client, 'hide_siblings=1&city=絞込市', Q) == ['A']
    # 協会の役職との組み合わせ（役員がいる施設の中から、会社ごとに1施設）
    client.api(f'/companies/{b}/contacts', {'name': '役員', 'is_association_officer': True})
    assert names(client, 'hide_siblings=1&association_role=officer', Q) == ['B']
    assert g1 and g2 and d and e
