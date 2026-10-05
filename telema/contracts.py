"""契約情報（商材・契約日・営業担当）。1施設に複数件（商材ごと）持てる。履歴と同じく削除せず無効化する。"""
from flask import jsonify

from .common import CONTRACT_SELECT, audit, can_edit_company
from .companies import load_visible_company
from .context import ApiError, body, current_user, db, forbidden, not_found
from .routes import bp
from .validate import Bool, Int, IsoDate, Str, parse, parse_id

CONTRACT_BODY = {
    'product_name': Str(min=1, max=100),
    'contract_date': IsoDate(),
    'assigned_user_id': Int(nullable=True, optional=True),
    # 商材の案内ページなどへのリンク。画面でそのままリンクにするので http(s) だけ受け付ける
    'product_url': Str(max=1000, pattern=r'https?://\S+', pattern_msg='リンクは http:// または https:// から始まるURLで入力してください', nullable=True, optional=True),
    'appointment_user_name': Str(max=100, nullable=True, optional=True),
}


def _check_assignee(d, user, assigned_user_id):
    """営業担当は CRM の実在するメンバーのみ。sales は自分以外を担当にできない（施設の担当営業の変更と同じ決まり）"""
    if assigned_user_id is None:
        return
    if user['role'] == 'sales' and assigned_user_id != user['id']:
        raise ApiError(403, 'forbidden', '営業担当は自分自身のみ選択できます')
    if not d.first('SELECT 1 FROM users WHERE id = %s', (assigned_user_id,)):
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（assigned_user_id: 営業担当が見つかりません）')


@bp.post('/companies/<id>/contracts')
def create_contract(id):
    id = parse_id(id)
    b = parse(CONTRACT_BODY, body())
    user = current_user()
    company = load_visible_company(id)
    if not can_edit_company(user, company['assigned_user_id']):
        raise forbidden()
    d = db()
    _check_assignee(d, user, b.get('assigned_user_id'))
    new_id = d.value(
        '''INSERT INTO telema_contracts (company_id, product_name, contract_date, assigned_user_id, product_url, appointment_user_name, created_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id''',
        (id, b['product_name'], b['contract_date'], b.get('assigned_user_id'), b.get('product_url') or None,
         b.get('appointment_user_name') or None, user['id']),
    )
    row = d.first(f'{CONTRACT_SELECT} WHERE ct.id = %s', (new_id,))
    audit(d, user['id'], 'create', 'contract', new_id, None, row)
    return jsonify(row), 201


@bp.patch('/contracts/<id>')
def update_contract(id):
    id = parse_id(id)
    b = parse({**CONTRACT_BODY, 'is_active': Bool()}, body(), partial=True)
    user = current_user()
    d = db()
    before = d.first(f'{CONTRACT_SELECT} WHERE ct.id = %s AND ct.is_active = 1', (id,))
    if not before:
        raise not_found('契約情報')
    company = load_visible_company(before['company_id'])
    if not can_edit_company(user, company['assigned_user_id']):
        raise forbidden()
    if 'assigned_user_id' in b and b['assigned_user_id'] != before['assigned_user_id']:
        _check_assignee(d, user, b['assigned_user_id'])
    values = dict(b)
    for key in ('product_url', 'appointment_user_name'):
        if key in values and not values[key]:
            values[key] = None
    if 'is_active' in values:
        values['is_active'] = int(values['is_active'])
    if not values:
        return jsonify(before)
    d.run(
        f'UPDATE telema_contracts SET {", ".join(f"{k} = %s" for k in values)}, updated_at = telema_now() WHERE id = %s',
        [*values.values(), id],
    )
    row = d.first(f'{CONTRACT_SELECT} WHERE ct.id = %s', (id,))
    audit(d, user['id'], 'deactivate' if b.get('is_active') is False else 'update', 'contract', id, before, row)
    return jsonify(row)
