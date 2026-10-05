"""加盟協会。マスタ（設定画面で管理者が追加・名称変更・無効化）と、施設ごとの加盟協会（複数）。"""
from flask import jsonify

from .common import ASSOCIATIONS_OF_COMPANY, audit, can_edit_company
from .companies import load_visible_company
from .context import ApiError, body, current_user, db, forbidden, not_found, require_role
from .routes import bp
from .validate import Bool, Int, IntList, Str, parse, parse_id

ASSOCIATION_BODY = {
    'name': Str(min=1, max=100),
    'sort_order': Int(optional=True),
    'is_active': Bool(optional=True),
}


# ---- マスタ ----
@bp.get('/associations')
def list_associations():
    return jsonify(db().all('SELECT * FROM telema_associations ORDER BY sort_order, id'))


@bp.post('/associations')
def create_association():
    require_role('admin')
    b = parse(ASSOCIATION_BODY, body())
    d = db()
    if d.first('SELECT 1 FROM telema_associations WHERE name = %s', (b['name'],)):
        raise ApiError(409, 'conflict', f'加盟協会「{b["name"]}」は既にあります')
    row = d.first(
        '''INSERT INTO telema_associations (name, sort_order)
           VALUES (%s, COALESCE(%s, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM telema_associations))) RETURNING *''',
        (b['name'], b.get('sort_order')),
    )
    audit(d, current_user()['id'], 'create', 'association', row['id'], None, row)
    return jsonify(row), 201


@bp.patch('/associations/<id>')
def update_association(id):
    require_role('admin')
    id = parse_id(id)
    b = parse(ASSOCIATION_BODY, body(), partial=True)
    d = db()
    before = d.first('SELECT * FROM telema_associations WHERE id = %s', (id,))
    if not before:
        raise not_found('加盟協会')
    if 'name' in b and b['name'] != before['name'] and d.first('SELECT 1 FROM telema_associations WHERE name = %s', (b['name'],)):
        raise ApiError(409, 'conflict', f'加盟協会「{b["name"]}」は既にあります')
    row = d.first(
        '''UPDATE telema_associations SET name = COALESCE(%s, name), sort_order = COALESCE(%s, sort_order),
             is_active = COALESCE(%s, is_active), updated_at = telema_now() WHERE id = %s RETURNING *''',
        (b.get('name'), b.get('sort_order'), None if b.get('is_active') is None else int(b['is_active']), id),
    )
    audit(d, current_user()['id'], 'update', 'association', id, before, row)
    return jsonify(row)


# ---- 施設ごとの加盟協会 ----
@bp.patch('/companies/<id>/associations')
def set_company_associations(id):
    """施設の加盟協会を、送られた一覧に置き換える。無効にした協会でも、すでに付いているものは外すまで残る
    （新しく付けられるのは有効な協会だけ）"""
    id = parse_id(id)
    b = parse({'association_ids': IntList(max_len=100)}, body())
    ids = list(dict.fromkeys(b['association_ids']))
    user = current_user()
    company = load_visible_company(id)
    if not can_edit_company(user, company['assigned_user_id']):
        raise forbidden()
    d = db()
    found = {r['id']: r for r in d.all('SELECT id, is_active FROM telema_associations WHERE id = ANY(%s)', (ids,))}
    if len(found) != len(ids):
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（association_ids: 加盟協会が見つかりません）')
    before = [r['id'] for r in d.all(ASSOCIATIONS_OF_COMPANY, (id,))]
    if any(not found[i]['is_active'] and i not in before for i in ids):
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（association_ids: 無効な加盟協会は追加できません）')
    d.run('DELETE FROM telema_company_associations WHERE company_id = %s AND NOT (association_id = ANY(%s))', (id, ids))
    for assoc_id in ids:
        d.run('INSERT INTO telema_company_associations (company_id, association_id) VALUES (%s, %s) ON CONFLICT DO NOTHING', (id, assoc_id))
    d.run('UPDATE telema_companies SET updated_at = telema_now() WHERE id = %s', (id,))
    after = d.all(ASSOCIATIONS_OF_COMPANY, (id,))
    audit(d, user['id'], 'update', 'company_associations', id, {'association_ids': before}, {'association_ids': [r['id'] for r in after]})
    return jsonify(after)
