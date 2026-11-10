"""協会カルテ。協会1件の、加盟施設数・加盟法人数・業種別の施設数・ユーザー数とユーザー率、会長名・役員名、協会HPのリンク。
数字は協会の組織図（association_overview）と同じ数え方：下位の協会の加盟施設も含み、同じ施設・同じ法人は1回だけ数える。
会長名・役員名・協会HPのリンクは、カルテに直接入力する（管理者・マネージャー）。顧客カルテで会長・役員に印を付けた担当者も、あわせて出す。"""
from collections import Counter

from flask import jsonify

from .association_overview import _descendants
from .common import ASSOCIATION, audit
from .context import ApiError, body, current_user, db, not_found, require_role
from .routes import bp
from .validate import Str, parse, parse_id

PROFILE_FIELDS = {
    'website_url': Str(max=500, pattern=r'https?://\S+', pattern_msg='http:// か https:// で始まるURLを入力してください', nullable=True),
    'chair_name': Str(max=200, nullable=True),
    'officer_names': Str(max=2000, nullable=True),
}
NO_INDUSTRY = '未設定'


def _karte(d, id):
    a = d.first(
        f'''SELECT id, name, is_active, parent_id, is_top_level, prefecture, website_url, chair_name, officer_names, updated_at
              FROM {ASSOCIATION.master} WHERE id = %s''', (id,))
    if not a:
        raise not_found('加盟協会')
    assocs = d.all(f'SELECT id, name, parent_id FROM {ASSOCIATION.master}')
    by_id = {x['id']: x for x in assocs}
    children = {}
    for x in assocs:
        if x['parent_id'] is not None:
            children.setdefault(x['parent_id'], []).append(x['id'])
    path, cur, seen = [], by_id.get(id), set()
    while cur and cur['id'] not in seen:
        seen.add(cur['id'])
        path.insert(0, cur['name'])
        cur = by_id.get(cur['parent_id']) if cur['parent_id'] is not None else None

    ids = _descendants(children, id)
    rows = d.all(
        f'''SELECT DISTINCT ON (c.id) c.id, c.organization_id, c.is_user, c.industry, ca.{ASSOCIATION.fk} = %s AS own
              FROM {ASSOCIATION.link} ca JOIN telema_companies c ON c.id = ca.company_id AND c.is_active = 1
             WHERE ca.{ASSOCIATION.fk} = ANY(%s)
             ORDER BY c.id, (ca.{ASSOCIATION.fk} = %s) DESC''', [id, ids, id])
    orgs = {r['organization_id'] for r in rows if r['organization_id'] is not None}
    user_rows = [r for r in rows if r['is_user'] == 1]
    user_orgs = {r['organization_id'] for r in user_rows if r['organization_id'] is not None}
    inds, user_inds = Counter(), Counter()
    for r in rows:
        key = (r['industry'] or '').strip() or NO_INDUSTRY
        inds[key] += 1
        if r['is_user'] == 1:
            user_inds[key] += 1
    industries = [{'industry': k, 'count': n, 'user_count': user_inds.get(k, 0)}
                  for k, n in sorted(inds.items(), key=lambda kv: (kv[0] == NO_INDUSTRY, -kv[1], kv[0]))]

    people = d.all(
        f'''SELECT DISTINCT ON (k.id) k.id AS contact_id, k.name, k.role, k.is_association_chair, k.is_association_officer, c.id AS company_id, c.company_name
              FROM telema_contacts k
              JOIN telema_companies c ON c.is_active = 1 AND (k.company_id = c.id OR (k.company_id IS NULL AND k.organization_id = c.organization_id))
              JOIN {ASSOCIATION.link} ca ON ca.company_id = c.id AND ca.{ASSOCIATION.fk} = %s
             WHERE k.is_active = 1 AND (k.is_association_chair = 1 OR k.is_association_officer = 1)
             ORDER BY k.id, c.id''', [id])
    return {
        'association': {**a, 'path': path},
        'metrics': {
            'facility_count': len(rows),
            'own_facility_count': sum(1 for r in rows if r['own']),
            'organization_count': len(orgs),
            'user_facility_count': len(user_rows),
            'user_organization_count': len(user_orgs),
            # ユーザー率＝ユーザー法人 ÷ 加盟法人（%）。加盟法人が 0 のときは出さない
            'user_rate': round(len(user_orgs) / len(orgs) * 100, 1) if orgs else None,
        },
        'industries': industries,
        'chairs': [p for p in people if p['is_association_chair']],
        'officers': [p for p in people if p['is_association_officer'] and not p['is_association_chair']],
    }


@bp.get('/associations/<id>/karte')
def association_karte(id):
    return jsonify(_karte(db(), parse_id(id)))


@bp.patch('/associations/<id>/karte')
def update_association_karte(id):
    """協会カルテの入力項目（協会HPのリンク、会長名、役員名）を保存する（管理者・マネージャー）。空にした項目は消す"""
    require_role('admin', 'manager')
    id = parse_id(id)
    raw = {k: (None if isinstance(v, str) and not v.strip() else v) for k, v in body().items()}
    b = parse(PROFILE_FIELDS, raw, partial=True)
    if not b:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（変更する項目を指定してください）')
    d = db()
    before = d.first(f'SELECT {", ".join(b)} FROM {ASSOCIATION.master} WHERE id = %s', (id,))
    if not before:
        raise not_found('加盟協会')
    d.run(f'UPDATE {ASSOCIATION.master} SET {", ".join(f"{k} = %s" for k in b)}, updated_at = telema_now() WHERE id = %s', [*b.values(), id])
    audit(d, current_user()['id'], 'update', 'association_karte', id, dict(before), b)
    return jsonify(_karte(d, id))
