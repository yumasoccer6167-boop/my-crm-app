"""「今日」画面の集計。"""
from flask import jsonify

from .common import company_visibility, jst_day_range
from .context import current_user, db
from .routes import bp

LIST_COLUMNS = '''c.id, c.company_name, o.name AS organization_name, c.phone, c.city, c.industry,
  c.google_rating, c.google_review_count, c.status_id, s.label AS status_label, s.category AS status_category, c.temperature,
  NULL AS contact_name, c.last_called_at, c.next_call_at, c.call_count, c.assigned_user_id, u.display_name AS assigned_user_name, c.updated_at'''
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
    pending = d.value(
        f'''SELECT COUNT(DISTINCT a.company_id) FROM telema_ai_suggestions a JOIN telema_companies c ON c.id = a.company_id
            WHERE a.status = 'pending' AND {scope}''',
        vis_params,
    )
    today_list = d.all(
        f'SELECT {LIST_COLUMNS} {LIST_FROM} WHERE {scope} AND c.next_call_at < %s ORDER BY c.next_call_at LIMIT 50',
        [*vis_params, today_end],
    )
    recent = d.all(f'SELECT {LIST_COLUMNS} {LIST_FROM} WHERE {scope} ORDER BY c.updated_at DESC LIMIT 10', vis_params)
    calls = d.first(
        '''SELECT COUNT(*) AS calls_today, COUNT(DISTINCT cl.company_id) AS companies_called
           FROM telema_call_logs cl WHERE cl.is_active = 1 AND cl.called_at >= %s AND cl.called_at < %s AND (%s OR cl.user_id = %s)''',
        (today_start, today_end, user['role'] != 'sales', user['id']),
    )
    return jsonify({
        'counts': {k: v or 0 for k, v in counts.items()},
        'calls_today': calls,
        'companies_needing_review': pending or 0,
        'today': today_list,
        'recent': recent,
    })


@bp.get('/prefecture-stats')
def get_prefecture_stats():
    """都道府県別の登録施設数と、そのうちユーザー（ステータス区分が受注）の件数。シェアの把握用なので担当に関係なく全体を数える"""
    rows = db().all(
        '''SELECT COALESCE(NULLIF(c.prefecture, ''), '不明') AS prefecture,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE s.category = 'won') AS users
           FROM telema_companies c LEFT JOIN telema_call_statuses s ON s.id = c.status_id
           WHERE c.is_active = 1
           GROUP BY 1'''
    )
    return jsonify(rows)
