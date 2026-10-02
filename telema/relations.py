"""施設どうしのつながり（担当者の知り合い関係）と相関図。"""
from flask import jsonify, request

from .common import audit, can_edit_company, company_visibility
from .context import ApiError, body, current_user, db, forbidden, not_found
from .routes import bp
from .validate import Bool, Int, Str, parse, parse_id


def _visible_companies(user, ids):
    vis_sql, vis_params = company_visibility(user)
    rows = db().all(
        f'SELECT c.id, c.organization_id, c.assigned_user_id FROM telema_companies c WHERE c.is_active = 1 AND {vis_sql} AND c.id = ANY(%s)',
        [*vis_params, list(ids)])
    return {r['id']: r for r in rows}


def _assert_contact_of(contact_id, company):
    """担当者がその施設（または施設の法人）に属しているか"""
    if contact_id is None:
        return
    ok = db().first(
        '''SELECT 1 FROM telema_contacts WHERE id = %s AND is_active = 1
           AND (company_id = %s OR (company_id IS NULL AND organization_id = %s))''',
        (contact_id, company['id'], company['organization_id']))
    if not ok:
        raise ApiError(400, 'validation_error', '担当者がその施設に登録されていません')


# 施設の代表的な担当者（決裁者 → 更新が新しい順）。一覧の contact_name と同じ選び方
def _key_contact(col):
    return f'''(SELECT ct.{col} FROM telema_contacts ct WHERE ct.company_id = c.id AND ct.is_active = 1 AND ct.name IS NOT NULL
      ORDER BY ct.is_decision_maker DESC, ct.updated_at DESC LIMIT 1)'''


@bp.get('/companies/<id>/relations')
def company_relations(id):
    id = parse_id(id)
    user = current_user()
    if not _visible_companies(user, [id]):
        raise not_found('会社')
    vis_sql, vis_params = company_visibility(user, 'o')
    # 自分側を a / b どちらに保存したかで相手側の列が入れ替わるので、向きを揃えてから結合する
    return jsonify(db().all(
        f'''SELECT r.id, o.id AS other_company_id, o.company_name AS other_company_name, o.address AS other_address,
              s.label AS other_status_label, s.category AS other_status_category, o.is_user AS other_is_user,
              mc.id AS my_contact_id, mc.name AS my_contact_name, oc.id AS other_contact_id, oc.name AS other_contact_name,
              r.label, r.notes, r.created_at
            FROM (
              SELECT id, company_b_id AS other_id, contact_a_id AS my_contact, contact_b_id AS other_contact, label, notes, created_at
                FROM telema_company_relations WHERE company_a_id = %s AND is_active = 1
              UNION ALL
              SELECT id, company_a_id, contact_b_id, contact_a_id, label, notes, created_at
                FROM telema_company_relations WHERE company_b_id = %s AND is_active = 1
            ) r
            JOIN telema_companies o ON o.id = r.other_id
            LEFT JOIN telema_call_statuses s ON s.id = o.status_id
            LEFT JOIN telema_contacts mc ON mc.id = r.my_contact
            LEFT JOIN telema_contacts oc ON oc.id = r.other_contact
            WHERE o.is_active = 1 AND {vis_sql}
            ORDER BY r.created_at DESC''',
        [id, id, *vis_params]))


@bp.post('/companies/<id>/relations')
def create_relation(id):
    id = parse_id(id)
    b = parse({
        'other_company_id': Int(min=1),
        'contact_id': Int(min=1, nullable=True, optional=True),
        'other_contact_id': Int(min=1, nullable=True, optional=True),
        'label': Str(max=100, nullable=True, optional=True),
        'notes': Str(max=1000, nullable=True, optional=True),
    }, body())
    user = current_user()
    d = db()
    other_id = b['other_company_id']
    if other_id == id:
        raise ApiError(400, 'validation_error', '同じ施設どうしはつなげません')
    found = _visible_companies(user, [id, other_id])
    me, other = found.get(id), found.get(other_id)
    if not me:
        raise not_found('会社')
    if not other:
        raise not_found('相手の施設')
    if not can_edit_company(user, me['assigned_user_id']):
        raise forbidden()
    _assert_contact_of(b.get('contact_id'), me)
    _assert_contact_of(b.get('other_contact_id'), other)

    # 向きを持たないので id の小さい方を a に揃える
    swap = id > other_id
    a_id, b_id = (other_id, id) if swap else (id, other_id)
    a_contact, b_contact = (b.get('other_contact_id'), b.get('contact_id')) if swap else (b.get('contact_id'), b.get('other_contact_id'))
    if d.first('SELECT id FROM telema_company_relations WHERE company_a_id = %s AND company_b_id = %s AND is_active = 1', (a_id, b_id)):
        raise ApiError(409, 'conflict', 'この施設とは既につながっています')
    row = d.first(
        '''INSERT INTO telema_company_relations (company_a_id, company_b_id, contact_a_id, contact_b_id, label, notes, created_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *''',
        (a_id, b_id, a_contact, b_contact, b.get('label'), b.get('notes'), user['id']))
    audit(d, user['id'], 'create', 'company_relation', row['id'], None, row)
    return jsonify(row), 201


@bp.patch('/relations/<id>')
def update_relation(id):
    """関係メモの編集・無効化（どちらかの施設を編集できる人だけ）"""
    id = parse_id(id)
    b = parse({'label': Str(max=100, nullable=True), 'notes': Str(max=1000, nullable=True), 'is_active': Bool()}, body(), partial=True)
    user = current_user()
    d = db()
    rel = d.first('SELECT * FROM telema_company_relations WHERE id = %s AND is_active = 1', (id,))
    if not rel:
        raise not_found('つながり')
    found = _visible_companies(user, [rel['company_a_id'], rel['company_b_id']])
    if len(found) < 2:
        raise not_found('つながり')
    if not any(can_edit_company(user, v['assigned_user_id']) for v in found.values()):
        raise forbidden()
    values = dict(b)
    if 'is_active' in b:
        values['is_active'] = int(b['is_active'])
    cols = list(values)
    if not cols:
        return jsonify(rel)
    row = d.first(
        f'UPDATE telema_company_relations SET {", ".join(f"{k} = %s" for k in cols)}, updated_at = telema_now() WHERE id = %s RETURNING *',
        [*[values[k] for k in cols], id])
    audit(d, user['id'], 'deactivate' if b.get('is_active') is False else 'update', 'company_relation', id, rel, row)
    return jsonify(row)


@bp.get('/relations/graph')
def relation_graph():
    # customers=1 のとき、つながりがまだ無いユーザーも点として出す
    customers = request.args.get('customers', '1')
    if customers not in ('0', '1'):
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（customers: 0 か 1 で指定してください）')
    user = current_user()
    d = db()
    vis_a, pa = company_visibility(user, 'a')
    vis_b, pb = company_visibility(user, 'b')
    edges = d.all(
        f'''SELECT r.id, r.company_a_id AS source, r.company_b_id AS target,
              ca.name AS source_contact_name, cb.name AS target_contact_name, r.label, r.notes
            FROM telema_company_relations r
            JOIN telema_companies a ON a.id = r.company_a_id
            JOIN telema_companies b ON b.id = r.company_b_id
            LEFT JOIN telema_contacts ca ON ca.id = r.contact_a_id
            LEFT JOIN telema_contacts cb ON cb.id = r.contact_b_id
            WHERE r.is_active = 1 AND a.is_active = 1 AND b.is_active = 1 AND {vis_a} AND {vis_b}''',
        [*pa, *pb])
    ids = list({i for e in edges for i in (e['source'], e['target'])})
    vis_sql, vis_params = company_visibility(user)
    nodes = d.all(
        f'''SELECT c.id, c.company_name, c.address, c.prefecture, c.city, {_key_contact("name")} AS contact_name, {_key_contact("role")} AS contact_role,
              s.label AS status_label, s.category AS status_category, c.is_user, c.latitude, c.longitude
            FROM telema_companies c LEFT JOIN telema_call_statuses s ON s.id = c.status_id
            WHERE c.is_active = 1 AND {vis_sql}
              AND (c.id = ANY(%s) {"OR c.is_user = 1" if customers == '1' else ''})
            ORDER BY c.company_name_normalized LIMIT 2000''',
        [*vis_params, ids])
    return jsonify({'nodes': nodes, 'edges': edges})
