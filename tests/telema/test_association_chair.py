"""担当者の「協会会長」。決裁者とは別に付けられ、施設一覧で目印（王冠マーク）に使える。"""


def make_company(client, name, assigned=None, org=None):
    org_id = None
    if org:
        found = client.sql('SELECT id FROM telema_organizations WHERE name = %s', (org,))
        org_id = found[0]['id'] if found else client.sql('INSERT INTO telema_organizations (name, name_normalized) VALUES (%s, %s) RETURNING id', (org, org))[0]['id']
    return client.sql(
        'INSERT INTO telema_companies (company_name, company_name_normalized, search_text, assigned_user_id, organization_id) VALUES (%s, %s, %s, %s, %s) RETURNING id',
        (name, name, name, assigned, org_id))[0]['id']


def listed(client, q):
    return {i['company_name']: i['has_association_chair'] for i in client.api(f'/companies?q={q}&per_page=50')[1]['items']}


def test_担当者に協会会長を付けられ_決裁者とは別で_一覧に目印が出る(client):
    a, b = make_company(client, '会長園A'), make_company(client, '会長園B')
    status, c = client.api(f'/companies/{a}/contacts', {'name': '会長 太郎', 'role': '園長', 'is_decision_maker': True, 'is_association_chair': True})
    assert status == 201 and c['is_association_chair'] == 1 and c['is_decision_maker'] == 1
    _, plain = client.api(f'/companies/{b}/contacts', {'name': '普通 花子', 'is_decision_maker': True})
    assert plain['is_association_chair'] == 0                                              # 決裁者だけでは、協会会長にならない
    assert listed(client, '会長園') == {'会長園A': True, '会長園B': False}
    detail = client.api(f'/companies/{a}')[1]
    assert detail['contacts'][0]['is_association_chair'] == 1
    # 直す・外す。協会会長を外すと、目印も消える。無効にした担当者は数えない
    assert client.api(f'/contacts/{plain["id"]}', {'is_association_chair': True}, method='PATCH')[1]['is_association_chair'] == 1
    assert listed(client, '会長園')['会長園B'] is True
    assert client.api(f'/contacts/{plain["id"]}', {'is_association_chair': False}, method='PATCH')[1]['is_association_chair'] == 0
    assert listed(client, '会長園')['会長園B'] is False
    assert client.api(f'/contacts/{c["id"]}', {'is_active': False}, method='PATCH')[0] == 200
    assert listed(client, '会長園')['会長園A'] is False


def test_法人に登録した協会会長は_同じ法人の施設の一覧にも目印が出る_マイページの一覧にも(client):
    a = make_company(client, '法人会長園1', org='学校法人会長会')
    b = make_company(client, '法人会長園2', org='学校法人会長会')
    other = make_company(client, '無関係会長園')
    org_id = client.sql('SELECT organization_id FROM telema_companies WHERE id = %s', (a,))[0]['organization_id']
    client.sql("INSERT INTO telema_contacts (organization_id, name, role, is_association_chair) VALUES (%s, '法人の会長', '理事長', 1)", (org_id,))
    assert listed(client, '法人会長園') == {'法人会長園1': True, '法人会長園2': True}
    assert listed(client, '無関係会長園') == {'無関係会長園': False}
    from datetime import datetime, timedelta, timezone
    client.sql('UPDATE telema_companies SET next_call_at = %s WHERE id = %s', ((datetime.now(timezone.utc) - timedelta(days=1)).isoformat(), a))
    today = {i['company_name']: i['has_association_chair'] for i in client.api('/dashboard')[1]['today']}
    assert today['法人会長園1'] is True
    assert b != other
