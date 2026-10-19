"""担当者の「協会役員」。協会会長・決裁者とは別に付けられ、施設一覧では銀の王冠の目印に使える。"""
from tests.telema.test_association_chair import make_company


def flags(client, q):
    return {i['company_name']: (i['has_association_chair'], i['has_association_officer']) for i in client.api(f'/companies?q={q}&per_page=50')[1]['items']}


def test_担当者に協会役員を付けられ_協会会長とは別で_一覧に目印が出る(client):
    a, b, c = make_company(client, '役員園A'), make_company(client, '役員園B'), make_company(client, '役員園C')
    status, o = client.api(f'/companies/{a}/contacts', {'name': '役員 太郎', 'role': '理事', 'is_association_officer': True})
    assert status == 201 and o['is_association_officer'] == 1 and o['is_association_chair'] == 0 and o['is_decision_maker'] == 0
    client.api(f'/companies/{b}/contacts', {'name': '会長 花子', 'is_association_chair': True})
    assert client.api(f'/companies/{c}/contacts', {'name': '普通 次郎', 'is_decision_maker': True})[1]['is_association_officer'] == 0
    assert flags(client, '役員園') == {'役員園A': (False, True), '役員園B': (True, False), '役員園C': (False, False)}      # 会長（金）と役員（銀）は別
    assert client.api(f'/companies/{a}')[1]['contacts'][0]['is_association_officer'] == 1
    # 会長と役員の両方を付けられる。直す・外す・無効にすると目印も消える
    both = client.api(f'/contacts/{o["id"]}', {'is_association_chair': True}, method='PATCH')[1]
    assert both['is_association_chair'] == 1 and both['is_association_officer'] == 1 and flags(client, '役員園A')['役員園A'] == (True, True)
    assert client.api(f'/contacts/{o["id"]}', {'is_association_officer': False}, method='PATCH')[1]['is_association_officer'] == 0
    assert flags(client, '役員園A')['役員園A'] == (True, False)
    assert client.api(f'/contacts/{o["id"]}', {'is_association_officer': True}, method='PATCH')[0] == 200
    assert client.api(f'/contacts/{o["id"]}', {'is_active': False}, method='PATCH')[0] == 200
    assert flags(client, '役員園A')['役員園A'] == (False, False)


def test_法人に登録した協会役員は_同じ法人の施設の一覧とマイページにも出る(client):
    a = make_company(client, '法人役員園1', org='学校法人役員会')
    make_company(client, '法人役員園2', org='学校法人役員会')
    make_company(client, '無関係役員園')
    org_id = client.sql('SELECT organization_id FROM telema_companies WHERE id = %s', (a,))[0]['organization_id']
    client.sql("INSERT INTO telema_contacts (organization_id, name, role, is_association_officer) VALUES (%s, '法人の役員', '理事', 1)", (org_id,))
    assert flags(client, '法人役員園') == {'法人役員園1': (False, True), '法人役員園2': (False, True)}
    assert flags(client, '無関係役員園') == {'無関係役員園': (False, False)}
    from datetime import datetime, timedelta, timezone
    client.sql('UPDATE telema_companies SET next_call_at = %s WHERE id = %s', ((datetime.now(timezone.utc) - timedelta(days=1)).isoformat(), a))
    assert {i['company_name']: i['has_association_officer'] for i in client.api('/dashboard')[1]['today']}['法人役員園1'] is True
