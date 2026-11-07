"""テレアポ（架電）の集計。他のテストと重ならない先の月（2027-06）を使う"""


def make_company(client, name):
    return client.sql('INSERT INTO telema_companies (company_name, company_name_normalized) VALUES (%s, %s) RETURNING id', (name, name))[0]['id']


def make_contact(client, company, dm):
    return client.sql('INSERT INTO telema_contacts (company_id, name, is_decision_maker) VALUES (%s, %s, %s) RETURNING id', (company, '先方', dm))[0]['id']


def test_テレアポは日_週_月で_代表宛と担当宛に分けて集計する(client):
    c = make_company(client, 'テレアポ園')
    rep, staff = make_contact(client, c, 1), make_contact(client, c, 0)
    sched, appo, plain = client.status_id('初回訪問時間設定'), client.status_id('時間設定成立'), client.status_id('再コール')

    def call(at, contact=None, status=None):
        assert client.api(f'/companies/{c}/calls', {'raw_note': 'x', 'called_at': at, 'contact_id': contact, 'result_status_id': status})[0] == 201

    # 6/2（水・JST）：9時台に3件（代表宛のスケジューリング／担当宛の時間設定／宛先未選択のスケジューリング）、11時台に代表宛の1件
    call('2027-06-02T00:05:00Z', rep, sched)
    call('2027-06-02T00:40:00Z', staff, appo)
    call('2027-06-02T00:50:00Z', None, sched)
    call('2027-06-02T02:10:00Z', rep, plain)
    call('2027-06-04T05:00:00Z', staff, appo)             # 同じ週・月（金 14時台）
    call('2027-06-20T01:00:00Z', None, None)              # 同じ月だけ
    call('2027-05-31T01:00:00Z', rep, appo)               # 同じ週だけ（月曜）

    status, day = client.api('/teleappt?granularity=day&date=2027-06-02')
    assert status == 200 and (day['date_from'], day['date_to']) == ('2027-06-02', '2027-06-02')
    t = day['totals']
    assert (t['calls'], t['rep_contacts'], t['staff_contacts'], t['no_contact']) == (4, 2, 1, 1)
    assert (t['scheduling'], t['scheduling_rep'], t['scheduling_staff'], t['scheduling_unknown']) == (2, 1, 0, 1)
    assert (t['appointments'], t['appointments_rep'], t['appointments_staff'], t['appointments_unknown']) == (1, 0, 1, 0)
    assert (t['active_hours'], t['calls_per_hour']) == (2, 2.0)                       # 9時台・11時台の2時間
    assert [(r['label'], r['calls'], r['calls_per_hour']) for r in day['rows']] == [('9:00〜10:00', 3, 3.0), ('11:00〜12:00', 1, 1.0)]

    week = client.api('/teleappt?granularity=week&date=2027-06-02')[1]
    assert (week['date_from'], week['date_to']) == ('2027-05-31', '2027-06-06') and len(week['rows']) == 7
    w = week['totals']
    assert (w['calls'], w['active_hours'], w['calls_per_hour']) == (6, 4, 1.5)
    assert (w['appointments'], w['appointments_rep'], w['appointments_staff']) == (3, 1, 2)
    assert [r['label'] for r in week['rows']][:2] == ['5/31（月）', '6/1（火）'] and week['rows'][1]['calls'] == 0 and week['rows'][1]['calls_per_hour'] is None

    month = client.api('/teleappt?granularity=month&date=2027-06-15')[1]
    assert (month['date_from'], month['date_to']) == ('2027-06-01', '2027-06-30') and len(month['rows']) == 30
    m = month['totals']
    assert (m['calls'], m['active_hours'], m['calls_per_hour'], m['appointments']) == (6, 4, 1.5, 2)      # 5/31の1件は先月

    # 別の担当者の分は0。入力の誤り
    other = client.add_user('テレアポの別の営業', 'sales')
    assert client.api(f'/teleappt?granularity=month&date=2027-06-15&user_id={other}')[1]['totals']['calls'] == 0
    assert client.api('/teleappt?granularity=year')[0] == 400 and client.api('/teleappt?date=2027-6-1')[0] == 400
