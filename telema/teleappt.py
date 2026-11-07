"""テレアポの集計（架電）。日・週・月の期間で、コール数・接触数・スケジューリング数・時間設定件数と、1時間あたりコール数を出す。
 - 接触：話した相手が選ばれている架電。代表＝話した相手が決裁者、担当＝決裁者以外（相手が未選択の架電は、どちらにも数えず「宛先未選択」とする）
 - スケジューリング数：結果が「初回訪問時間設定」の架電。時間設定件数：結果が「アポ獲得」区分（時間設定が成立した結果）の架電。どちらも、代表宛・担当宛・宛先未選択に分ける
 - 1時間あたりコール数：コール数 ÷ 架電した時間数。架電した時間数は、架電が1件でもあった「1時間の区切り（JST。9:00〜10:00 など）」の数
 - 期間：日（選んだ日）・週（選んだ日を含む月曜〜日曜）・月（選んだ日の月）。内訳は、日は時間帯ごと、週・月は日ごと
 営業（一般）は自分の分だけ。マネージャー・管理者は担当者を選べる（省略は全員）"""
from datetime import datetime, timedelta

from flask import jsonify, request

from .agenda import month_days, parse_day
from .analytics import SCHEDULING_STATUS, _day_bounds, _target_user
from .common import JST
from .context import ApiError, current_user, db
from .routes import bp

WEEKDAY = '月火水木金土日'
GRANULARITIES = ('day', 'week', 'month')


def _blank():
    return {'calls': 0, 'rep_contacts': 0, 'staff_contacts': 0, 'no_contact': 0,
            'scheduling': 0, 'scheduling_rep': 0, 'scheduling_staff': 0, 'scheduling_unknown': 0,
            'appointments': 0, 'appointments_rep': 0, 'appointments_staff': 0, 'appointments_unknown': 0, 'hours': set()}


def _count(m, kind, is_scheduling, is_appointment, hour_key):
    m['calls'] += 1
    m[{'rep': 'rep_contacts', 'staff': 'staff_contacts', 'unknown': 'no_contact'}[kind]] += 1
    if is_scheduling:
        m['scheduling'] += 1
        m[f'scheduling_{kind}'] += 1
    if is_appointment:
        m['appointments'] += 1
        m[f'appointments_{kind}'] += 1
    m['hours'].add(hour_key)


def _final(m):
    hours = len(m.pop('hours'))
    return {**m, 'active_hours': hours, 'calls_per_hour': round(m['calls'] / hours, 1) if hours else None}


@bp.get('/teleappt')
def teleappt():
    user, d = current_user(), db()
    gran = request.args.get('granularity') or 'month'
    if gran not in GRANULARITIES:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（granularity: day・week・month のどれかで指定してください）')
    anchor = parse_day(request.args.get('date') or datetime.now(JST).strftime('%Y-%m-%d'), 'date')
    uid = _target_user(user, default_all=True)
    if gran == 'day':
        first = last = anchor
    elif gran == 'week':
        first = anchor - timedelta(days=anchor.weekday())
        last = first + timedelta(days=6)
    else:
        first, last = month_days(anchor.strftime('%Y-%m'))
    start, end = _day_bounds(first, last)

    rows = d.all(
        f'''SELECT cl.called_at, cl.contact_id IS NOT NULL AS has_contact, COALESCE(k.is_decision_maker, 0) AS dm, s.label, s.category
              FROM telema_call_logs cl JOIN telema_companies c ON c.id = cl.company_id AND c.is_active = 1
              LEFT JOIN telema_contacts k ON k.id = cl.contact_id LEFT JOIN telema_call_statuses s ON s.id = cl.result_status_id
             WHERE cl.is_active = 1 AND cl.record_type = 'call' AND cl.called_at::timestamptz >= %s AND cl.called_at::timestamptz < %s
               {'' if uid is None else 'AND cl.user_id = %s'}''', [start, end, *([] if uid is None else [uid])])
    total = _blank()
    buckets = {}
    for r in rows:
        j = datetime.fromisoformat(r['called_at'].replace('Z', '+00:00')).astimezone(JST)
        kind = 'unknown' if not r['has_contact'] else 'rep' if r['dm'] == 1 else 'staff'
        args = (kind, r['label'] == SCHEDULING_STATUS, r['category'] == 'appointment', (j.date(), j.hour))
        _count(total, *args)
        _count(buckets.setdefault(j.hour if gran == 'day' else j.date(), _blank()), *args)

    items = []
    if gran == 'day':
        for h in sorted(buckets):
            items.append({'key': f'{h:02d}', 'label': f'{h}:00〜{h + 1}:00', **_final(buckets[h])})
    else:
        day = first
        while day <= last:
            items.append({'key': day.isoformat(), 'label': f'{day.month}/{day.day}（{WEEKDAY[day.weekday()]}）', **_final(buckets.get(day) or _blank())})
            day += timedelta(days=1)
    return jsonify({'granularity': gran, 'date': anchor.isoformat(), 'date_from': first.isoformat(), 'date_to': last.isoformat(), 'user_id': uid,
                    'totals': _final(total), 'rows': items})
