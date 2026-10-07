"""マイページの集計。"""
from datetime import datetime, timezone

from flask import jsonify, request

from .common import JST, TAG_KINDS, company_visibility, jst_day_range, jst_month_range
from .context import ApiError, current_user, db
from .routes import bp

LIST_COLUMNS = '''c.id, c.company_name, o.name AS organization_name, c.phone, c.city, c.industry,
  c.google_rating, c.google_review_count, c.status_id, s.label AS status_label, s.category AS status_category, c.is_user, c.temperature,
  NULL AS contact_name, c.last_called_at, c.next_call_at, c.call_count, c.assigned_user_id, u.display_name AS assigned_user_name, c.updated_at,
  ''' + ', '.join(k.names_column for k in TAG_KINDS)
LIST_FROM = '''FROM telema_companies c
  LEFT JOIN telema_call_statuses s ON s.id = c.status_id
  LEFT JOIN telema_organizations o ON o.id = c.organization_id
  LEFT JOIN users u ON u.id = c.assigned_user_id'''


@bp.get('/dashboard')
def get_dashboard():
    user = current_user()
    vis_sql, vis_params = company_visibility(user)
    today_start, today_end = jst_day_range(0)
    d = db()
    # 自分の担当 + 未割当 を「今日やること」の対象にする（manager/admin は全体を見る）
    scope = f'c.is_active = 1 AND {vis_sql}'

    counts = d.first(
        f'''SELECT
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE c.status_id IS NULL OR s.category = 'not_started') AS not_started,
              COUNT(*) FILTER (WHERE s.category = 'in_progress') AS in_progress,
              COUNT(*) FILTER (WHERE s.category = 'appointment') AS appointment,
              COUNT(*) FILTER (WHERE s.category = 'won') AS won,
              COUNT(*) FILTER (WHERE s.category = 'lost') AS lost,
              COUNT(*) FILTER (WHERE s.category = 'excluded') AS excluded,
              COUNT(*) FILTER (WHERE c.next_call_at < %s) AS due_today,
              COUNT(*) FILTER (WHERE c.next_call_at < %s) AS overdue,
              COUNT(*) FILTER (WHERE c.updated_at >= %s) AS updated_today
            FROM telema_companies c LEFT JOIN telema_call_statuses s ON s.id = c.status_id WHERE {scope}''',
        [today_end, today_start, today_start, *vis_params],
    )
    # マイページの件数は自分が担当している施設だけ
    mine = d.first(
        '''SELECT
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE c.status_id IS NULL OR s.category = 'not_started') AS not_started,
              COUNT(*) FILTER (WHERE s.category = 'in_progress') AS in_progress,
              COUNT(*) FILTER (WHERE s.category = 'appointment') AS appointment,
              COUNT(*) FILTER (WHERE s.category = 'won') AS won,
              COUNT(*) FILTER (WHERE s.category = 'lost') AS lost
            FROM telema_companies c LEFT JOIN telema_call_statuses s ON s.id = c.status_id
            WHERE c.is_active = 1 AND c.assigned_user_id = %s''',
        (user['id'],),
    )
    pending = d.value(
        f'''SELECT COUNT(DISTINCT a.company_id) FROM telema_ai_suggestions a JOIN telema_companies c ON c.id = a.company_id
            WHERE a.status = 'pending' AND a.suggestion_type <> 'summary' AND {scope}''',
        vis_params,
    )
    today_list = d.all(
        f'SELECT {LIST_COLUMNS} {LIST_FROM} WHERE {scope} AND c.next_call_at < %s ORDER BY c.next_call_at LIMIT 50',
        [*vis_params, today_end],
    )
    calls = d.first(
        '''SELECT COUNT(*) AS calls_today, COUNT(DISTINCT cl.company_id) AS companies_called
           FROM telema_call_logs cl WHERE cl.is_active = 1 AND cl.called_at >= %s AND cl.called_at < %s AND cl.user_id = %s''',
        (today_start, today_end, user['id']),
    )
    return jsonify({
        'counts': {k: v or 0 for k, v in counts.items()},
        'my_counts': {k: v or 0 for k, v in mine.items()},
        'calls_today': calls,
        'companies_needing_review': pending or 0,
        'today': today_list,
    })


def _last_months(n, now=None):
    """今月から過去 n か月分の 'YYYY-MM'（古い順、JST）"""
    j = (now or datetime.now(timezone.utc)).astimezone(JST)
    out = []
    for i in range(n - 1, -1, -1):
        y, m = divmod(j.year * 12 + j.month - 1 - i, 12)
        out.append(f'{y:04d}-{m + 1:02d}')
    return out


@bp.get('/dashboard/calls-monthly')
def get_calls_monthly():
    """担当（架電した人）ごと・月ごと（JST）のコール数と時間設定成立数。
    時間設定成立はステータス区分 appointment の架電結果を数える。営業は自分の分だけ、マネージャー・管理者は全員分"""
    raw = request.args.get('months', '6')
    if not raw.isdigit() or not 1 <= int(raw) <= 24:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（months: 1〜24 で指定してください）')
    months = _last_months(int(raw))
    user = current_user()
    d = db()
    rows = d.all(
        '''SELECT to_char((cl.called_at::timestamptz) AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM') AS month, cl.user_id, u.display_name AS user_name,
              COUNT(*) AS calls, COUNT(*) FILTER (WHERE s.category = 'appointment') AS appointments
           FROM telema_call_logs cl
           LEFT JOIN telema_call_statuses s ON s.id = cl.result_status_id
           LEFT JOIN users u ON u.id = cl.user_id
           WHERE cl.is_active = 1 AND cl.called_at >= %s AND (%s OR cl.user_id = %s)
           GROUP BY 1, cl.user_id, u.display_name
           ORDER BY 1, u.display_name''',
        (jst_month_range(months[0])[1], user['role'] != 'sales', user['id']),
    )
    labels = d.all("SELECT label FROM telema_call_statuses WHERE category = 'appointment' AND is_active = 1 ORDER BY sort_order, id")
    return jsonify({'months': months, 'rows': rows, 'appointment_labels': [r['label'] for r in labels]})


@bp.get('/prefecture-stats')
def get_prefecture_stats():
    """都道府県別の登録施設数と、そのうちユーザーの件数。シェアの把握用なので担当に関係なく全体を数える"""
    rows = db().all(
        '''SELECT COALESCE(NULLIF(c.prefecture, ''), '不明') AS prefecture,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE c.is_user = 1) AS users
           FROM telema_companies c
           WHERE c.is_active = 1
           GROUP BY 1'''
    )
    return jsonify(rows)
