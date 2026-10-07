"""記録の種類（架電／訪問）。訪問は方法（訪問／zoom）を持ち、施設の架電に関する状態には影響しない。"""
from datetime import datetime, timedelta, timezone


def make_company(client, name, assigned=None):
    return client.sql(
        'INSERT INTO telema_companies (company_name, company_name_normalized, assigned_user_id, phone) VALUES (%s, %s, %s, %s) RETURNING id',
        (name, name, assigned, '03-0000-0000'))[0]['id']


def company(client, cid):
    return client.api(f'/companies/{cid}')[1]['company']


def visit(client, cid, **kw):
    return client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', **kw})


def test_既存の記録と省略時は架電として扱われる(client):
    cid = make_company(client, '種類テスト園')
    status, row = client.api(f'/companies/{cid}/calls', {'raw_note': '普通の架電'})
    assert status == 201 and row['record_type'] == 'call' and row['visit_method'] is None
    assert row['phone_number'] == '03-0000-0000'


def test_訪問を訪問とzoomで登録でき_一覧で見分けられる(client):
    cid = make_company(client, '訪問テスト園')
    contact = client.api(f'/companies/{cid}/contacts', {'name': '山田 花子', 'role': '園長'})[1]['id']
    a = visit(client, cid, raw_note='園で打ち合わせ', called_at='2026-10-01T01:00:00Z', contact_id=contact)
    b = visit(client, cid, raw_note='オンラインで説明', called_at='2026-10-02T01:00:00Z', visit_method='zoom')
    assert (a[0], b[0]) == (201, 201)
    assert {'record_type': 'visit', 'visit_method': 'visit', 'contact_name': '山田 花子', 'phone_number': None, 'ai_status': 'skipped'}.items() <= a[1].items()
    assert b[1]['visit_method'] == 'zoom'
    rows = {r['raw_note']: r for r in client.api(f'/companies/{cid}/calls')[1]}
    assert rows['園で打ち合わせ']['visit_method'] == 'visit' and rows['オンラインで説明']['visit_method'] == 'zoom'


def test_訪問は方法が必須で_架電専用の項目は付けられない(client):
    cid = make_company(client, '検証園')
    assert client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'raw_note': 'x'})[0] == 400                       # 方法なし
    assert visit(client, cid, raw_note='x', visit_method='phone')[0] == 400                                                  # 選択肢外
    assert client.api(f'/companies/{cid}/calls', {'record_type': 'meeting', 'raw_note': 'x'})[0] == 400                     # 種類が不正
    status, body = visit(client, cid, raw_note='x', result_status_id=client.status_id('再コール'))
    assert status == 400 and '結果' in body['error']['message']
    assert visit(client, cid, raw_note='x', next_call_at='2026-10-05T01:00:00Z')[0] == 400
    # 架電に訪問の方法は付けられない
    assert client.api(f'/companies/{cid}/calls', {'raw_note': 'x', 'visit_method': 'zoom'})[0] == 400
    assert client.sql('SELECT COUNT(*) AS n FROM telema_call_logs WHERE company_id = %s', (cid,))[0]['n'] == 0


def test_訪問は施設の架電の状態を変えない(client):
    cid = make_company(client, '状態不変園')
    recall = client.status_id('再コール')
    client.api(f'/companies/{cid}/calls', {'raw_note': '架電', 'called_at': '2026-09-01T01:00:00Z', 'result_status_id': recall,
                                          'next_call_at': '2026-10-05T01:00:00Z'})
    before = company(client, cid)
    assert visit(client, cid, raw_note='訪問', called_at='2026-09-20T01:00:00Z')[0] == 201
    after = company(client, cid)
    for k in ('call_count', 'last_called_at', 'status_id', 'next_call_at', 'assigned_user_id'):
        assert after[k] == before[k], k
    assert after['call_count'] == 1 and after['last_called_at'] == '2026-09-01T01:00:00.000Z'


def test_訪問の編集_無効化でも架電の件数と最終架電日時は動かない(client):
    cid = make_company(client, '編集園')
    client.api(f'/companies/{cid}/calls', {'raw_note': '架電', 'called_at': '2026-09-01T01:00:00Z'})
    v = visit(client, cid, raw_note='訪問', called_at='2026-09-10T01:00:00Z')[1]
    status, row = client.api(f'/calls/{v["id"]}', {'visit_method': 'zoom', 'raw_note': 'オンラインに変更', 'called_at': '2026-09-15T01:00:00Z'}, method='PATCH')
    assert status == 200 and row['visit_method'] == 'zoom' and row['raw_note'] == 'オンラインに変更' and row['record_type'] == 'visit'
    assert client.api(f'/calls/{v["id"]}', {'result_status_id': client.status_id('再コール')}, method='PATCH')[0] == 400
    assert client.api(f'/calls/{v["id"]}', {'visit_method': 'phone'}, method='PATCH')[0] == 400
    c = company(client, cid)
    assert c['call_count'] == 1 and c['last_called_at'] == '2026-09-01T01:00:00.000Z'
    assert client.api(f'/calls/{v["id"]}/deactivate', {})[0] == 200
    c = company(client, cid)
    assert c['call_count'] == 1 and c['last_called_at'] == '2026-09-01T01:00:00.000Z'
    assert [r['record_type'] for r in client.api(f'/companies/{cid}/calls')[1]] == ['call']


def test_架電の記録は種類も方法も変えられない(client):
    cid = make_company(client, '架電編集園')
    call = client.api(f'/companies/{cid}/calls', {'raw_note': '架電'})[1]
    assert client.api(f'/calls/{call["id"]}', {'visit_method': 'zoom'}, method='PATCH')[0] == 400
    row = client.api(f'/calls/{call["id"]}', {'record_type': 'visit', 'raw_note': '直した'}, method='PATCH')[1]
    assert row['record_type'] == 'call' and row['raw_note'] == '直した'          # record_type は無視される


def test_訪問は集計に入らずAI整理もできない(client):
    cid = make_company(client, '集計園')
    now = datetime.now(timezone.utc)
    before = client.api('/dashboard')[1]['calls_today']['calls_today']
    v = visit(client, cid, raw_note='訪問', called_at=now.isoformat())[1]
    assert client.api('/dashboard')[1]['calls_today']['calls_today'] == before
    status, body = client.api(f'/calls/{v["id"]}/analyze', {})
    assert status == 400 and '訪問' in body['error']['message']

    m0 = sum(r['calls'] for r in client.api('/dashboard/calls-monthly?months=1')[1]['rows'])
    visit(client, cid, raw_note='もう1件', called_at=(now - timedelta(minutes=1)).isoformat(), visit_method='zoom')
    assert sum(r['calls'] for r in client.api('/dashboard/calls-monthly?months=1')[1]['rows']) == m0
    client.api(f'/companies/{cid}/calls', {'raw_note': '架電'})
    assert sum(r['calls'] for r in client.api('/dashboard/calls-monthly?months=1')[1]['rows']) == m0 + 1


def test_訪問にも部署が付けられ_営業は担当外の施設に記録できない(client):
    cid = make_company(client, '部署園')
    sec = next(s['id'] for s in client.api('/sections')[1] if s['name'] == '営業部')
    row = visit(client, cid, raw_note='営業の訪問', section_id=sec)[1]
    assert row['section_name'] == '営業部'

    other = client.add_user('別の営業', 'sales')
    mine = make_company(client, '他人の施設', assigned=other)
    client.set_my_role('sales')
    try:
        assert visit(client, mine, raw_note='x')[0] in (403, 404)
    finally:
        client.set_my_role('admin')


def test_架電を直したり無効化したりしても_再計算に訪問は混ざらない(client):
    cid = make_company(client, '再計算園')
    a = client.api(f'/companies/{cid}/calls', {'raw_note': '架電1', 'called_at': '2026-09-01T01:00:00Z'})[1]
    b = client.api(f'/companies/{cid}/calls', {'raw_note': '架電2', 'called_at': '2026-09-02T01:00:00Z'})[1]
    visit(client, cid, raw_note='訪問', called_at='2026-09-30T01:00:00Z')
    client.api(f'/calls/{a["id"]}', {'called_at': '2026-09-03T01:00:00Z'}, method='PATCH')
    c = company(client, cid)
    assert c['call_count'] == 2 and c['last_called_at'] == '2026-09-03T01:00:00.000Z'
    client.api(f'/calls/{a["id"]}/deactivate', {})
    c = company(client, cid)
    assert c['call_count'] == 1 and c['last_called_at'] == '2026-09-02T01:00:00.000Z'
    client.api(f'/calls/{b["id"]}/deactivate', {})
    c = company(client, cid)
    assert c['call_count'] == 0 and c['last_called_at'] is None
