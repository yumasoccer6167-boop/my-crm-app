"""事前対応（record_type = pre）：訪問前連絡・リスケ・詰め直しNG・リスケ未定のフラグで残す記録。施設の状態・各集計には影響しない"""


def make_company(client, name):
    return client.sql('INSERT INTO telema_companies (company_name, company_name_normalized) VALUES (%s, %s) RETURNING id', (name, name))[0]['id']


def test_事前対応はフラグを選んで残せ_施設の状態と集計は変えない(client):
    cid = make_company(client, '事前対応園')
    before = client.api(f'/companies/{cid}')[1]['company']
    for flag, label in (('precheck', '訪問前連絡'), ('reschedule', 'リスケ'), ('retake_ng', '詰め直しNG'), ('reschedule_tbd', 'リスケ未定')):
        status, r = client.api(f'/companies/{cid}/calls', {'record_type': 'pre', 'pre_result': flag, 'raw_note': f'{label}の連絡', 'called_at': '2027-07-05T01:00:00Z'})
        assert status == 201, r
        assert (r['record_type'], r['pre_result'], r['phone_number'], r['ai_status'], r['result_status_id']) == ('pre', flag, None, 'skipped', None)
    after = client.api(f'/companies/{cid}')[1]['company']
    assert (after['call_count'], after['status_id'], after['last_called_at'], after['next_call_at']) == (before['call_count'], before['status_id'], before['last_called_at'], before['next_call_at'])
    assert [c['pre_result'] for c in client.api(f'/companies/{cid}/calls')[1]] == ['reschedule_tbd', 'retake_ng', 'reschedule', 'precheck']
    # 架電・訪問の集計には入らない
    assert client.api('/teleappt?granularity=month&date=2027-07-05')[1]['totals']['calls'] == 0
    assert client.api('/sales-scorecard?date_from=2027-07-01&date_to=2027-07-31')[0] == 200


def test_事前対応の入力の誤り(client):
    cid = make_company(client, '事前対応チェック園')
    post = lambda **kw: client.api(f'/companies/{cid}/calls', {'raw_note': 'x', **kw})[0]
    assert post(record_type='pre') == 400                                                         # フラグは必須
    assert post(record_type='pre', pre_result='その他') == 400
    assert post(record_type='pre', pre_result='precheck', result_status_id=client.status_id('再コール')) == 400      # 架電の結果は付けられない
    assert post(record_type='pre', pre_result='precheck', next_call_at='2027-08-01T01:00:00Z') == 400
    assert post(record_type='call', pre_result='precheck') == 400                                 # フラグは事前対応だけ
    assert post(record_type='pre', pre_result='precheck', visit_method='visit') == 400
    assert post(record_type='pre', pre_result='reschedule') == 201


def test_事前対応のフラグを直せ_記録の種類も行き来できる(client):
    cid = make_company(client, '事前対応編集園')
    pre = client.api(f'/companies/{cid}/calls', {'record_type': 'pre', 'pre_result': 'precheck', 'raw_note': '前日に連絡'})[1]
    patch = lambda cid_, body: client.api(f'/calls/{cid_}', body, method='PATCH')
    status, r = patch(pre['id'], {'pre_result': 'reschedule_tbd'})
    assert status == 200 and r['pre_result'] == 'reschedule_tbd'
    assert patch(pre['id'], {'pre_result': None})[0] == 400                                        # フラグは外せない
    assert patch(pre['id'], {'result_status_id': client.status_id('再コール')})[0] == 400
    # 事前対応 → 架電：フラグは外れる。架電 → 事前対応：フラグが必要で、架電の結果は外れる
    status, call = patch(pre['id'], {'record_type': 'call'})
    assert status == 200 and (call['record_type'], call['pre_result']) == ('call', None)
    assert patch(pre['id'], {'record_type': 'pre'})[0] == 400
    status, again = patch(pre['id'], {'record_type': 'pre', 'pre_result': 'retake_ng', 'result_status_id': None})
    assert status == 200 and (again['record_type'], again['pre_result']) == ('pre', 'retake_ng')
    # 訪問 → 事前対応 → 訪問
    purposes = {r['name']: r['id'] for r in client.api('/visit-purposes')[1]}
    visit = client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': 'x', 'visit_purpose_id': purposes['営業']})[1]
    status, moved = patch(visit['id'], {'record_type': 'pre', 'pre_result': 'precheck'})
    assert status == 200 and (moved['record_type'], moved['visit_method'], moved['visit_purpose_id']) == ('pre', None, None)
    status, back = patch(visit['id'], {'record_type': 'visit', 'visit_method': 'zoom'})
    assert status == 200 and (back['record_type'], back['pre_result'], back['visit_method']) == ('visit', None, 'zoom')
