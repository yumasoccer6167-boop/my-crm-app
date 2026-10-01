"""訪問ルート用の施設一覧（ユーザー＝ステータス区分が受注）。ルートは画面側で組む。"""
from flask import jsonify

from .common import company_visibility
from .context import current_user, db
from .routes import bp


@bp.get('/visit-targets')
def visit_targets():
    vis_sql, vis_params = company_visibility(current_user())
    return jsonify(db().all(
        f'''SELECT c.id, c.company_name, c.prefecture, c.city, c.address, c.phone, c.latitude, c.longitude,
              s.label AS status_label, c.last_called_at, c.assigned_user_id
            FROM telema_companies c JOIN telema_call_statuses s ON s.id = c.status_id
            WHERE c.is_active = 1 AND s.category = 'won' AND {vis_sql}
            ORDER BY c.prefecture, c.city, c.id''',
        vis_params,
    ))
