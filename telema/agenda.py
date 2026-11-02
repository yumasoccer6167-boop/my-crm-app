"""カレンダー。営業ごとの予定（初回訪問・営業・営業フォロー・訪問前連絡）と、稼働日の設定。再コールはカレンダーに出さず、「再コール」ページ（recalls.py）で見る。
 - 予定は記録から自動で出る（カレンダーだけに入れる予定はない）：
     初回訪問予定 … 架電の結果が「初回訪問時間設定」の記録に付けた 訪問する日時（visit_at）
     営業予定     … 架電の結果が「時間設定」の記録に付けた 訪問する日時（visit_at）と、初回訪問の記録で結果が「営業時間設定」のときの、営業の日時（first_followup_at）
     訪問前連絡   … 架電の記録に付けた 事前確認日時（precheck_at）
     営業フォロー … 営業の記録で「返事待ち」「再営業」にしたときの日時（sales_followup_at。返事待ちは対応済みになったら出ない）
 - 稼働日は日ごとに設定（telema_workdays）。設定のない日は平日（月〜金）。数値分析の残り稼働日もこれを見る
 - 訪問の時間帯（訪問する日時から VISIT_MINUTES 分）には、再コールを入れられない（check_recall_slot）"""
import re
from datetime import datetime, timedelta

from flask import jsonify, request

from .analytics import SCHEDULING_STATUS, is_workday, workday_overrides
from .common import JST, audit
from .context import ApiError, body, current_user, db, forbidden
from .routes import bp
from .validate import Bool, iso_utc, parse

VISIT_MINUTES = 60
KIND_LABEL = {'first_visit': '初回訪問予定', 'visit': '営業予定', 'followup': '営業フォロー', 'precheck': '訪問前連絡'}
FOLLOWUP_RESULT = {'waiting': '返事待ち', 'resales': '再営業'}

# 訪問の時間帯になる日時（訪問予定・営業フォローの日時）。済みのものは除く
_VISIT_TIMES = '''
  SELECT cl.visit_at AS t FROM telema_call_logs cl JOIN telema_companies c ON c.id = cl.company_id AND c.is_active = 1
   WHERE cl.is_active = 1 AND cl.record_type = 'call' AND cl.visit_at IS NOT NULL AND cl.visit_done_at IS NULL AND {who}
  UNION ALL
  SELECT cl.first_followup_at FROM telema_call_logs cl JOIN telema_companies c ON c.id = cl.company_id AND c.is_active = 1
   WHERE cl.is_active = 1 AND cl.record_type = 'visit' AND cl.first_result = 'scheduled' AND cl.first_followup_at IS NOT NULL AND {who}
  UNION ALL
  SELECT cl.sales_followup_at FROM telema_call_logs cl JOIN telema_companies c ON c.id = cl.company_id AND c.is_active = 1
   WHERE cl.is_active = 1 AND cl.record_type IN ('visit', 'reply') AND cl.sales_result IN ('waiting', 'resales') AND cl.sales_followup_at IS NOT NULL AND {who}
     AND NOT EXISTS (SELECT 1 FROM telema_call_logs r WHERE r.reply_to_id = cl.id AND r.is_active = 1)'''


def _hhmm(iso):
    return datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(JST).strftime('%H:%M')


def check_recall_slot(d, owner_id, at):
    """再コール（次回架電）の日時 at が、営業 owner_id の訪問の時間帯に入っていたら 400 にする。owner_id が None なら確認しない"""
    if owner_id is None or not at:
        return
    t = datetime.fromisoformat(at.replace('Z', '+00:00'))
    lo = iso_utc(t - timedelta(minutes=VISIT_MINUTES))
    hit = d.first(
        f'SELECT MIN(t) AS t FROM ({_VISIT_TIMES.format(who="(cl.user_id = %s OR c.assigned_user_id = %s)")}) v WHERE v.t > %s AND v.t <= %s',
        (owner_id, owner_id) * 3 + (lo, at))
    if hit and hit['t']:
        raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（次回架電: {_hhmm(hit["t"])}からの訪問の時間帯のため、再コールは設定できません）')


def agenda_items(d, uid, start, end):
    """start〜end（UTCのISO文字列、endは含まない）の予定。uid が None なら全員分。日時順"""
    who, wp = ('TRUE', []) if uid is None else ('(cl.user_id = %s OR c.assigned_user_id = %s)', [uid, uid])
    base = '''FROM telema_call_logs cl JOIN telema_companies c ON c.id = cl.company_id AND c.is_active = 1
              LEFT JOIN users u ON u.id = COALESCE(cl.user_id, c.assigned_user_id)'''
    cols = 'cl.id, cl.company_id, c.company_name, u.display_name AS user_name, cl.raw_note AS note'
    items = []

    def add(kind, rows, done=lambda r: False, detail=None):
        for r in rows:
            items.append({'kind': kind, 'label': KIND_LABEL[kind], 'id': r['id'], 'company_id': r['company_id'], 'company_name': r['company_name'],
                          'user_name': r['user_name'], 'at': r['at'], 'note': (r['note'] or '').strip()[:80] or None,
                          'done': done(r), 'detail': detail(r) if detail else None})

    call_base = base + ' LEFT JOIN telema_call_statuses st ON st.id = cl.result_status_id'
    first = 'st.label = %s'
    add('first_visit', d.all(
        f'''SELECT {cols}, cl.visit_at AS at, cl.visit_done_at AS done_at {call_base}
             WHERE cl.is_active = 1 AND cl.record_type = 'call' AND {first} AND cl.visit_at >= %s AND cl.visit_at < %s AND {who} ORDER BY cl.visit_at, cl.id''',
        [SCHEDULING_STATUS, start, end, *wp]), done=lambda r: r['done_at'] is not None)
    add('precheck', d.all(
        f'''SELECT {cols}, cl.precheck_at AS at, cl.precheck_done_at AS done_at {base}
             WHERE cl.is_active = 1 AND cl.record_type = 'call' AND cl.precheck_at >= %s AND cl.precheck_at < %s AND {who} ORDER BY cl.precheck_at, cl.id''', [start, end, *wp]),
        done=lambda r: r['done_at'] is not None)
    add('visit', d.all(
        f'''SELECT {cols}, cl.visit_at AS at, cl.visit_done_at AS done_at {call_base}
             WHERE cl.is_active = 1 AND cl.record_type = 'call' AND st.label IS DISTINCT FROM %s AND cl.visit_at >= %s AND cl.visit_at < %s AND {who} ORDER BY cl.visit_at, cl.id''',
        [SCHEDULING_STATUS, start, end, *wp]), done=lambda r: r['done_at'] is not None, detail=lambda r: '時間設定')
    add('visit', d.all(
        f'''SELECT {cols}, cl.first_followup_at AS at {base}
             WHERE cl.is_active = 1 AND cl.record_type = 'visit' AND cl.first_result = 'scheduled' AND cl.first_followup_at >= %s AND cl.first_followup_at < %s AND {who}
             ORDER BY cl.first_followup_at, cl.id''', [start, end, *wp]), detail=lambda r: '営業時間設定')
    add('followup', d.all(
        f'''SELECT {cols}, cl.sales_followup_at AS at, cl.sales_result AS result {base}
             WHERE cl.is_active = 1 AND cl.record_type IN ('visit', 'reply') AND cl.sales_result IN ('waiting', 'resales')
               AND cl.sales_followup_at >= %s AND cl.sales_followup_at < %s AND {who}
               AND NOT EXISTS (SELECT 1 FROM telema_call_logs r WHERE r.reply_to_id = cl.id AND r.is_active = 1)
             ORDER BY cl.sales_followup_at, cl.id''', [start, end, *wp]), detail=lambda r: FOLLOWUP_RESULT[r['result']])
    items.sort(key=lambda i: (i['at'], i['kind'], i['id']))
    return items


def _calendar_user(user):
    """対象の営業。一般は自分だけ。それ以外は user_id の指定（省略は自分、all は全員＝None）"""
    raw = request.args.get('user_id')
    if user['role'] == 'sales' or not raw:
        return user['id']
    if raw == 'all':
        return None
    if not raw.isdigit():
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（user_id: 数値か all で指定してください）')
    return int(raw)


def parse_day(raw, field):
    """YYYY-MM-DD の日付（0埋めあり・実在する日）。違えば 400"""
    try:
        if raw and re.fullmatch(r'\d{4}-\d{2}-\d{2}', raw):
            return datetime.strptime(raw, '%Y-%m-%d').date()
    except ValueError:
        pass
    raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（{field}: YYYY-MM-DD で指定してください）')


def month_days(month):
    first = datetime.strptime(month + '-01', '%Y-%m-%d').date()
    nxt = (first + timedelta(days=32)).replace(day=1)
    return first, nxt - timedelta(days=1)


@bp.get('/calendar')
def calendar():
    user, d = current_user(), db()
    month = request.args.get('month') or datetime.now(JST).strftime('%Y-%m')
    if len(month) != 7 or month[4] != '-' or not (month[:4] + month[5:]).isdigit() or not 1 <= int(month[5:]) <= 12:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（month: YYYY-MM で指定してください）')
    uid = _calendar_user(user)
    first, last = month_days(month)
    start = iso_utc(datetime(first.year, first.month, first.day, tzinfo=JST))
    end = iso_utc(datetime(last.year, last.month, last.day, tzinfo=JST) + timedelta(days=1))
    days = []
    if uid is not None:
        over = workday_overrides(d, uid, first, last)
        n, cur = (last - first).days + 1, first
        for _ in range(n):
            days.append({'day': cur.isoformat(), 'is_workday': is_workday(cur, over), 'custom': cur in over})
            cur += timedelta(days=1)
    return jsonify({'month': month, 'user_id': uid, 'days': days, 'items': agenda_items(d, uid, start, end)})


@bp.put('/workdays/<int:user_id>/<day>')
def put_workday(user_id, day):
    """日ごとの稼働日／休みを設定する。is_workday を null で送ると、設定を外して平日（月〜金）に戻す。管理者は誰の分も、それ以外は自分の分"""
    user, d = current_user(), db()
    date = parse_day(day, 'day')
    if user['role'] != 'admin' and user_id != user['id']:
        raise forbidden()
    if not d.first('SELECT 1 FROM users WHERE id = %s', (user_id,)):
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（user_id: ユーザーが見つかりません）')
    b = parse({'is_workday': Bool(nullable=True)}, body())
    before = d.first('SELECT is_workday FROM telema_workdays WHERE user_id = %s AND day = %s', (user_id, day))
    if b['is_workday'] is None:
        d.run('DELETE FROM telema_workdays WHERE user_id = %s AND day = %s', (user_id, day))
    else:
        d.run(
            '''INSERT INTO telema_workdays (user_id, day, is_workday, updated_by) VALUES (%s, %s, %s, %s)
               ON CONFLICT (user_id, day) DO UPDATE SET is_workday = EXCLUDED.is_workday, updated_by = EXCLUDED.updated_by, updated_at = telema_now()''',
            (user_id, day, int(b['is_workday']), user['id']))
    audit(d, user['id'], 'update', 'workday', user_id, before, {'day': day, 'is_workday': b['is_workday']})
    return jsonify({'user_id': user_id, 'day': day, 'is_workday': is_workday(date, workday_overrides(d, user_id, date, date)), 'custom': b['is_workday'] is not None})
