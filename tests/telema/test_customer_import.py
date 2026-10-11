"""CRM本体の顧客リスト（app_state）をテレマリストへ取り込む（管理者）。"""
import json


def set_crm(client, customers, records=()):
    client.sql('''INSERT INTO app_state (id, data) VALUES (1, %s::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data''',
               (json.dumps({'customers': customers, 'records': list(records)}, ensure_ascii=False),))


def customer(cid, en, gk='', **kw):
    return {'id': cid, 'enName': en, 'gakuenName': gk, 'tel': '', 'address': '', 'assignedTo': '', 'linkedCustomerIds': [], 'rejected': False, **kw}


def run(client, apply=False, **kw):
    status, body = client.api('/admin/customer-import', {'apply': apply, **kw})
    assert status == 200, body
    return body


def run_all(client, apply):
    total, after = {}, None
    while True:
        r = run(client, apply, after_id=after, limit=2)
        for k in ('processed', 'created', 'merged', 'calls', 'visits', 'contracts'):
            total[k] = total.get(k, 0) + r[k]
        total.setdefault('review', []).extend(r['review'])
        after = r['next_after_id']
        if r['done']:
            return total


def company(client, name):
    rows = client.sql('SELECT * FROM telema_companies WHERE company_name = %s AND is_active = 1 ORDER BY id', (name,))
    return rows[0] if rows else None


def test_顧客と記録が施設_タイムライン_契約情報として取り込まれる(client):
    rep = client.add_user('取込営業')
    set_crm(client, [customer(9100000000001, 'つくし保育園', '社会福祉法人つくし会', tel='042-111-2222', address='東京都八王子市1-1-1', industry='保育園',
                              associationType='取込協会A、取込協会B', chairman='山田 理事長', principal='鈴木 園長', email='a@example.com', hpLink='https://tsukushi.example.com',
                              assignedTo='取込営業', reviewScore='4.2', reviewCount='30', instagram='https://instagram.com/x', rejected=True)],
            [{'id': 9200000000001, 'customerId': 9100000000001, 'type': 'テレアポ', 'flag': '再コール', 'date': '2026-09-01', 'time': '10:30', 'memo': '不在でした',
              'assignedTo': '取込営業', 'scheduledDate': '2026-10-20', 'scheduledTime': '15:00', 'recallDone': False},
             {'id': 9200000000002, 'customerId': 9100000000001, 'type': 'テレアポ', 'flag': '時間設定（代表）', 'date': '2026-09-05', 'time': '11:00', 'memo': '訪問が決まった'},
             {'id': 9200000000003, 'customerId': 9100000000001, 'type': '初回訪問', 'flag': '営業時間設定', 'date': '2026-09-10', 'time': '14:00', 'memo': '園長と面談'},
             {'id': 9200000000004, 'customerId': 9100000000001, 'type': '受注登録', 'flag': '受注', 'date': '2026-09-20', 'time': '', 'memo': '', 'productName': 'Site Premium', 'assignedTo': '取込営業'},
             {'id': 9200000000005, 'customerId': 9100000000001, 'type': 'テレアポ', 'flag': '再コール', 'date': 'bad-date', 'memo': '日付が読めない'}])

    dry = run(client, False)
    assert company(client, 'つくし保育園') is None and client.sql('SELECT COUNT(*) AS n FROM telema_crm_links')[0]['n'] == 0     # 確認だけでは何も残らない
    real = run(client, True)
    assert {k: real[k] for k in ('created', 'merged', 'calls', 'visits', 'contracts', 'skipped_records')} == {k: dry[k] for k in ('created', 'merged', 'calls', 'visits', 'contracts', 'skipped_records')}
    assert (real['created'], real['calls'], real['visits'], real['contracts'], real['skipped_records']) == (1, 2, 1, 1, 1)

    co = company(client, 'つくし保育園')
    assert {'phone': '042-111-2222', 'industry': '保育園', 'is_user': 1, 'assigned_user_id': rep, 'website': 'https://tsukushi.example.com', 'google_rating': 4.2,
            'google_review_count': 30, 'call_count': 2}.items() <= co.items()
    assert '顧客リストで「拒否」マークあり' in co['notes'] and 'instagram.com/x' in co['notes']
    assert client.sql('SELECT name FROM telema_organizations WHERE id = %s', (co['organization_id'],))[0]['name'] == '社会福祉法人つくし会'
    assert sorted(r['name'] for r in client.sql('SELECT t.name FROM telema_company_associations a JOIN telema_associations t ON t.id = a.association_id WHERE a.company_id = %s', (co['id'],))) == ['取込協会A', '取込協会B']
    contacts = {r['role']: r for r in client.sql('SELECT name, role, email, is_decision_maker FROM telema_contacts WHERE company_id = %s', (co['id'],))}
    assert contacts['理事長']['name'] == '山田 理事長' and contacts['園長']['email'] == 'a@example.com' and contacts['理事長']['email'] is None

    logs = client.api(f'/companies/{co["id"]}/calls')[1]
    by_note = {l['raw_note'].split('\n')[1] if '\n' in l['raw_note'] else l['raw_note']: l for l in logs}
    assert by_note['不在でした']['called_at'] == '2026-09-01T01:30:00.000Z'                 # 日本時間 → UTC
    assert by_note['訪問が決まった']['result_label'] == '時間設定成立' and by_note['訪問が決まった']['record_type'] == 'call'
    assert by_note['園長と面談']['record_type'] == 'visit' and by_note['園長と面談']['visit_method'] == 'visit'
    assert '［顧客リストから：テレアポ／再コール］' in by_note['不在でした']['raw_note']
    assert co['last_called_at'] == '2026-09-05T02:00:00.000Z'
    assert co['status_id'] == client.status_id('時間設定成立') and co['next_call_at'] == '2026-10-20T06:00:00.000Z'
    ct = client.api(f'/companies/{co["id"]}')[1]['contracts']
    assert [(c['product_name'], c['contract_date'], c['assigned_user_name']) for c in ct] == [('Site Premium', '2026-09-20', '取込営業')]

    again = run(client, True)                                                               # 何度実行しても二重に取り込まない
    assert (again['processed'], again['calls'], again['visits'], again['contracts']) == (0, 0, 0, 0)
    assert client.sql('SELECT COUNT(*) AS n FROM telema_companies WHERE company_name = %s', ('つくし保育園',))[0]['n'] == 1
    crm_customers, crm_records = client.sql("SELECT data->'customers' AS c, data->'records' AS r FROM app_state WHERE id = 1")[0].values()
    set_crm(client, crm_customers, [*crm_records, {'id': 9200000000009, 'customerId': 9100000000001, 'type': 'テレアポ', 'flag': 'NG', 'date': '2026-10-01', 'time': '09:00', 'memo': '新しい記録'}])
    again = run(client, True)                                                               # 取り込み済みの顧客に増えた記録だけが足される（顧客は増えない）
    assert (again['processed'], again['created'], again['merged'], again['calls']) == (1, 0, 0, 1)
    assert client.sql('SELECT COUNT(*) AS n FROM telema_companies WHERE company_name = %s', ('つくし保育園',))[0]['n'] == 1
    assert client.api(f'/companies/{co["id"]}')[1]['company']['call_count'] == 3
    assert company(client, 'つくし保育園')['status_id'] == client.status_id('時間設定成立')      # すでに入っているステータスは変えない


def test_既存施設には空欄だけを補い_名前が違えば別施設として作る(client):
    existing = client.sql(
        '''INSERT INTO telema_companies (company_name, company_name_normalized, phone, phone_normalized, address, address_normalized, industry)
           VALUES ('ひまわり幼稚園', 'ひまわり幼稚園', '03-5555-0001', '0355550001', '東京都新宿区2-2-2', '東京都新宿区2-2-2', '幼稚園') RETURNING id''')[0]['id']
    set_crm(client, [
        customer(9100000000011, 'ひまわり幼稚園', '学校法人ひまわり学園', tel='03-5555-0001', address='東京都新宿区2-2-2', industry='こども園', hpLink='https://himawari.example.com', associationType='既存協会'),
        customer(9100000000012, '別名の保育所', '', tel='03-5555-0001', address='東京都新宿区9-9-9'),      # 電話は同じだが名前が違う → 別施設
    ])
    r = run(client, True)
    assert (r['merged'], r['created']) == (1, 1)
    co = client.sql('SELECT * FROM telema_companies WHERE id = %s', (existing,))[0]
    assert co['industry'] == '幼稚園'                                  # 既存の値は上書きしない
    assert co['website'] == 'https://himawari.example.com' and co['organization_id'] is not None      # 空欄は補う
    assert company(client, '別名の保育所')['id'] != existing
    assert client.sql('SELECT company_id FROM telema_crm_links WHERE crm_customer_id = 9100000000011')[0]['company_id'] == existing


def test_決められない候補は要確認にして取り込まず_紐づけはつながりになる(client):
    for i in (1, 2):
        client.sql('''INSERT INTO telema_companies (company_name, company_name_normalized, phone, phone_normalized, address_normalized)
                      VALUES (%s, %s, '03-7777-0001', '0377770001', '東京都港区1-1-1')''', (f'さくら保育園{"" if i == 1 else " "}', 'さくら保育園'))
    set_crm(client, [
        customer(9100000000021, 'さくら保育園', tel='03-7777-0001', address='東京都港区1-1-1'),
        customer(9100000000022, 'たんぽぽ園', tel='06-1111-0001', linkedCustomerIds=[9100000000023]),
        customer(9100000000023, 'れんげ園', tel='06-1111-0002'),
    ])
    r = run_all(client, True)
    assert [(x['crm_id'], x['reason']) for x in r['review']] == [(9100000000021, '電話・住所が同じで名前も似ている施設が2件ある')]
    assert client.sql('SELECT COUNT(*) AS n FROM telema_crm_links WHERE crm_customer_id = 9100000000021')[0]['n'] == 0
    a, b = company(client, 'たんぽぽ園')['id'], company(client, 'れんげ園')['id']
    rel = client.sql('SELECT label FROM telema_company_relations WHERE company_a_id = %s AND company_b_id = %s AND is_active = 1', (min(a, b), max(a, b)))
    assert [x['label'] for x in rel] == ['顧客リストの紐づけ']


def test_管理者だけが実行でき_概要で件数が分かる(client):
    set_crm(client, [customer(9100000000031, '概要園', tel='03-0000-0031')], [{'id': 9200000000031, 'customerId': 9100000000031, 'type': 'テレアポ', 'date': '2026-09-01'}])
    s = client.api('/admin/customer-import')[1]
    assert (s['customers'], s['imported_customers'], s['records'], s['imported_records']) == (1, 0, 1, 0)
    run(client, True)
    s = client.api('/admin/customer-import')[1]
    assert (s['imported_customers'], s['imported_records']) == (1, 1)
    for role in ('manager', 'sales'):
        client.set_my_role(role)
        try:
            assert client.api('/admin/customer-import')[0] == 403
            assert client.api('/admin/customer-import', {'apply': False})[0] == 403
        finally:
            client.set_my_role('admin')
