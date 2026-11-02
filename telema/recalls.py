"""再コール一覧。施設の次回架電（next_call_at）が入っている施設を、日時順に並べる。担当の施設の分だけ（マネージャー・管理者は担当者を選べる、全員も可）。
 件数（期限超過・今日・今週まで〔期限超過を含む〕・すべて）は、範囲で絞り込む前の全体の数。マイページに出す数字の元にもなる。
 「対応済み」にするときは、予定の対応済み（POST /schedule/done、kind = recall）を使う。"""
from datetime import datetime

from flask import jsonify, request

from .common import JST, jst_day_range
from .context import ApiError, current_user, db
from .routes import bp

RANGES = ('all', 'overdue', 'today', 'week')
LIST_LIMIT = 500


@bp.get('/recalls')
def list_recalls():
    user, d = current_user(), db()
    raw = request.args.get('user_id')
    if user['role'] == 'sales' or not raw:
        uid = user['id']
    elif raw == 'all':
        uid = None
    elif raw.isdigit():
        uid = int(raw)
    else:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（user_id: 数値か all で指定してください）')
    rng = request.args.get('range') or 'all'
    if rng not in RANGES:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（range: all / overdue / today / week のどれかです）')
    today_start, today_end = jst_day_range(0)
    week_end = jst_day_range(6 - datetime.now(JST).weekday())[1]       # 今週（月〜日）の終わり
    who, wp = ('TRUE', []) if uid is None else ('c.assigned_user_id = %s', [uid])
    counts = d.first(
        f'''SELECT COUNT(*) FILTER (WHERE c.next_call_at < %s)::int AS overdue,
                   COUNT(*) FILTER (WHERE c.next_call_at >= %s AND c.next_call_at < %s)::int AS today,
                   COUNT(*) FILTER (WHERE c.next_call_at < %s)::int AS week,
                   COUNT(*)::int AS total
              FROM telema_companies c WHERE c.is_active = 1 AND c.next_call_at IS NOT NULL AND {who}''',
        [today_start, today_start, today_end, week_end, *wp])
    cond = {'all': 'TRUE', 'overdue': 'c.next_call_at < %s', 'today': 'c.next_call_at >= %s AND c.next_call_at < %s', 'week': 'c.next_call_at < %s'}[rng]
    cp = {'all': [], 'overdue': [today_start], 'today': [today_start, today_end], 'week': [week_end]}[rng]
    items = d.all(
        f'''SELECT c.id, c.company_name, c.phone, c.is_user, c.next_call_at AS at, c.next_action, c.assigned_user_id, u.display_name AS assigned_user_name,
                   s.label AS status_label, s.category AS status_category,
                   (SELECT ct.name FROM telema_contacts ct WHERE ct.company_id = c.id AND ct.is_active = 1 AND ct.name IS NOT NULL
                     ORDER BY ct.is_decision_maker DESC, ct.updated_at DESC LIMIT 1) AS contact_name
              FROM telema_companies c LEFT JOIN users u ON u.id = c.assigned_user_id LEFT JOIN telema_call_statuses s ON s.id = c.status_id
             WHERE c.is_active = 1 AND c.next_call_at IS NOT NULL AND {who} AND {cond}
             ORDER BY c.next_call_at, c.id LIMIT %s''', [*wp, *cp, LIST_LIMIT])
    for it in items:
        it['overdue'] = it['at'] < today_start
    return jsonify({'user_id': uid, 'range': rng, 'counts': counts, 'items': items})
