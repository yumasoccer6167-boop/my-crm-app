"""日報の自動作成。他のテストと重ならない先の月（2027-05）を使う"""


def make_company(client, name):
    return client.sql('INSERT INTO telema_companies (company_name, company_name_normalized) VALUES (%s, %s) RETURNING id', (name, name))[0]['id']


def me(client):
    return client.sql("SELECT id, display_name FROM users WHERE username = 'owner'")[0]


def test_日報はフォーマットの数値を記録から入れる(client):
    p = {r['name']: r['id'] for r in client.api('/visit-purposes')[1]}
    owner = me(client)
    b, c, dd, e = (make_company(client, f'日報園{x}') for x in 'BCDE')
    visit = lambda cid, method, **kw: client.api(f'/companies/{cid}/calls', {'record_type': 'visit', 'visit_method': method, 'raw_note': 'x', 'visit_purpose_id': p['営業'], **kw})
    day = '2027-05-12'                                                                                     # 水曜。5月の稼働日は21日、5/12は8日目
    # 目標 200P / 5台
    assert client.api(f'/targets/{owner["id"]}/2027-05', {'gross_profit': 2000000, 'units': 5}, method='PUT')[0] == 200
    # 営業3件（訪問2・zoom1）。訪問Bは即決受注（8P・2台）、zoom Cは NG、訪問Dは返事待ち→後でNG（元の訪問に数える）
    assert visit(b, 'visit', called_at=f'{day}T02:00:00Z', sales_result='won', sales_product='SP日報', sales_amount=240000, sales_gross_profit=80000, sales_units=2)[0] == 201
    assert visit(c, 'zoom', called_at='2027-05-10T02:00:00Z', sales_result='ng')[0] == 201
    waiting = visit(dd, 'visit', called_at='2027-05-11T02:00:00Z', sales_result='waiting', sales_followup_at='2027-05-20T02:00:00Z')[1]
    assert client.api(f'/companies/{dd}/calls', {'record_type': 'reply', 'raw_note': '返事', 'sales_result': 'ng', 'reply_to_id': waiting['id'], 'called_at': f'{day}T03:00:00Z'})[0] == 201
    # 翌稼働日（5/13 木）の訪問予定
    client.sql('UPDATE telema_companies SET assigned_user_id = %s WHERE id = %s', (owner['id'], e))
    client.api(f'/companies/{e}/calls', {'raw_note': 'x', 'result_status_id': client.status_id('初回訪問時間設定'), 'visit_at': '2027-05-13T06:00:00Z'})

    status, r = client.api(f'/daily-report?date={day}&dept=特販2課')
    assert status == 200 and r['next_workday'] == '2027-05-13' and r['plans'] == 1 and r['user_ids'] == [owner['id']]
    name = owner['display_name'].replace('　', ' ').split(' ')[0]
    assert r['text'] == f'''5/12_特販2課 最終

累計稼働　8日目(総稼動21日）
本日受注 　日報園B SP日報 8P/2台
営業予算　200P/5台
累計必要数 76P/2台
実数 8P/2台
達成率　10.5%/100.0%

累計営業件数3件
（訪問2、zoom1）
累計受注件数1
（訪問1、zoom0）
営業落ち率 67%
（訪問 50%、zoom 100%）

翌アポ　1件
{name}　15:00 日報園E

以上
'''
    # 休みにすると稼働日の数が変わる。翌稼働日は木曜を休みにすると金曜
    client.api(f'/workdays/{owner["id"]}/2027-05-13', {'is_workday': False}, method='PUT')
    assert client.api(f'/daily-report?date={day}')[1]['next_workday'] == '2027-05-14'
    # 受注のない日は「なし」、目標のない月は「未設定」
    t = client.api('/daily-report?date=2027-06-01')[1]['text']
    assert '本日受注 　なし' in t and '営業予算　未設定' in t and t.startswith('6/1 最終')
    assert client.api('/daily-report?date=2027-5-1')[0] == 400
    assert client.api('/daily-report?user_ids=abc')[0] == 400
    assert client.api('/daily-report?user_ids=999999')[0] == 400
