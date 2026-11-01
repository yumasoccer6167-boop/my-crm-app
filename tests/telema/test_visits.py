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


def test_訪問記録に訪問の内容を付けられ_設定で増やせる(client):
    cid = client.sql("INSERT INTO telema_companies (company_name, company_name_normalized) VALUES ('訪問内容園', '訪問内容園') RETURNING id")[0]['id']
    status, rows = client.api('/visit-purposes')
    assert status == 200 and [r['name'] for r in rows] == ['ユーザー訪問', '初回訪問', '営業']
    first = next(r['id'] for r in rows if r['name'] == '初回訪問')
    status, v = client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': '面談', 'visit_purpose_id': first})
    assert status == 201 and v['visit_purpose_id'] == first and v['visit_purpose_name'] == '初回訪問'
    assert client.api(f'/companies/{cid}/calls')[1][0]['visit_purpose_name'] == '初回訪問'
    # 付けなくても保存できる。架電には付けられない
    assert client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'zoom', 'raw_note': 'zoom'})[1]['visit_purpose_id'] is None
    call = client.api(f'/companies/{cid}/calls', {'raw_note': '架電'})[1]
    assert client.api(f'/companies/{cid}/calls', {'raw_note': '架電', 'visit_purpose_id': first})[0] == 400
    assert client.api(f'/calls/{call["id"]}', {'visit_purpose_id': first}, method='PATCH')[0] == 400
    assert client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'visit_purpose_id': 999999})[0] == 400
    # 編集で変えられる・外せる
    sales = next(r['id'] for r in rows if r['name'] == '営業')
    assert client.api(f'/calls/{v["id"]}', {'visit_purpose_id': sales}, method='PATCH')[1]['visit_purpose_name'] == '営業'
    assert client.api(f'/calls/{v["id"]}', {'visit_purpose_id': None}, method='PATCH')[1]['visit_purpose_id'] is None
    # 設定で追加・無効化。無効にした内容は新しく選べないが、すでに付いている記録には残る
    new = client.api('/visit-purposes', {'name': '調査訪問'})[1]
    v2 = client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'visit_purpose_id': new['id']})[1]
    assert client.api(f'/visit-purposes/{new["id"]}', {'is_active': False}, method='PATCH')[1]['is_active'] == 0
    assert client.api(f'/calls/{v2["id"]}', {'raw_note': '直した'}, method='PATCH')[1]['visit_purpose_name'] == '調査訪問'
    assert client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'visit_purpose_id': new['id']})[0] == 400
    client.set_my_role('manager')
    try:
        assert client.api('/visit-purposes', {'name': '管理者以外'})[0] == 403
    finally:
        client.set_my_role('admin')


def test_訪問ステータスは架電のステータスとは別で_一覧とカルテに出て_絞り込める(client):
    def make(name):
        return client.sql("INSERT INTO telema_companies (company_name, company_name_normalized, search_text) VALUES (%s, %s, %s) RETURNING id", (name, name, name))[0]['id']

    purposes = {r['name']: r['id'] for r in client.api('/visit-purposes')[1]}
    visit = lambda cid, purpose, **kw: client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': '面談', 'visit_purpose_id': purposes.get(purpose), **kw})[1]
    a, b, c, d = (make(f'訪問ステータス園{x}') for x in 'ABCD')
    recall = client.status_id('再コール')
    client.api(f'/companies/{a}/calls', {'raw_note': '架電', 'result_status_id': recall})
    old = visit(a, '初回訪問', called_at='2026-09-01T01:00:00Z')
    visit(a, '営業', called_at='2026-09-02T01:00:00Z')                       # 一番新しい訪問の内容が、訪問ステータスになる
    visit(b, '初回訪問')
    visit(c, None)                                                              # 内容を付けない訪問は、訪問ステータスにならない
    client.api(f'/companies/{d}/calls', {'raw_note': '架電のみ'})
    by_name = lambda q='訪問ステータス園': {i['company_name'][-1]: i for i in client.api(f'/companies?q={q}&per_page=50')[1]['items']}
    items = by_name()
    assert {k: v['visit_purpose_name'] for k, v in items.items()} == {'A': '営業', 'B': '初回訪問', 'C': None, 'D': None}
    assert items['A']['status_label'] == '再コール'                           # 架電のステータスは、訪問では変わらない
    assert items['B']['status_label'] is None
    assert client.api(f'/companies/{a}')[1]['company']['visit_purpose_name'] == '営業'
    assert client.api(f'/companies/{d}')[1]['company']['visit_purpose_name'] is None
    # 絞り込み：訪問の内容ごと・訪問なし（未設定）
    names = lambda qs: sorted(i['company_name'][-1] for i in client.api(f'/companies?q=訪問ステータス園&per_page=50&{qs}')[1]['items'])
    assert names(f"visit_purpose={purposes['営業']}") == ['A'] and names(f"visit_purpose={purposes['初回訪問']}") == ['B']
    assert names('visit_purpose=none') == ['C', 'D']
    assert client.api('/companies?visit_purpose=abc')[0] == 400
    # 一番新しい訪問を無効にすると、その前の訪問の内容に戻る。マイページ（ダッシュボード）の一覧にも出る
    latest = next(x for x in client.api(f'/companies/{a}/calls')[1] if x['visit_purpose_name'] == '営業')
    assert client.api(f'/calls/{latest["id"]}/deactivate', {})[0] == 200 and by_name()['A']['visit_purpose_name'] == '初回訪問' and old['id']
    from datetime import datetime, timedelta, timezone
    client.sql('UPDATE telema_companies SET next_call_at = %s WHERE id = %s', ((datetime.now(timezone.utc) - timedelta(days=1)).isoformat(), a))
    assert {i['company_name'][-1]: i['visit_purpose_name'] for i in client.api('/dashboard')[1]['today']}['A'] == '初回訪問'


def test_訪問の内容が営業のとき_商材_月額_期間を残せる(client):
    cid = client.sql("INSERT INTO telema_companies (company_name, company_name_normalized) VALUES ('営業内容園', '営業内容園') RETURNING id")[0]['id']
    purposes = {r['name']: r['id'] for r in client.api('/visit-purposes')[1]}
    product = client.api('/products')[1][0] if client.api('/products')[1] else 'SP'
    sales = {'sales_product': product, 'sales_monthly_fee': 9800, 'sales_term': '36'}
    post = lambda purpose, **kw: client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': '提案', 'visit_purpose_id': purposes[purpose], **kw})
    status, v = post('営業', **sales)
    assert status == 201 and {k: v[k] for k in sales} == sales
    assert client.api(f'/companies/{cid}/calls')[1][0]['sales_monthly_fee'] == 9800
    assert post('営業', sales_term='cash')[1]['sales_term'] == 'cash'                          # 現金一括
    assert all(post('営業', sales_term=t)[0] == 201 for t in ('12', '24', '36', '48', '60', '72', '84'))
    assert post('営業', sales_term='6')[0] == 400 and post('営業', sales_term='120')[0] == 400    # 期間は決まった選択肢だけ
    assert post('営業', sales_monthly_fee=-1)[0] == 400
    assert post('営業')[1]['sales_product'] is None                                            # 何も入れなくても保存できる
    # 営業以外の訪問記録・架電には付けられない
    assert post('初回訪問', **sales)[0] == 400
    assert client.api(f'/companies/{cid}/calls', {'raw_note': '架電', **sales})[0] == 400
    # 編集：内容を直せる。営業以外に直すと、営業の内容は外れる。営業以外の記録に後から付けることはできない
    assert client.api(f'/calls/{v["id"]}', {'sales_monthly_fee': 12000, 'sales_term': '60'}, method='PATCH')[1]['sales_monthly_fee'] == 12000
    row = client.api(f'/calls/{v["id"]}', {'visit_purpose_id': purposes['初回訪問']}, method='PATCH')[1]
    assert row['sales_product'] is None and row['sales_monthly_fee'] is None and row['sales_term'] is None
    assert client.api(f'/calls/{v["id"]}', {'sales_term': '12'}, method='PATCH')[0] == 400
    assert client.api(f'/calls/{v["id"]}', {'visit_purpose_id': purposes['営業'], 'sales_term': 'cash', 'sales_monthly_fee': 0}, method='PATCH')[1]['sales_term'] == 'cash'


def test_営業の結果を残せ_即決受注は契約情報に自動で登録され_返事待ちと再営業は次回日時を持つ(client):
    cid = make_company(client, '営業結果園')
    purposes = {r['name']: r['id'] for r in client.api('/visit-purposes')[1]}
    post = lambda **kw: client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': '提案', 'visit_purpose_id': purposes['営業'], **kw})
    contracts = lambda: client.api(f'/companies/{cid}')[1]['contracts']
    assert contracts() == []

    # 即決受注：商材が必要。受注金額・粗利・台数が契約情報に入る（日付は訪問日のJST）
    assert post(sales_result='won')[0] == 400
    status, won = post(sales_result='won', sales_product='SP-結果', sales_amount=480000, sales_gross_profit=150000, sales_units=2, called_at='2026-10-05T16:00:00Z')
    assert status == 201 and (won['sales_result'], won['sales_amount'], won['sales_gross_profit'], won['sales_units']) == ('won', 480000, 150000, 2)
    (ct,) = contracts()
    assert (ct['product_name'], ct['contract_date'], ct['amount'], ct['gross_profit'], ct['units'], ct['source_call_id'], ct['can_edit']) == ('SP-結果', '2026-10-06', 480000, 150000, 2, won['id'], True)

    # 記録を直すと契約にも反映され、二重には登録されない
    client.api(f'/calls/{won["id"]}', {'sales_gross_profit': 200000, 'sales_units': 3}, method='PATCH')
    (ct,) = contracts()
    assert (ct['gross_profit'], ct['units']) == (200000, 3)
    # 即決受注以外に直しても契約は残るが、受注金額などは外れる
    row = client.api(f'/calls/{won["id"]}', {'sales_result': 'ng'}, method='PATCH')[1]
    assert (row['sales_result'], row['sales_amount'], row['sales_gross_profit'], row['sales_units']) == ('ng', None, None, None) and len(contracts()) == 1
    # 契約を画面から外したあとは、記録を直しても作り直さない
    client.api(f'/contracts/{ct["id"]}', {'is_active': False}, method='PATCH')
    client.api(f'/calls/{won["id"]}', {'sales_result': 'won', 'sales_amount': 1}, method='PATCH')
    assert contracts() == []

    # 返事待ち・再営業は次回日時を付けられる。それ以外の結果には付けられない
    waiting = post(sales_result='waiting', sales_followup_at='2026-11-01T01:00:00Z')
    assert waiting[0] == 201 and waiting[1]['sales_followup_at'] == '2026-11-01T01:00:00.000Z'
    assert post(sales_result='resales', sales_followup_at='2026-11-02T01:00:00Z')[0] == 201
    assert post(sales_result='ng', sales_followup_at='2026-11-02T01:00:00Z')[0] == 400
    assert post(sales_result='waiting', sales_amount=1)[0] == 400                                   # 受注金額などは即決受注だけ
    assert post(sales_result='unknown')[0] == 400
    # 結果を変えると、前の結果の次回日時は外れる
    assert client.api(f'/calls/{waiting[1]["id"]}', {'sales_result': 'ng'}, method='PATCH')[1]['sales_followup_at'] is None
    # 営業以外の訪問・架電には付けられない
    assert client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': 'x', 'visit_purpose_id': purposes['初回訪問'], 'sales_result': 'ng'})[0] == 400
    assert client.api(f'/companies/{cid}/calls', {'raw_note': '架電', 'sales_result': 'ng'})[0] == 400

    # 即決受注の記録を削除（無効化）すると、自動で作った契約も外れる
    again = post(sales_result='won', sales_product='SP-結果2', called_at='2026-10-07T01:00:00Z')[1]
    assert len(contracts()) == 1
    client.api(f'/calls/{again["id"]}/deactivate', {})
    assert contracts() == []


def test_契約情報に受注金額_粗利_台数を登録できる(client):
    cid = make_company(client, '契約金額園')
    status, ct = client.api(f'/companies/{cid}/contracts', {'product_name': 'SP', 'contract_date': '2026-10-01', 'amount': 300000, 'gross_profit': 90000, 'units': 1})
    assert (status, ct['amount'], ct['gross_profit'], ct['units']) == (201, 300000, 90000, 1)
    assert client.api(f'/contracts/{ct["id"]}', {'units': None}, method='PATCH')[1]['units'] is None
    assert client.api(f'/contracts/{ct["id"]}', {'amount': -1}, method='PATCH')[0] == 400


def test_初回訪問の結果として営業時間設定と見込みなしを残せ_営業の日時は営業時間設定だけに付く(client):
    cid = make_company(client, '初回結果園')
    p = {r['name']: r['id'] for r in client.api('/visit-purposes')[1]}
    post = lambda purpose='初回訪問', **kw: client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': 'visit', 'raw_note': '初回', 'visit_purpose_id': p[purpose], **kw})
    status, a = post(first_result='scheduled', first_followup_at='2026-11-20T01:00:00Z')
    assert status == 201 and (a['first_result'], a['first_followup_at']) == ('scheduled', '2026-11-20T01:00:00.000Z')
    b = post(first_result='no_prospect')[1]
    assert (b['first_result'], b['first_followup_at']) == ('no_prospect', None)
    assert post()[1]['first_result'] is None                                                            # 結果は任意
    assert post(first_result='no_prospect', first_followup_at='2026-11-20T01:00:00Z')[0] == 400         # 営業の日時は営業時間設定だけ
    assert post(first_result='other')[0] == 400
    assert post('営業', first_result='scheduled')[0] == 400 and post('ユーザー訪問', first_result='no_prospect')[0] == 400    # 初回訪問以外には付けられない
    assert client.api(f'/companies/{cid}/calls', {'raw_note': '架電', 'first_result': 'no_prospect'})[0] == 400
    # 編集：結果を見込みなしに直すと営業の日時は外れる。初回訪問以外の内容に直すと結果も外れる
    row = client.api(f'/calls/{a["id"]}', {'first_result': 'no_prospect'}, method='PATCH')[1]
    assert (row['first_result'], row['first_followup_at']) == ('no_prospect', None)
    row = client.api(f'/calls/{a["id"]}', {'first_result': 'scheduled', 'first_followup_at': '2026-11-21T01:00:00Z'}, method='PATCH')[1]
    assert row['first_followup_at'] == '2026-11-21T01:00:00.000Z'
    row = client.api(f'/calls/{a["id"]}', {'visit_purpose_id': p['営業']}, method='PATCH')[1]
    assert (row['first_result'], row['first_followup_at']) == (None, None)
    # 初回訪問結果管理に出て、結果で絞り込める
    items = client.api('/sales-results?kind=first&result=no_prospect')[1]['items']
    assert any(i['id'] == b['id'] and i['first_result'] == 'no_prospect' for i in items)
    assert client.api('/sales-results?kind=first&result=won')[0] == 400
