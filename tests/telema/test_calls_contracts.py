"""架電履歴の編集と、契約情報（商材・契約日・営業担当）。"""


def make_company(client, name, assigned=None):
    return client.sql(
        'INSERT INTO telema_companies (company_name, company_name_normalized, assigned_user_id) VALUES (%s, %s, %s) RETURNING id',
        (name, name, assigned))[0]['id']


def company(client, cid):
    return client.api(f'/companies/{cid}')[1]['company']


# ---------- 架電履歴の編集 ----------
def test_架電履歴のメモ_日時_結果_相手を直せて最終架電日時が再計算される(client):
    cid = make_company(client, '編集テスト園')
    contact = client.api(f'/companies/{cid}/contacts', {'name': '山田 花子', 'role': '園長'})[1]['id']
    recall, appo = client.status_id('再コール'), client.status_id('時間設定成立')
    old = client.api(f'/companies/{cid}/calls', {'raw_note': '古い架電', 'called_at': '2026-09-01T01:00:00Z'})[1]
    new = client.api(f'/companies/{cid}/calls', {'raw_note': '新しい架電', 'called_at': '2026-09-20T01:00:00Z', 'result_status_id': recall,
                                                'next_call_at': '2026-10-05T01:00:00Z'})[1]
    assert company(client, cid)['last_called_at'] == '2026-09-20T01:00:00.000Z'

    status, row = client.api(f'/calls/{old["id"]}', {
        'raw_note': '古い架電（修正）', 'called_at': '2026-09-25T01:00:00+00:00', 'result_status_id': appo, 'contact_id': contact,
    }, method='PATCH')
    assert status == 200
    assert {'raw_note': '古い架電（修正）', 'called_at': '2026-09-25T01:00:00.000Z', 'result_label': '時間設定成立', 'contact_name': '山田 花子'}.items() <= row.items()
    # 日時を新しい方へ直したので、最終架電日時が追従する。件数は変わらない
    c = company(client, cid)
    assert c['last_called_at'] == '2026-09-25T01:00:00.000Z' and c['call_count'] == 2
    # 会社の現在の状態（ステータス・次回架電）は履歴の修正では動かさない
    assert c['status_id'] == recall and c['next_call_at'] == '2026-10-05T01:00:00.000Z'
    # 履歴は新しい順に並ぶ
    assert [x['id'] for x in client.api(f'/companies/{cid}/calls')[1]] == [old['id'], new['id']]
    log = client.sql("SELECT action, before_json, after_json FROM telema_audit_logs WHERE entity_type = 'call_log' AND entity_id = %s", (old['id'],))
    assert log[-1]['action'] == 'update' and '古い架電' in log[-1]['before_json'] and '修正' in log[-1]['after_json']


def test_メモを直すとAI整理は消えて再整理できる状態に戻る(client):
    cid = make_company(client, 'AIリセット園')
    call = client.api(f'/companies/{cid}/calls', {'raw_note': '最初のメモ'})[1]
    client.sql("UPDATE telema_call_logs SET ai_status = 'done', ai_summary = '古い要約', ai_model = 'm', ai_extracted_json = '{}', ai_next_action = 'x' WHERE id = %s", (call['id'],))

    # メモ以外を直してもAI整理は残る
    status, row = client.api(f'/calls/{call["id"]}', {'called_at': '2026-09-02T01:00:00Z'}, method='PATCH')
    assert status == 200 and row['ai_status'] == 'done' and row['ai_summary'] == '古い要約'

    row = client.api(f'/calls/{call["id"]}', {'raw_note': '直したメモ'}, method='PATCH')[1]
    assert {'raw_note': '直したメモ', 'ai_status': 'pending', 'ai_summary': None, 'ai_next_action': None}.items() <= row.items()
    # メモを空にすると整理対象外（skipped）
    row = client.api(f'/calls/{call["id"]}', {'raw_note': ''}, method='PATCH')[1]
    assert row['ai_status'] == 'skipped'


def test_結果を空に戻せ_変更が無ければ何も書かない(client):
    cid = make_company(client, '空戻しテスト園')
    recall = client.status_id('再コール')
    call = client.api(f'/companies/{cid}/calls', {'raw_note': 'メモ', 'result_status_id': recall})[1]
    status, row = client.api(f'/calls/{call["id"]}', {'result_status_id': None}, method='PATCH')
    assert status == 200 and row['result_status_id'] is None and row['result_label'] is None
    before = len(client.sql("SELECT 1 FROM telema_audit_logs WHERE entity_type = 'call_log' AND entity_id = %s", (call['id'],)))
    assert client.api(f'/calls/{call["id"]}', {'result_status_id': None, 'raw_note': 'メモ'}, method='PATCH')[0] == 200
    assert len(client.sql("SELECT 1 FROM telema_audit_logs WHERE entity_type = 'call_log' AND entity_id = %s", (call['id'],))) == before


def test_架電履歴の編集の入力エラーと存在確認(client):
    cid = make_company(client, '入力エラー園')
    other = make_company(client, '別の園')
    stranger = client.api(f'/companies/{other}/contacts', {'name': '他園の人'})[1]['id']
    call = client.api(f'/companies/{cid}/calls', {'raw_note': 'メモ'})[1]['id']
    assert client.api(f'/calls/{call}', {'called_at': '昨日'}, method='PATCH')[0] == 400
    assert client.api(f'/calls/{call}', {'raw_note': None}, method='PATCH')[0] == 400
    assert client.api(f'/calls/{call}', {'raw_note': 'あ' * 5001}, method='PATCH')[0] == 400
    assert client.api(f'/calls/{call}', {'result_status_id': 999999}, method='PATCH')[0] == 400
    # 別の施設の担当者は選べない
    status, body = client.api(f'/calls/{call}', {'contact_id': stranger}, method='PATCH')
    assert status == 400 and 'この施設の担当者ではありません' in body['error']['message']
    assert client.api('/calls/999999', {'raw_note': 'x'}, method='PATCH')[0] == 404
    # 無効化した履歴は編集できない
    client.api(f'/calls/{call}/deactivate', method='POST')
    assert client.api(f'/calls/{call}', {'raw_note': 'x'}, method='PATCH')[0] == 404


def test_salesは自分の架電だけ直せる(client):
    cid = make_company(client, '権限テスト園')
    mine = client.api(f'/companies/{cid}/calls', {'raw_note': '自分の架電'})[1]['id']
    other_user = client.add_user('別の営業A')
    theirs = client.sql(
        "INSERT INTO telema_call_logs (company_id, user_id, called_at, raw_note) VALUES (%s, %s, '2026-09-01T00:00:00.000Z', '他人の架電') RETURNING id",
        (cid, other_user))[0]['id']
    client.set_my_role('sales')
    try:
        assert client.api(f'/calls/{mine}', {'raw_note': '自分で修正'}, method='PATCH')[0] == 200
        assert client.api(f'/calls/{theirs}', {'raw_note': '他人のを修正'}, method='PATCH')[0] == 403
    finally:
        client.set_my_role('admin')
    assert client.api(f'/calls/{theirs}', {'raw_note': '管理者は直せる'}, method='PATCH')[0] == 200


# ---------- 契約情報 ----------
def test_契約情報を複数登録でき会社詳細に新しい契約日順で返る(client):
    cid = make_company(client, '契約テスト園')
    assert client.api(f'/companies/{cid}')[1]['contracts'] == []
    rep = client.add_user('契約営業')
    status, a = client.api(f'/companies/{cid}/contracts', {'product_name': 'SP', 'contract_date': '2026-08-01', 'assigned_user_id': rep})
    assert status == 201
    assert {'product_name': 'SP', 'contract_date': '2026-08-01', 'assigned_user_id': rep, 'assigned_user_name': '契約営業', 'company_id': cid, 'is_active': 1}.items() <= a.items()
    b = client.api(f'/companies/{cid}/contracts', {'product_name': 'SP-MEO', 'contract_date': '2026-09-15'})[1]
    assert b['assigned_user_id'] is None and b['assigned_user_name'] is None
    assert [c['id'] for c in client.api(f'/companies/{cid}')[1]['contracts']] == [b['id'], a['id']]
    log = client.sql("SELECT action FROM telema_audit_logs WHERE entity_type = 'contract' AND entity_id = %s", (a['id'],))
    assert log == [{'action': 'create'}]


def test_契約情報を直せて削除すると一覧から消える(client):
    cid = make_company(client, '契約編集園')
    rep = client.add_user('新担当')
    c = client.api(f'/companies/{cid}/contracts', {'product_name': 'SP', 'contract_date': '2026-08-01'})[1]
    status, row = client.api(f'/contracts/{c["id"]}', {'product_name': 'SP-MEO', 'contract_date': '2026-08-31', 'assigned_user_id': rep}, method='PATCH')
    assert status == 200
    assert {'product_name': 'SP-MEO', 'contract_date': '2026-08-31', 'assigned_user_id': rep, 'assigned_user_name': '新担当'}.items() <= row.items()
    # 営業担当を空に戻せる
    assert client.api(f'/contracts/{c["id"]}', {'assigned_user_id': None}, method='PATCH')[1]['assigned_user_name'] is None

    assert client.api(f'/contracts/{c["id"]}', {'is_active': False}, method='PATCH')[0] == 200
    assert client.api(f'/companies/{cid}')[1]['contracts'] == []
    # データは残り、操作ログに無効化が記録される
    assert client.sql('SELECT is_active FROM telema_contracts WHERE id = %s', (c['id'],)) == [{'is_active': 0}]
    assert client.sql("SELECT action FROM telema_audit_logs WHERE entity_type = 'contract' AND entity_id = %s ORDER BY id DESC LIMIT 1", (c['id'],)) == [{'action': 'deactivate'}]
    assert client.api(f'/contracts/{c["id"]}', {'product_name': 'x'}, method='PATCH')[0] == 404


def test_契約情報の入力エラー(client):
    cid = make_company(client, '契約入力エラー園')
    url = f'/companies/{cid}/contracts'
    assert client.api(url, {'contract_date': '2026-08-01'})[0] == 400                      # 商材なし
    assert client.api(url, {'product_name': 'SP'})[0] == 400                               # 契約日なし
    assert client.api(url, {'product_name': '  ', 'contract_date': '2026-08-01'})[0] == 400
    assert client.api(url, {'product_name': 'あ' * 101, 'contract_date': '2026-08-01'})[0] == 400
    for bad in ('2026/08/01', '2026-8-1', '2026-02-30', '2026-08-01T00:00:00Z', ''):
        assert client.api(url, {'product_name': 'SP', 'contract_date': bad})[0] == 400, bad
    status, body = client.api(url, {'product_name': 'SP', 'contract_date': '2026-08-01', 'assigned_user_id': 999999})
    assert status == 400 and '営業担当が見つかりません' in body['error']['message']
    assert client.api('/companies/999999/contracts', {'product_name': 'SP', 'contract_date': '2026-08-01'})[0] == 404
    assert client.api(f'/companies/{cid}')[1]['contracts'] == []


def test_salesは自分の担当と未割当の会社にだけ契約を登録でき_営業担当は自分のみ(client):
    me = client.api('/me')[1]['id']
    other = client.add_user('契約の別営業')
    mine = make_company(client, '自分の担当園', assigned=me)
    pool = make_company(client, '未割当園')
    theirs = make_company(client, '他人の担当園', assigned=other)
    client.set_my_role('sales')
    try:
        ok = client.api(f'/companies/{mine}/contracts', {'product_name': 'SP', 'contract_date': '2026-08-01', 'assigned_user_id': me})
        assert ok[0] == 201
        assert client.api(f'/companies/{pool}/contracts', {'product_name': 'SP', 'contract_date': '2026-08-01'})[0] == 201
        # 他人の担当会社は見えない（404）。自分の会社でも営業担当を他人にはできない
        assert client.api(f'/companies/{theirs}/contracts', {'product_name': 'SP', 'contract_date': '2026-08-01'})[0] == 404
        assert client.api(f'/companies/{mine}/contracts', {'product_name': 'SP', 'contract_date': '2026-08-01', 'assigned_user_id': other})[0] == 403
        assert client.api(f'/contracts/{ok[1]["id"]}', {'assigned_user_id': other}, method='PATCH')[0] == 403
    finally:
        client.set_my_role('admin')
    # 管理者は他人の担当会社にも営業担当を指定して登録できる
    assert client.api(f'/companies/{theirs}/contracts', {'product_name': 'SP', 'contract_date': '2026-08-01', 'assigned_user_id': other})[0] == 201


def test_商材の候補はCRMの商材と契約済みの商材(client):
    cid = make_company(client, '商材候補園')
    client.sql(
        "UPDATE app_state SET data = %s::jsonb WHERE id = 1",
        ('{"products": [{"id": 1, "name": "SP-MEO"}, {"id": 2, "name": "SP"}]}',))
    client.api(f'/companies/{cid}/contracts', {'product_name': '旧商材', 'contract_date': '2026-08-01'})
    client.api(f'/companies/{cid}/contracts', {'product_name': 'SP', 'contract_date': '2026-08-02'})
    status, names = client.api('/products')
    assert status == 200 and names[:2] == ['SP-MEO', 'SP'] and '旧商材' in names and names.count('SP') == 1
