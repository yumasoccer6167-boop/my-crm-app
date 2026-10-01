import json


def add_company(client, name, assignee, assigned_user_id=None):
    extra = None if assignee is None else json.dumps({'担当者': assignee, '状態': '未架電'}, ensure_ascii=False)
    return client.sql(
        'INSERT INTO telema_companies (company_name, company_name_normalized, extra_attributes, assigned_user_id) VALUES (%s, %s, %s, %s) RETURNING id',
        (name, name, extra, assigned_user_id))[0]['id']


def test_担当者名ごとの件数を返し未割当の施設だけに割り当てる(client):
    sato = client.add_user('佐藤')
    suzuki = client.add_user('鈴木')
    a = add_company(client, 'A園', '佐藤')
    b = add_company(client, 'B園', ' 佐藤 ')
    c = add_company(client, 'C園', '佐藤', suzuki)  # 既に担当あり → 上書きしない
    d = add_company(client, 'D園', '鈴木')
    add_company(client, 'E園', None)
    add_company(client, 'F園', '')

    status, body = client.api('/admin/assignee-mapping')
    assert status == 200
    assert body['items'] == [
        {'name': '佐藤', 'total': 3, 'unassigned': 2},
        {'name': '鈴木', 'total': 1, 'unassigned': 1},
    ]

    status, body = client.api('/admin/assignee-mapping', {'mappings': [{'name': '佐藤', 'user_id': sato}, {'name': '鈴木', 'user_id': suzuki}]})
    assert status == 200
    assert body == {'updated': 3, 'counts': {'佐藤': 2, '鈴木': 1}}

    rows = client.sql('SELECT id, assigned_user_id FROM telema_companies WHERE id IN (%s, %s, %s, %s) ORDER BY id', (a, b, c, d))
    assert rows == [
        {'id': a, 'assigned_user_id': sato},
        {'id': b, 'assigned_user_id': sato},
        {'id': c, 'assigned_user_id': suzuki},
        {'id': d, 'assigned_user_id': suzuki},
    ]
    assert client.sql("SELECT action, entity_type FROM telema_audit_logs WHERE entity_type = 'company_bulk'") == [{'action': 'assign', 'entity_type': 'company_bulk'}]


def test_存在しないメンバーは400(client):
    assert client.api('/admin/assignee-mapping', {'mappings': [{'name': '佐藤', 'user_id': 99999}]})[0] == 400
    assert client.api('/admin/assignee-mapping', {'mappings': []})[0] == 400


def test_管理者以外は使えない(client):
    client.set_my_role('manager')
    try:
        assert client.api('/admin/assignee-mapping')[0] == 403
    finally:
        client.set_my_role('admin')
