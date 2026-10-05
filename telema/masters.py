"""ログイン中のユーザー・ステータス・メンバー・リスト取得元。"""
from flask import jsonify

from .common import audit
from .context import ApiError, current_user, db, not_found, require_role, telema_role, body
from .routes import bp
from .validate import Bool, Enum, Int, Str, parse, parse_id

STATUS_CATEGORIES = ['not_started', 'in_progress', 'appointment', 'won', 'lost', 'excluded']

STATUS_BODY = {
    'label': Str(min=1, max=30),
    'category': Enum(STATUS_CATEGORIES),
    'color': Str(max=20, nullable=True, optional=True),
    'sort_order': Int(optional=True),
    'is_active': Bool(optional=True),
}


@bp.get('/me')
def me():
    return jsonify(current_user())


# ---- ステータス ----
@bp.get('/statuses')
def list_statuses():
    return jsonify(db().all('SELECT * FROM telema_call_statuses ORDER BY sort_order, id'))


@bp.post('/statuses')
def create_status():
    require_role('admin')
    b = parse(STATUS_BODY, body())
    d = db()
    if d.first('SELECT 1 FROM telema_call_statuses WHERE label = %s', (b['label'],)):
        raise ApiError(409, 'conflict', f'ステータス「{b["label"]}」は既にあります')
    row = d.first(
        '''INSERT INTO telema_call_statuses (label, category, color, sort_order)
           VALUES (%s, %s, %s, COALESCE(%s, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM telema_call_statuses))) RETURNING *''',
        (b['label'], b['category'], b.get('color'), b.get('sort_order')),
    )
    audit(d, current_user()['id'], 'create', 'call_status', row['id'], None, row)
    return jsonify(row), 201


@bp.patch('/statuses/<id>')
def update_status(id):
    require_role('admin')
    id = parse_id(id)
    b = parse(STATUS_BODY, body(), partial=True)
    d = db()
    before = d.first('SELECT * FROM telema_call_statuses WHERE id = %s', (id,))
    if not before:
        raise not_found('ステータス')
    row = d.first(
        '''UPDATE telema_call_statuses SET label = COALESCE(%s, label), category = COALESCE(%s, category), color = COALESCE(%s, color),
             sort_order = COALESCE(%s, sort_order), is_active = COALESCE(%s, is_active), updated_at = telema_now()
           WHERE id = %s RETURNING *''',
        (b.get('label'), b.get('category'), b.get('color'), b.get('sort_order'),
         None if b.get('is_active') is None else int(b['is_active']), id),
    )
    audit(d, current_user()['id'], 'update', 'call_status', id, before, row)
    return jsonify(row)


# ---- メンバー（CRM本体の users。追加・変更は CRM の「設定・管理」で行う） ----
@bp.get('/users')
def list_users():
    rows = db().all('SELECT id, display_name AS name, role FROM users ORDER BY display_name, id')
    return jsonify([{'id': r['id'], 'name': r['name'], 'email': None, 'role': telema_role(r['role']), 'is_active': 1} for r in rows])


# ---- 商材（契約情報の入力候補。CRM本体の「設定・管理」の商材をそのまま使う） ----
@bp.get('/products')
def list_products():
    data = db().value('SELECT data FROM app_state WHERE id = 1') or {}
    names = [p['name'] for p in (data.get('products') or []) if isinstance(p, dict) and p.get('name')]
    # 商材マスタから外れた商材名でも、契約済みのものは選べるように残す
    used = [r['product_name'] for r in db().all('SELECT DISTINCT product_name FROM telema_contracts WHERE is_active = 1 ORDER BY product_name')]
    return jsonify(list(dict.fromkeys([*names, *used])))


# ---- リスト取得元 ----
@bp.get('/list-sources')
def list_sources():
    return jsonify(db().all(
        '''SELECT ls.*, (SELECT COUNT(DISTINCT cs.company_id) FROM telema_company_sources cs JOIN telema_companies c ON c.id = cs.company_id
              WHERE cs.source_id = ls.id AND c.is_active = 1) AS company_count
           FROM telema_list_sources ls ORDER BY ls.created_at DESC, ls.id DESC'''
    ))
