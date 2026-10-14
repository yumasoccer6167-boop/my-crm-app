"""表示名を変えても、顧客・記録の担当者（名前の文字列）が追従し、同じアカウントとして扱われる。"""
import json


def set_crm(client, customers, records):
    client.sql('''INSERT INTO app_state (id, data) VALUES (1, %s::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data''',
               (json.dumps({'customers': customers, 'records': records}, ensure_ascii=False),))


def crm(client):
    return client.sql('SELECT data FROM app_state WHERE id = 1')[0]['data']


def assignees(client):
    d = crm(client)
    return [c['assignedTo'] for c in d['customers']], [r['assignedTo'] for r in d['records']]


def put(client, path, body):
    r = client.http.open(path, method='PUT', json=body, headers={'Authorization': f'Bearer {client.token}'})
    return r.status_code, r.get_json()


def test_自分の表示名を変えると_顧客と記録の担当者も新しい名前になる(client):
    me = client.sql("SELECT display_name FROM users WHERE username = 'owner'")[0]['display_name']
    set_crm(client, [{'id': 1, 'assignedTo': me}, {'id': 2, 'assignedTo': '別の人'}, {'id': 3, 'assignedTo': ''}],
            [{'id': 10, 'customerId': 1, 'assignedTo': me}, {'id': 11, 'customerId': 2, 'assignedTo': '別の人'}])
    status, body = put(client, '/api/me/name', {'displayName': '新しい名前'})
    assert status == 200 and body['renamed'] == 2
    assert assignees(client) == (['新しい名前', '別の人', ''], ['新しい名前', '別の人'])           # 他の人・未設定は変わらない
    assert client.sql("SELECT COUNT(*) AS n FROM app_state_backups WHERE note LIKE %s", (f'表示名の変更前（{me} → 新しい名前）',))[0]['n'] == 1
    # さらに変えても追従する。同じ名前で保存し直しても何も起きない
    assert put(client, '/api/me/name', {'displayName': '新しい名前'})[1]['renamed'] == 0
    assert put(client, '/api/me/name', {'displayName': 'もう一度'})[1]['renamed'] == 2
    assert assignees(client)[0][0] == 'もう一度'
    put(client, '/api/me/name', {'displayName': me})


def test_管理者がメンバーの表示名を変えても追従し_空白の違いは同じ名前として扱う(client):
    uid = client.add_user('伊藤　太郎')                      # 全角スペース
    set_crm(client, [{'id': 1, 'assignedTo': '伊藤 太郎'}, {'id': 2, 'assignedTo': '伊藤太郎'}, {'id': 3, 'assignedTo': '伊藤次郎'}], [{'id': 10, 'assignedTo': '伊藤 太郎'}])
    status, body = put(client, f'/api/users/{uid}', {'displayName': '伊藤 太郎（営業）'})
    assert status == 200 and body['renamed'] == 3
    assert assignees(client) == (['伊藤 太郎（営業）', '伊藤 太郎（営業）', '伊藤次郎'], ['伊藤 太郎（営業）'])
    # 表示名以外の変更では、付け替えない
    assert put(client, f'/api/users/{uid}', {'department': None})[1]['renamed'] == 0


def test_同じ名前の別メンバーがいるときは取り違えを避けて付け替えない(client):
    a = client.add_user('山田花子')
    client.add_user('山田 花子')                              # 空白違いの同名
    set_crm(client, [{'id': 1, 'assignedTo': '山田花子'}], [])
    status, body = put(client, f'/api/users/{a}', {'displayName': '山田はなこ'})
    assert status == 200 and body['renamed'] == 0
    assert assignees(client)[0] == ['山田花子']
