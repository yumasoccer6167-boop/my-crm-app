"""管理者のみ：元データの「担当者」列（自社営業担当の名前）→ メンバーの割り振り。取り込み時は割り当てず保持している。"""
from flask import jsonify

from .common import audit
from .context import ApiError, body, current_user, db, require_role
from .routes import bp
from .validate import Invalid

SOURCE_ASSIGNEE_COLUMN = '担当者'
NAME_EXPR = "NULLIF(TRIM(extra_attributes::jsonb ->> '担当者'), '')"


def _parse_mappings(v):
    """[{name, user_id}] を検証する"""
    if not isinstance(v, list) or not (1 <= len(v) <= 500):
        raise Invalid('1〜500件の配列で指定してください')
    out = []
    for m in v:
        name = m.get('name') if isinstance(m, dict) else None
        uid = m.get('user_id') if isinstance(m, dict) else None
        if not isinstance(name, str) or not (1 <= len(name.strip()) <= 100):
            raise Invalid('name は1〜100文字で指定してください')
        if isinstance(uid, bool) or not isinstance(uid, int) or uid <= 0:
            raise Invalid('user_id は正の整数で指定してください')
        out.append({'name': name.strip(), 'user_id': uid})
    return out


@bp.get('/admin/assignee-mapping')
def assignee_mapping():
    require_role('admin')
    items = db().all(
        f'''SELECT {NAME_EXPR} AS name, COUNT(*) AS total, COUNT(*) FILTER (WHERE assigned_user_id IS NULL) AS unassigned
            FROM telema_companies WHERE is_active = 1 AND extra_attributes IS NOT NULL
            GROUP BY 1 HAVING {NAME_EXPR} IS NOT NULL ORDER BY total DESC, name''')
    return jsonify({'column': SOURCE_ASSIGNEE_COLUMN, 'items': items})


@bp.post('/admin/assignee-mapping')
def apply_assignee_mapping():
    """未割当の施設だけに割り当てる（既に担当がいる施設は上書きしない）"""
    require_role('admin')
    raw = body().get('mappings')
    try:
        mappings = _parse_mappings(raw)
    except Invalid as e:
        raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（mappings: {e}）')
    mp = {m['name']: m['user_id'] for m in mappings}
    d = db()
    user_ids = list(set(mp.values()))
    valid = d.all('SELECT id FROM users WHERE id = ANY(%s)', (user_ids,))
    if len(valid) != len(user_ids):
        raise ApiError(400, 'validation_error', '無効なメンバーが含まれています')

    names = list(mp)
    updated = d.all(
        f'''UPDATE telema_companies c SET assigned_user_id = m.user_id, updated_at = telema_now()
            FROM unnest(%s::text[], %s::int[]) AS m(name, user_id)
            WHERE c.is_active = 1 AND c.assigned_user_id IS NULL AND c.extra_attributes IS NOT NULL
              AND {NAME_EXPR.replace('extra_attributes', 'c.extra_attributes')} = m.name
            RETURNING m.name''',
        (names, [mp[n] for n in names]))
    counts = {}
    for r in updated:
        counts[r['name']] = counts.get(r['name'], 0) + 1
    # 施設ごとではなく1件にまとめて記録する
    audit(d, current_user()['id'], 'assign', 'company_bulk', None, None, {'column': SOURCE_ASSIGNEE_COLUMN, 'mappings': mp, 'counts': counts})
    return jsonify({'updated': len(updated), 'counts': counts})
