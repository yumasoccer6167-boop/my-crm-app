"""マイルール（マイページの3ページ目）：フラグ・ルールの内容・期待できる成果。自分の分だけ"""


def test_マイルールを追加_直す_削除でき_フラグの順に並ぶ(client):
    api = client.api
    status, r = api('/my-rules')
    assert status == 200 and r['flags'] == ['テレアポ', '商談', '稼働', '営業マン像'] and r['items'] == []
    a = api('/my-rules', {'flag': '営業マン像', 'rule': '約束の時間は10分前に着く', 'outcome': '信頼される'})
    b = api('/my-rules', {'flag': 'テレアポ', 'rule': '朝イチは30件かける'})                                  # 期待できる成果は省略できる
    c = api('/my-rules', {'flag': 'テレアポ', 'rule': '不在なら時間をずらして3回', 'outcome': ''})
    assert (a[0], b[0], c[0]) == (201, 201, 201) and b[1]['outcome'] is None and c[1]['outcome'] is None
    items = api('/my-rules')[1]['items']
    assert [i['rule'] for i in items] == ['朝イチは30件かける', '不在なら時間をずらして3回', '約束の時間は10分前に着く']       # テレアポ → 営業マン像、同じフラグは登録順
    # 直す（送った項目だけ）
    status, row = api(f'/my-rules/{b[1]["id"]}', {'outcome': 'アポ率が上がる', 'flag': '稼働'}, method='PATCH')
    assert status == 200 and (row['flag'], row['rule'], row['outcome']) == ('稼働', '朝イチは30件かける', 'アポ率が上がる')
    assert api(f'/my-rules/{b[1]["id"]}', {'outcome': None}, method='PATCH')[1]['outcome'] is None
    # 入力の誤り
    assert api('/my-rules', {'flag': 'その他', 'rule': 'x'})[0] == 400
    assert api('/my-rules', {'flag': '商談', 'rule': '  '})[0] == 400
    assert api(f'/my-rules/{a[1]["id"]}', {'rule': ''}, method='PATCH')[0] == 400
    # 削除すると一覧から外れる
    assert api(f'/my-rules/{a[1]["id"]}/deactivate', {}, method='POST')[0] == 200
    assert [i['id'] for i in api('/my-rules')[1]['items']] == [c[1]['id'], b[1]['id']]                       # テレアポ（c）→ 稼働（b）
    assert api(f'/my-rules/{a[1]["id"]}', {'rule': 'y'}, method='PATCH')[0] == 404


def test_マイルールは自分の分だけ見られ_直せる(client):
    mine = client.api('/my-rules', {'flag': '商談', 'rule': '自分のルール'})[1]
    other = client.add_user('マイルールの別の営業', 'sales')
    client.sql("INSERT INTO telema_my_rules (user_id, flag, rule) VALUES (%s, '稼働', '他人のルール')", (other,))
    their = client.sql("SELECT id FROM telema_my_rules WHERE user_id = %s", (other,))[0]['id']
    assert '他人のルール' not in [i['rule'] for i in client.api('/my-rules')[1]['items']]
    assert client.api(f'/my-rules/{their}', {'rule': '書き換え'}, method='PATCH')[0] == 404
    assert client.api(f'/my-rules/{their}/deactivate', {}, method='POST')[0] == 404
    assert client.sql('SELECT rule FROM telema_my_rules WHERE id = %s', (their,))[0]['rule'] == '他人のルール'
    assert client.api(f'/my-rules/{mine["id"]}', {'rule': '自分で直す'}, method='PATCH')[1]['rule'] == '自分で直す'
