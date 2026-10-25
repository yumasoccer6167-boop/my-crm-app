"""加盟協会の一覧（組織図・加盟施設数・加盟法人数など）。画面は「協会」タブ（マインドマップ表示とリスト表示）。
数えるのは有効な施設すべて（営業を含め、全員が同じ数字を見られる。リストのような「自分の担当・未割当のみ」の制限はしない）。協会に加盟している施設は telema_company_associations で決まる。"""
from flask import jsonify

from .common import ASSOCIATION, ASSOCIATION_CHAIR_COLUMN, ASSOCIATION_OFFICER_COLUMN
from .context import db, not_found
from .routes import bp
from .validate import parse_id

MEMBERS_LIMIT = 2000


@bp.get('/association-overview')
def association_overview():
    """協会ごとの加盟施設数・加盟法人数・ユーザー施設数と、協会会長・協会役員。協会の都道府県は、加盟施設で一番多い都道府県"""
    d = db()
    rows = d.all(
        f'''SELECT t.id, t.name, t.is_active, t.sort_order,
                   COUNT(DISTINCT c.id) AS facility_count,
                   COUNT(DISTINCT c.organization_id) AS organization_count,
                   COUNT(DISTINCT c.id) FILTER (WHERE c.is_user = 1) AS user_count,
                   MODE() WITHIN GROUP (ORDER BY c.prefecture) AS prefecture
              FROM {ASSOCIATION.master} t
              LEFT JOIN {ASSOCIATION.link} ca ON ca.{ASSOCIATION.fk} = t.id
              LEFT JOIN telema_companies c ON c.id = ca.company_id AND c.is_active = 1
             GROUP BY t.id, t.name, t.is_active, t.sort_order
             ORDER BY t.sort_order, t.id''')
    # 協会会長・協会役員の担当者（施設の担当者と、法人に登録した担当者）。同じ人は協会ごとに1回だけ
    people = d.all(
        f'''SELECT DISTINCT ON (ca.{ASSOCIATION.fk}, k.id)
                   ca.{ASSOCIATION.fk} AS association_id, k.id AS contact_id, k.name, k.role,
                   k.is_association_chair, k.is_association_officer, c.id AS company_id, c.company_name
              FROM telema_contacts k
              JOIN telema_companies c ON c.is_active = 1 AND (k.company_id = c.id OR (k.company_id IS NULL AND k.organization_id = c.organization_id))
              JOIN {ASSOCIATION.link} ca ON ca.company_id = c.id
             WHERE k.is_active = 1 AND (k.is_association_chair = 1 OR k.is_association_officer = 1)
             ORDER BY ca.{ASSOCIATION.fk}, k.id, c.id''')
    by_assoc = {}
    for p in people:
        by_assoc.setdefault(p['association_id'], []).append(p)
    items = []
    for r in rows:
        ps = by_assoc.get(r['id'], [])
        items.append({
            **r,
            # 会長が先、そのあと役員（同じ人が両方なら会長として出す）
            'chairs': [p for p in ps if p['is_association_chair']],
            'officers': [p for p in ps if p['is_association_officer'] and not p['is_association_chair']],
        })
    totals = d.first(
        f'''SELECT COUNT(DISTINCT c.id) AS facility_count, COUNT(DISTINCT c.organization_id) AS organization_count,
                   COUNT(DISTINCT c.id) FILTER (WHERE c.is_user = 1) AS user_count
              FROM telema_companies c JOIN {ASSOCIATION.link} ca ON ca.company_id = c.id
              JOIN {ASSOCIATION.master} t ON t.id = ca.{ASSOCIATION.fk} AND t.is_active = 1
             WHERE c.is_active = 1''')
    totals['association_count'] = sum(1 for r in rows if r['is_active'])
    return jsonify({'associations': items, 'totals': totals})


@bp.get('/association-overview/<id>/members')
def association_members(id):
    """協会に加盟している施設（法人でまとめて表示するための一覧）。協会会長・役員がいる施設には印が付く"""
    id = parse_id(id)
    d = db()
    assoc = d.first(f'SELECT id, name FROM {ASSOCIATION.master} WHERE id = %s', (id,))
    if not assoc:
        raise not_found('加盟協会')
    rows = d.all(
        f'''SELECT c.id, c.company_name, c.organization_id, o.name AS organization_name, c.is_user, c.is_headquarters, c.prefecture, c.city,
                   s.label AS status_label, s.category AS status_category, {ASSOCIATION_CHAIR_COLUMN}, {ASSOCIATION_OFFICER_COLUMN}
              FROM {ASSOCIATION.link} ca
              JOIN telema_companies c ON c.id = ca.company_id AND c.is_active = 1
              LEFT JOIN telema_organizations o ON o.id = c.organization_id
              LEFT JOIN telema_call_statuses s ON s.id = c.status_id
             WHERE ca.{ASSOCIATION.fk} = %s
             ORDER BY o.name NULLS LAST, c.organization_id NULLS LAST, c.is_headquarters DESC, c.company_name
             LIMIT %s''', [id, MEMBERS_LIMIT + 1])
    return jsonify({'association': assoc, 'truncated': len(rows) > MEMBERS_LIMIT, 'facilities': rows[:MEMBERS_LIMIT]})
