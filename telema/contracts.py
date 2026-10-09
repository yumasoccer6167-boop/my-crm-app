"""契約情報（商材・契約日・営業担当）。1施設に複数件（商材ごと）持てる。履歴と同じく削除せず無効化する。"""
import re

from flask import jsonify, request

from .common import CONTRACT_SELECT, audit, can_edit_company, company_visibility
from .companies import load_visible_company
from .context import ApiError, body, current_user, db, forbidden, not_found
from .normalize import escape_like
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


# ---------- 契約リスト（全施設の契約情報を一覧にしたページ用） ----------
# 契約情報はカルテで登録されたものをそのまま使う（別に登録しない）。見える範囲の施設の分だけ。商材・契約日・営業担当・アポ担当者名で絞り込める
_DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def _arg_int(name, lo=1, hi=None):
    raw = request.args.get(name)
    if raw in (None, ''):
        return None
    if not raw.isdigit() or int(raw) < lo or (hi is not None and int(raw) > hi):
        raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（{name}: 数値で指定してください）')
    return int(raw)


def _arg_date(name):
    raw = request.args.get(name)
    if raw in (None, ''):
        return None
    if not _DATE.match(raw):
        raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（{name}: YYYY-MM-DD で指定してください）')
    return raw


_CONTRACT_FROM = '''FROM telema_contracts ct
  JOIN telema_companies c ON c.id = ct.company_id
  LEFT JOIN telema_organizations o ON o.id = c.organization_id
  LEFT JOIN users u ON u.id = ct.assigned_user_id'''


@bp.get('/contracts')
def list_contracts():
    user = current_user()
    vis_sql, vis_params = company_visibility(user)
    where = ['ct.is_active = 1', 'c.is_active = 1', vis_sql]
    params = list(vis_params)

    q = (request.args.get('q') or '').strip()[:100]
    if q:
        like = f'%{escape_like(q)}%'
        where.append('(c.search_text ILIKE %s OR ct.product_name ILIKE %s OR ct.appointment_user_name ILIKE %s)')
        params += [like, like, like]
    product = (request.args.get('product') or '')[:100]
    if product:
        where.append('ct.product_name = %s')
        params.append(product)
    assigned = request.args.get('assigned')
    if assigned == 'none':
        where.append('ct.assigned_user_id IS NULL')
    elif assigned:
        where.append('ct.assigned_user_id = %s')
        params.append(_arg_int('assigned'))
    appointment = (request.args.get('appointment') or '')[:100]
    if appointment == '__none__':
        where.append("COALESCE(ct.appointment_user_name, '') = ''")
    elif appointment:
        where.append('ct.appointment_user_name = %s')
        params.append(appointment)
    date_from, date_to = _arg_date('date_from'), _arg_date('date_to')
    if date_from:
        where.append('ct.contract_date >= %s')
        params.append(date_from)
    if date_to:
        where.append('ct.contract_date <= %s')
        params.append(date_to)
    order = 'ASC' if request.args.get('order') == 'asc' else 'DESC'
    page = _arg_int('page') or 1
    per_page = _arg_int('per_page', hi=200) or 50

    d = db()
    clause = ' AND '.join(where)
    total = d.value(f'SELECT COUNT(*) {_CONTRACT_FROM} WHERE {clause}', params)
    items = d.all(
        f'''SELECT ct.id, ct.company_id, c.company_name, o.name AS organization_name, c.prefecture, c.city, c.is_user,
                  ct.product_name, ct.product_url, ct.contract_date, ct.assigned_user_id, u.display_name AS assigned_user_name,
                  ct.appointment_user_name
             {_CONTRACT_FROM} WHERE {clause}
             ORDER BY ct.contract_date {order}, ct.id {order} LIMIT %s OFFSET %s''',
        [*params, per_page, (page - 1) * per_page])
    return jsonify({'total': total, 'page': page, 'per_page': per_page, 'items': items})


@bp.get('/contracts/facets')
def contract_facets():
    """絞り込みの選択肢（商材・営業担当・アポ担当者名と、それぞれの件数）。見える範囲の契約だけ"""
    user = current_user()
    vis_sql, vis_params = company_visibility(user)
    base = f'{_CONTRACT_FROM} WHERE ct.is_active = 1 AND c.is_active = 1 AND {vis_sql}'
    d = db()
    return jsonify({
        'products': d.all(f'SELECT ct.product_name AS value, COUNT(*) AS n {base} GROUP BY 1 ORDER BY n DESC, 1', vis_params),
        'assignees': d.all(
            f'SELECT ct.assigned_user_id AS id, u.display_name AS name, COUNT(*) AS n {base} AND ct.assigned_user_id IS NOT NULL GROUP BY 1, 2 ORDER BY n DESC, 2', vis_params),
        'appointments': d.all(
            f"SELECT ct.appointment_user_name AS value, COUNT(*) AS n {base} AND COALESCE(ct.appointment_user_name, '') <> '' GROUP BY 1 ORDER BY n DESC, 1", vis_params),
    })
